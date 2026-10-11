import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'errors.dart';
import 'models.dart';
import 'token_store.dart';

/// Talks to ALT Core for everything about the person's ALT account: sign-up, sign-in, sessions,
/// two-factor authentication, profile, and moving between ALT apps. One instance per app.
///
/// The refresh token lives in [TokenStore] (secure storage); the short-lived access token stays
/// in memory and is refreshed automatically. Refreshes are single-flight, because ALT Core
/// treats a refresh token presented twice as stolen and ends the session.
class AltAccountClient {
  AltAccountClient({
    required String apiUrl,
    required this.platform,
    TokenStore? tokenStore,
    http.Client? httpClient,
    this.deviceName,
  })  : apiUrl = apiUrl.endsWith('/') ? apiUrl.substring(0, apiUrl.length - 1) : apiUrl,
        _store = tokenStore ?? SecureTokenStore(),
        _http = httpClient ?? http.Client();

  /// The ALT gateway, e.g. `http://10.0.2.2:8080`. Core lives at `$apiUrl/core`.
  final String apiUrl;
  final AltPlatform platform;
  final String? deviceName;
  final TokenStore _store;
  final http.Client _http;

  /// The signed-in person, or null. Listen to react to sign-in and sign-out anywhere in the app.
  final ValueNotifier<AltUser?> currentUser = ValueNotifier<AltUser?>(null);

  String? _accessToken;
  DateTime? _accessExpiresAt;
  Future<bool>? _refreshing;

  String get coreUrl => '$apiUrl/core';
  bool get isSignedIn => currentUser.value != null;

  Map<String, dynamic> get _device => {
        'platform': platform.name,
        if (deviceName != null) 'deviceName': deviceName,
        'client': 'app',
      };

  // ------------------------------------------------------------------ low level

  Future<Map<String, dynamic>> _call(
    String method,
    String path, {
    Object? body,
    bool auth = false,
    bool retry = true,
  }) async {
    final headers = <String, String>{'accept': 'application/json', if (body != null) 'content-type': 'application/json'};
    if (auth) {
      final token = await accessToken();
      if (token == null) throw const AltApiException(status: 401, code: 'UNAUTHORIZED', message: 'Sign in required.');
      headers['authorization'] = 'Bearer $token';
    }
    http.Response res;
    try {
      final req = http.Request(method, Uri.parse('$coreUrl$path'))..headers.addAll(headers);
      if (body != null) req.body = jsonEncode(body);
      res = await http.Response.fromStream(await _http.send(req).timeout(const Duration(seconds: 20)));
    } catch (e) {
      throw AltApiException.network(e);
    }
    if (res.statusCode == 401 && auth && retry && await refresh()) {
      return _call(method, path, body: body, auth: auth, retry: false);
    }
    final decoded = res.body.isEmpty ? <String, dynamic>{} : jsonDecode(res.body);
    if (res.statusCode >= 400) throw AltApiException.fromBody(res.statusCode, decoded);
    if (decoded is List) return {'items': decoded};
    return Map<String, dynamic>.from(decoded as Map);
  }

  Future<AltUser> _acceptTokens(Map<String, dynamic> body) async {
    _accessToken = body['accessToken'] as String;
    final ttl = (body['accessTokenExpiresIn'] as num?)?.toInt() ?? 900;
    // Refresh a little early so a request never leaves with a token about to expire.
    _accessExpiresAt = DateTime.now().add(Duration(seconds: ttl - 30));
    final refresh = body['refreshToken'] as String?;
    if (refresh != null) await _store.writeRefreshToken(refresh);
    final user = AltUser.fromJson(Map<String, dynamic>.from(body['user'] as Map));
    currentUser.value = user;
    return user;
  }

  SignInResult _signInOutcome(Map<String, dynamic> body) {
    if (body['mfaRequired'] == true) return TwoFactorRequired(body['mfaToken'] as String);
    throw StateError('unreachable');
  }

  // ------------------------------------------------------------------ session

