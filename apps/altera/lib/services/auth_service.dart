import 'dart:convert';

import 'package:alt_account/alt_account.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

import '../config/app_config.dart';
import '../models/user_model.dart';

/// ALTERA's view of the signed-in person.
///
/// Signing up, signing in, passwords and sessions belong to the person's ALT account and are
/// handled by ALT Core through the shared `alt_account` package, the same code ALTER and ALTAR use.
/// This service adds what is ALTERA-specific: the profile bundle from `/altera/auth/me` (the
/// human profile plus their AI personas) and an authorised HTTP helper for ALTERA's API.
class AuthService {
  AuthService({AltAccountClient? alt})
      : alt = alt ?? AltAccountClient(apiUrl: AppConfig.apiUrl, platform: AltPlatform.altera, deviceName: 'ALTERA app');

  final AltAccountClient alt;
  late final AltHandoff handoff = AltHandoff(alt);

  String get baseUrl => AppConfig.baseUrl;
  final _storage = const FlutterSecureStorage();
  static const String _userKey = 'altera.user_bundle';
  static const String _userCachedAtKey = 'altera.user_bundle_cached_at';
  static const Duration _userCacheTtl = Duration(hours: 1);
  String? activeProfileId;

  // ------------------------------------------------------------------ tokens and requests

  Future<String?> getToken() => alt.accessToken();

  Future<bool> get isLoggedIn async => alt.isSignedIn || await alt.accessToken() != null;

  bool get canUseGoogleAuth => AppConfig.isGoogleSignInConfigured;