  /// Restores the previous session at app start. Returns the person, or null if they must sign in.
  Future<AltUser?> restore() async {
    try {
      if (await _store.readRefreshToken() == null) return null;
    } catch (e) {
      // Secure storage can fail (e.g. a reset Android keystore). Treat it as signed out, never hang.
      debugPrint('ALT session could not be read: $e');
      return null;
    }
    return await refresh() ? currentUser.value : null;
  }

  /// A valid access token, refreshing it if needed. Null when signed out.
  Future<String?> accessToken() async {
    if (_accessToken != null && _accessExpiresAt != null && DateTime.now().isBefore(_accessExpiresAt!)) {
      return _accessToken;
    }
    return await refresh() ? _accessToken : null;
  }

  /// Swaps the refresh token for a new pair. Concurrent callers share one request.
  Future<bool> refresh() {
    return _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);
  }

  Future<bool> _doRefresh() async {
    final token = await _store.readRefreshToken();
    if (token == null) return false;
    try {
      final body = await _call('POST', '/auth/refresh', body: {'refreshToken': token});
      await _acceptTokens(body);
      return true;
    } on AltApiException catch (e) {
      if (e.isNetwork) return false; // keep the session; we're just offline
      await _forget();
      return false;
    }
  }

  Future<void> _forget() async {
    _accessToken = null;
    _accessExpiresAt = null;
    await _store.clear();
    currentUser.value = null;
  }

  /// Sends a request to any ALT service with the person's token, retrying once after a refresh.
  Future<http.Response> authorizedSend(String method, Uri uri, {Object? body, Map<String, String>? headers}) async {
    Future<http.Response> send(String? token) async {
      final req = http.Request(method, uri)
        ..headers.addAll({
          if (body != null) 'content-type': 'application/json',
          if (token != null) 'authorization': 'Bearer $token',
          ...?headers,
        });
      if (body != null) req.body = body is String ? body : jsonEncode(body);
      return http.Response.fromStream(await _http.send(req));
    }

    final res = await send(await accessToken());
    if (res.statusCode == 401 && await refresh()) return send(_accessToken);
    return res;
  }

  // ------------------------------------------------------------------ sign-up and sign-in

  /// Creates the ALT account and emails a 6-digit code. Finish with [verifyEmail].
  Future<void> register({
    required String email,
    required String password,
    required String handle,
    required String displayName,
    List<String>? roles,
  }) async {
    await _call('POST', '/auth/register', body: {
      'email': email.trim(),
      'password': password,
      'handle': handle.trim(),
      'displayName': displayName.trim(),
      if (roles != null) 'roles': roles,
    });
  }

  /// Confirms the emailed code and signs in.
  Future<SignInResult> verifyEmail(String email, String code) async {
    final body = await _call('POST', '/auth/email/verify', body: {'email': email.trim(), 'code': code.trim(), ..._device});
    if (body['mfaRequired'] == true) return _signInOutcome(body);
    return SignedIn(await _acceptTokens(body));
  }

  Future<void> resendEmailCode(String email) => _call('POST', '/auth/otp/resend', body: {'email': email.trim()});

  /// Signs in with email or handle and password.
  Future<SignInResult> signIn(String identifier, String password) async {
    try {
      final body = await _call('POST', '/auth/login', body: {'identifier': identifier.trim(), 'password': password, ..._device});
      if (body['mfaRequired'] == true) return _signInOutcome(body);
      return SignedIn(await _acceptTokens(body));
    } on AltApiException catch (e) {
      if (e.code == 'EMAIL_NOT_VERIFIED') return EmailNotVerified('${e.details?['email'] ?? identifier}');
      rethrow;
    }
  }

  /// Second step when two-factor authentication is on: pass a 6-digit [code] or a [recoveryCode].
  Future<AltUser> completeTwoFactor(String mfaToken, {String? code, String? recoveryCode}) async {
    final body = await _call('POST', '/auth/login/2fa', body: {
      'mfaToken': mfaToken,
      if (code != null) 'code': code.trim(),
      if (recoveryCode != null) 'recoveryCode': recoveryCode.trim(),
      'client': 'app',
    });
    return _acceptTokens(body);
  }

  /// Signs in or up with a Google ID token (from the google_sign_in plugin).
  Future<SignInResult> signInWithGoogle(String idToken) async {
    final body = await _call('POST', '/auth/google', body: {'idToken': idToken, ..._device});
    if (body['mfaRequired'] == true) return _signInOutcome(body);
    return SignedIn(await _acceptTokens(body));
  }

  Future<void> signOut() async {
    try {
      await _call('POST', '/auth/logout', auth: true, retry: false);
    } catch (_) {
      // Signing out locally must always work, even offline.
    }
    await _forget();
  }

  /// Ends every session of this account in every ALT app.
  Future<int> signOutEverywhere() async {
    final body = await _call('POST', '/auth/logout-all', auth: true);
    await _forget();
    return (body['sessionsRevoked'] as num?)?.toInt() ?? 0;
  }

  // ------------------------------------------------------------------ passwords

  Future<void> forgotPassword(String email) => _call('POST', '/auth/password/forgot', body: {'email': email.trim()});

  Future<void> resetPassword({required String email, required String code, required String newPassword}) =>
      _call('POST', '/auth/password/reset', body: {'email': email.trim(), 'code': code.trim(), 'newPassword': newPassword});

  /// [currentPassword] can be null for accounts created with Google or a wallet (sets a first password).
  Future<void> changePassword({String? currentPassword, required String newPassword}) => _call(
        'POST',
        '/auth/password/change',
        auth: true,
        body: {if (currentPassword != null) 'currentPassword': currentPassword, 'newPassword': newPassword},
      );

  // ------------------------------------------------------------------ profile

  Future<AltUser> reloadMe() async {
    final user = AltUser.fromJson(await _call('GET', '/me', auth: true));
    currentUser.value = user;
    return user;
  }

  Future<AltUser> updateProfile({String? displayName, String? handle, String? bio}) async {
    final user = AltUser.fromJson(await _call('PATCH', '/me', auth: true, body: {
      if (displayName != null) 'displayName': displayName,
      if (handle != null) 'handle': handle,
      if (bio != null) 'bio': bio,
    }));
    currentUser.value = user;
    return user;
  }

  Future<bool> isHandleAvailable(String handle) async {
    final body = await _call('GET', '/handles/${Uri.encodeComponent(handle)}/available');
    return body['available'] == true;
  }

  Future<List<AltSession>> sessions() async {
    final body = await _call('GET', '/me/sessions', auth: true);
    return (body['items'] as List).map((s) => AltSession.fromJson(Map<String, dynamic>.from(s as Map))).toList();
  }

  Future<void> revokeSession(String sessionId) => _call('DELETE', '/me/sessions/$sessionId', auth: true);

  // ------------------------------------------------------------------ two-factor authentication

  Future<TwoFactorSetup> startTwoFactorSetup() async {
    final body = await _call('POST', '/auth/2fa/setup', auth: true);
    return TwoFactorSetup(secret: body['secret'] as String, otpauthUrl: body['otpauthUrl'] as String);
  }

  /// Confirms the first authenticator code. Returns one-time recovery codes to show the person once.
  Future<List<String>> enableTwoFactor(String code) async {
    final body = await _call('POST', '/auth/2fa/enable', auth: true, body: {'code': code.trim()});
    await reloadMe();
    return (body['recoveryCodes'] as List).cast<String>();
  }

  Future<void> disableTwoFactor({String? code, String? recoveryCode}) async {
    await _call('POST', '/auth/2fa/disable', auth: true, body: {
      if (code != null) 'code': code.trim(),
      if (recoveryCode != null) 'recoveryCode': recoveryCode.trim(),
    });
    await reloadMe();
  }

  // ------------------------------------------------------------------ moving between ALT apps

  /// A one-time link (valid 60 s) that opens [target] already signed in as this person.
  Future<Uri> handoffLink(AltPlatform target) async {
    final body = await _call('POST', '/auth/handoff', auth: true, body: {'target': target.name});
    return Uri.parse(body['url'] as String);
  }

  /// Called when this app is opened through a handoff link.
  Future<AltUser> redeemHandoff(String code) async {
    final body = await _call('POST', '/auth/handoff/redeem', body: {'code': code, ..._device});
    return _acceptTokens(body);
  }

  void dispose() {
    currentUser.dispose();
    _http.close();
  }
}