  Future<Map<String, String>> authHeaders() async {
    final token = await getToken();
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  /// Calls an ALT service as the signed-in person; refreshes the session once on 401.
  Future<http.Response> authorizedRequest({
    required String method,
    required Uri uri,
    Object? body,
    Map<String, String>? headers,
    bool retryOnUnauthorized = true,
  }) {
    return alt.authorizedSend(method, uri, body: body, headers: headers);
  }

  // ------------------------------------------------------------------ session

  /// Restores the previous session at start-up.
  Future<AuthResult> restore() async {
    final user = await alt.restore();
    if (user == null) return AuthResult.failure('Not signed in');
    return getMe();
  }

  /// Signs in with email or handle and password.
  Future<AuthResult> login({required String email, required String password}) async {
    try {
      return _afterSignIn(await alt.signIn(email, password));
    } on AltApiException catch (e) {
      return AuthResult.failure(e.message, code: e.code);
    }
  }

  Future<AuthResult> completeTwoFactor(String mfaToken, {String? code, String? recoveryCode}) async {
    try {
      await alt.completeTwoFactor(mfaToken, code: code, recoveryCode: recoveryCode);
      return getMe();
    } on AltApiException catch (e) {
      return AuthResult.failure(e.message, code: e.code);
    }
  }

  /// Creates the ALT account and emails a verification code. Finish with [verifyEmail].
  Future<AuthResult> register({
    required String email,
    required String password,
    required String username,
    required String displayName,
  }) async {
    try {
      await alt.register(email: email, password: password, handle: username, displayName: displayName);
      return AuthResult.needsVerification(email.trim());
    } on AltApiException catch (e) {
      return AuthResult.failure(e.message, code: e.code);
    }
  }

  /// Confirms the emailed code; the person is then signed in.
  Future<AuthResult> verifyEmail(String email, String code) async {
    try {
      return _afterSignIn(await alt.verifyEmail(email, code));
    } on AltApiException catch (e) {
      return AuthResult.failure(e.message, code: e.code);
    }
  }

  Future<AuthResult> resendVerificationCode(String email) async {
    try {
      await alt.resendEmailCode(email);
      return const AuthResult._(success: true);
    } on AltApiException catch (e) {
      return AuthResult.failure(e.message, code: e.code);
    }
  }

  /// Signs in from another ALT app's handoff link (altera://handoff?code=...).
  Future<AuthResult> redeemHandoff(String code) async {
    try {
      await alt.redeemHandoff(code);
      return getMe();
    } on AltApiException catch (e) {
      return AuthResult.failure(e.message, code: e.code);
    }
  }

  Future<AuthResult> loginWithGoogle() async {
    return AuthResult.failure('Google sign-in is not set up on this build yet. Use your email and password.');
  }

  Future<AuthResult> _afterSignIn(SignInResult result) async {
    return switch (result) {
      SignedIn() => await getMe(),
      TwoFactorRequired(:final mfaToken) => AuthResult.twoFactor(mfaToken),
      EmailNotVerified(:final email) => AuthResult.needsVerification(email),
    };
  }

  Future<void> logout() async {
    await alt.signOut();
    await _clearCachedUser();
  }

  // ------------------------------------------------------------------ ALTERA profile bundle

  /// The ALTERA profile bundle: the person plus their AI personas.
  Future<AuthResult> getMe() async {
    try {
      final res = await authorizedRequest(method: 'GET', uri: Uri.parse('$baseUrl/auth/me'));
      final data = jsonDecode(res.body);
      if (res.statusCode == 200) {
        final user = UserModel.fromJson(data as Map<String, dynamic>);
        await _writeCachedUser(data);
        return AuthResult.success(user);
      }
      return AuthResult.failure((data is Map ? data['message'] : null)?.toString() ?? 'Failed to load your profile');
    } catch (e) {
      return AuthResult.failure('Cannot reach ALTERA. Check your connection.');
    }
  }

  /// Kept for existing callers: refreshes the session and reloads the profile bundle.
  Future<AuthResult> refreshToken() async {
    if (!await alt.refresh()) return AuthResult.failure('Session expired');
    return getMe();
  }

  Future<AuthResult> createAIPersona({
    required String username,
    required String displayName,
    required String bio,
    required String category,
  }) async {
    try {
      final res = await authorizedRequest(
        method: 'POST',
        uri: Uri.parse('$baseUrl/profiles/ai'),
        body: {'username': username, 'display_name': displayName, 'bio': bio, 'category': category},
      );
      final data = jsonDecode(res.body);
      if (res.statusCode == 201) return getMe();
      return AuthResult.failure(data['message'] ?? 'Failed to create AI persona');
    } catch (e) {
      return AuthResult.failure('Network error: ${e.toString()}');
    }
  }

  Future<UserModel?> getCachedUser() async {
    try {
      final raw = await _storage.read(key: _userKey);
      final cachedAt = await _storage.read(key: _userCachedAtKey);
      if (raw == null || cachedAt == null) return null;
      final age = DateTime.now().millisecondsSinceEpoch - int.parse(cachedAt);
      if (age > _userCacheTtl.inMilliseconds) {
        await _clearCachedUser();
        return null;
      }
      return UserModel.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  Future<void> _writeCachedUser(Map<String, dynamic> userData) async {
    await _storage.write(key: _userKey, value: jsonEncode(userData));
    await _storage.write(key: _userCachedAtKey, value: DateTime.now().millisecondsSinceEpoch.toString());
  }

  Future<void> _clearCachedUser() async {
    await _storage.delete(key: _userKey);
    await _storage.delete(key: _userCachedAtKey);
  }

  // ------------------------------------------------------------------ passwords

  Future<AuthResult> forgotPassword(String email) async {
    try {
      await alt.forgotPassword(email);
      return const AuthResult._(success: true);
    } on AltApiException catch (e) {
      return AuthResult.failure(e.message, code: e.code);
    }
  }

  Future<AuthResult> resetPassword(String email, String otp, String newPassword) async {
    try {
      await alt.resetPassword(email: email, code: otp, newPassword: newPassword);
      return const AuthResult._(success: true);
    } on AltApiException catch (e) {
      return AuthResult.failure(e.message, code: e.code);
    }
  }

  /// First password for accounts created with Google or a wallet.
  Future<AuthResult> setInitialPassword(String password) async {
    try {
      await alt.changePassword(newPassword: password);
      return const AuthResult._(success: true);
    } on AltApiException catch (e) {
      return AuthResult.failure(e.message, code: e.code);
    }
  }

  Future<AuthResult> changePassword(String oldPassword, String newPassword) async {
    try {
      await alt.changePassword(currentPassword: oldPassword, newPassword: newPassword);
      return const AuthResult._(success: true);
    } on AltApiException catch (e) {
      return AuthResult.failure(e.message, code: e.code);
    }
  }
}

class AuthResult {
  final bool success;
  final bool launched;
  final UserModel? user;
  final String? error;
  final String? code;
  final bool isNewUser;

  /// Set when the email must be confirmed with the code we just sent.
  final String? verifyEmail;

  /// Set when the password was right but an authenticator code is needed.
  final String? mfaToken;

  const AuthResult._({
    required this.success,
    this.launched = false,
    this.user,
    this.error,
    this.code,
    this.isNewUser = false,
    this.verifyEmail,
    this.mfaToken,
  });

  factory AuthResult.success(UserModel user, {bool isNewUser = false}) =>
      AuthResult._(success: true, user: user, isNewUser: isNewUser);

  factory AuthResult.failure(String error, {String? code}) => AuthResult._(success: false, error: error, code: code);

  factory AuthResult.needsVerification(String email) =>
      AuthResult._(success: false, verifyEmail: email, error: 'Enter the code we emailed to $email.');

  factory AuthResult.twoFactor(String mfaToken) =>
      AuthResult._(success: false, mfaToken: mfaToken, error: 'Enter the code from your authenticator app.');

  factory AuthResult.launched(String message) => AuthResult._(success: false, launched: true, error: message);
}
