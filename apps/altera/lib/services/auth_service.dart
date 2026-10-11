import 'dart:convert';
import 'package:auth0_flutter/auth0_flutter.dart';
import 'package:auth0_flutter/auth0_flutter_web.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import '../config/app_config.dart';
import '../models/user_model.dart';

class AuthService {
  final String _baseUrl = AppConfig.baseUrl;
  String get baseUrl => _baseUrl;
  final _storage = const FlutterSecureStorage();
  static const String _tokenKey = 'access_token';
  static const String _refreshKey = 'refresh_token';
  static const String _userKey = 'user_data';
  static const String _userCachedAtKey = 'user_cached_at';
  static const Duration _userCacheTtl = Duration(hours: 1);
  String? activeProfileId;

  Future<String?> getToken() => _storage.read(key: _tokenKey);

  Future<void> saveTokens({
    required String token,
    required String refreshToken,
  }) async {
    await _storage.write(key: _tokenKey, value: token);
    await _storage.write(key: _refreshKey, value: refreshToken);
  }

  Future<void> clearTokens() async {
    await _storage.delete(key: _tokenKey);
    await _storage.delete(key: _refreshKey);
    await _storage.delete(key: _userKey);
    await _storage.delete(key: _userCachedAtKey);
  }

  Future<bool> get isLoggedIn async {
    final token = await getToken();
    if (token == null || token.trim().isEmpty) return false;
    return !_isTokenExpired(token);
  }

  bool get canUseGoogleAuth => AppConfig.isAuth0Configured;

  Future<Map<String, String>> authHeaders() async {
    final token = await getToken();
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  Future<http.Response> authorizedRequest({
    required String method,
    required Uri uri,
    Object? body,
    Map<String, String>? headers,
    bool retryOnUnauthorized = true,
  }) async {
    final mergedHeaders = {
      ...await authHeaders(),
      if (headers != null) ...headers,
    };
    final response = await _send(
      method: method,
      uri: uri,
      headers: mergedHeaders,
      body: body,
    );

    if (response.statusCode != 401 || !retryOnUnauthorized) {
      return response;
    }

    final refreshed = await refreshToken();
    if (!refreshed.success) {
      return response;
    }

    final retryHeaders = {
      ...await authHeaders(),
      if (headers != null) ...headers,
    };
    return _send(
      method: method,
      uri: uri,
      headers: retryHeaders,
      body: body,
    );
  }

  Future<AuthResult> register({
    required String email,
    required String password,
    required String username,
    required String displayName,
  }) async {
    try {
      final res = await http.post(
        Uri.parse('$_baseUrl/auth/register'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'email': email,
          'password': password,
          'username': username,
          'display_name': displayName,
        }),
      );
      final data = jsonDecode(res.body);
      if (res.statusCode == 201) {
        await saveTokens(
          token: data['token'],
          refreshToken: data['refresh_token'],
        );
        final user = UserModel.fromJson(data['user']);
        await _writeCachedUser(data['user']);
        return AuthResult.success(user);
      }
      return AuthResult.failure(data['message'] ?? 'Registration failed');
    } catch (e) {
      return AuthResult.failure('Network error: ${e.toString()}');
    }
  }

  Future<AuthResult> login({
    required String email,
    required String password,
  }) async {
    try {
      final res = await http.post(
        Uri.parse('$_baseUrl/auth/login'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'email': email, 'password': password}),
      );
      final data = jsonDecode(res.body);
      if (res.statusCode == 200) {
        await saveTokens(
          token: data['token'],
          refreshToken: data['refresh_token'],
        );
        final user = UserModel.fromJson(data['user']);
        await _writeCachedUser(data['user']);
        return AuthResult.success(user);
      }
      return AuthResult.failure(data['message'] ?? 'Login failed');
    } catch (e) {
      return AuthResult.failure('Network error: ${e.toString()}');
    }
  }

  Future<AuthResult> loginWithGoogle() async {
    if (!AppConfig.isAuth0Configured) {
      return AuthResult.failure(
        'Auth0 Google sign-in is not configured yet.',
      );
    }

    try {
      if (kIsWeb) {
        final auth0Web = Auth0Web(
          AppConfig.auth0Domain,
          AppConfig.auth0ClientId,
          redirectUrl: AppConfig.auth0RedirectUrl,
        );

        await auth0Web.loginWithRedirect(
          redirectUrl: AppConfig.auth0RedirectUrl,
          audience:
              AppConfig.auth0Audience.isEmpty ? null : AppConfig.auth0Audience,
          scopes: {'openid', 'profile', 'email'},
          parameters: const {'connection': 'google-oauth2'},
        );

        return AuthResult.launched(
          'Continue with Google in the browser to finish signing in.',
        );
      }

      final auth0 = Auth0(AppConfig.auth0Domain, AppConfig.auth0ClientId);
      final credentials = await auth0
          .webAuthentication(
        scheme: AppConfig.auth0Scheme,
      )
          .login(
        audience:
            AppConfig.auth0Audience.isEmpty ? null : AppConfig.auth0Audience,
        scopes: {'openid', 'profile', 'email'},
        parameters: const {'connection': 'google-oauth2'},
      );

      return _exchangeAuth0AccessToken(credentials.accessToken);
    } catch (e) {
      final error = e.toString();
      if (error.contains('redirect_uri') ||
          error.contains('Callback URL mismatch')) {
        return AuthResult.failure(
          'Google sign-in failed: callback URL mismatch. '
          'Make sure Auth0 Allowed Callback URLs includes '
          '${AppConfig.auth0AndroidRedirectUrl}.',
        );
      }
      return AuthResult.failure('Google sign-in failed: $error');
    }
  }

  Future<AuthResult?> restoreGoogleSession() async {
    if (!AppConfig.isAuth0Configured || !kIsWeb) return null;

    try {
      final auth0Web = Auth0Web(
        AppConfig.auth0Domain,
        AppConfig.auth0ClientId,
        redirectUrl: AppConfig.auth0RedirectUrl,
      );

      final credentials = await auth0Web.onLoad(
        audience:
            AppConfig.auth0Audience.isEmpty ? null : AppConfig.auth0Audience,
        scopes: {'openid', 'profile', 'email'},
      );

      if (credentials == null) return null;
      return _exchangeAuth0AccessToken(credentials.accessToken);
    } catch (_) {
      return null;
    }
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
        uri: Uri.parse('$_baseUrl/profiles/ai'),
        body: {
          'username': username,
          'display_name': displayName,
          'bio': bio,
          'category': category,
        },
      );
      final data = jsonDecode(res.body);
      if (res.statusCode == 201) {
        return refreshToken();
      }
      return AuthResult.failure(
        data['message'] ?? 'Failed to create AI persona',
      );
    } catch (e) {
      return AuthResult.failure('Network error: ${e.toString()}');
    }
  }

  Future<void> logout() async {
    try {
      await authorizedRequest(
        method: 'POST',
        uri: Uri.parse('$_baseUrl/auth/logout'),
        retryOnUnauthorized: false,
      );
    } catch (_) {}

    if (AppConfig.isAuth0Configured) {
      final logoutUrl =
          kIsWeb ? AppConfig.auth0LogoutUrl : AppConfig.auth0AndroidRedirectUrl;
      try {
        if (kIsWeb) {
          final auth0Web = Auth0Web(
            AppConfig.auth0Domain,
            AppConfig.auth0ClientId,
            redirectUrl: AppConfig.auth0RedirectUrl,
          );
          await auth0Web.logout(returnToUrl: logoutUrl);
        } else {
          final auth0 = Auth0(AppConfig.auth0Domain, AppConfig.auth0ClientId);
          // For mobile, we omit returnTo to avoid "Oops! Something went wrong" errors
          // if the logout URL is not explicitly whitelisted in the Auth0 Dashboard.
          // The SDK will still clear the browser session.
          await auth0
              .webAuthentication(scheme: AppConfig.auth0Scheme)
              .logout();
        }
      } catch (e) {
        debugPrint('Auth0 logout error: $e');
        // Ignore Auth0 logout/redirect failure and clear local session anyway.
      }
    }
    await clearTokens();
  }

  Future<AuthResult> getMe() async {
    try {
      final res = await authorizedRequest(
        method: 'GET',
        uri: Uri.parse('$_baseUrl/auth/me'),
      );
      final data = jsonDecode(res.body);
      if (res.statusCode == 200) {
        final user = UserModel.fromJson(data);
        await _writeCachedUser(data);
        return AuthResult.success(user);
      }
      return AuthResult.failure(data['message'] ?? 'Failed to fetch user data');
    } catch (e) {
      return AuthResult.failure('Network error: ${e.toString()}');
    }
  }

  Future<UserModel?> getCachedUser() async {
    final raw = await _storage.read(key: _userKey);
    final cachedAt = await _storage.read(key: _userCachedAtKey);
    if (raw == null || cachedAt == null) return null;

    try {
      final age = DateTime.now().millisecondsSinceEpoch - int.parse(cachedAt);
      if (age > _userCacheTtl.inMilliseconds) {
        await _storage.delete(key: _userKey);
        await _storage.delete(key: _userCachedAtKey);
        return null;
      }
      return UserModel.fromJson(jsonDecode(raw));
    } catch (_) {
      return null;
    }
  }

  Future<AuthResult> refreshToken() async {
    try {
      final refresh = await _storage.read(key: _refreshKey);
      if (refresh == null) return AuthResult.failure('No refresh token');
      final res = await http.post(
        Uri.parse('$_baseUrl/auth/refresh'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'refresh_token': refresh}),
      );
      final data = jsonDecode(res.body);
      if (res.statusCode == 200) {
        await saveTokens(
          token: data['token'],
          refreshToken: data['refresh_token'],
        );
        final user = UserModel.fromJson(data['user']);
        await _writeCachedUser(data['user']);
        return AuthResult.success(user);
      }
      await clearTokens();
      return AuthResult.failure(data['message'] ?? 'Session expired');
    } catch (e) {
      return AuthResult.failure(e.toString());
    }
  }

  Future<AuthResult> _exchangeAuth0AccessToken(String accessToken) async {
    try {
      final res = await http.post(
        Uri.parse('$_baseUrl/auth/auth0'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'access_token': accessToken}),
      );
      final data = jsonDecode(res.body);
      if (res.statusCode == 200) {
        await saveTokens(
          token: data['token'],
          refreshToken: data['refresh_token'],
        );
        final user = UserModel.fromJson(data['user']);
        await _writeCachedUser(data['user']);
        final isNewUser = data['is_new_user'] as bool? ?? false;
        return AuthResult.success(user, isNewUser: isNewUser);
      }
      return AuthResult.failure(data['message'] ?? 'Google sign-in failed');
    } catch (e) {
      return AuthResult.failure('Network error: ${e.toString()}');
    }
  }

  Future<void> _writeCachedUser(Map<String, dynamic> userData) async {
    await _storage.write(key: _userKey, value: jsonEncode(userData));
    await _storage.write(
      key: _userCachedAtKey,
      value: DateTime.now().millisecondsSinceEpoch.toString(),
    );
  }

  bool _isTokenExpired(String token) {
    try {
      final parts = token.split('.');
      if (parts.length != 3) return true;
      final normalized = base64Url.normalize(parts[1]);
      final payload = jsonDecode(
        utf8.decode(base64Url.decode(normalized)),
      ) as Map<String, dynamic>;
      final exp = payload['exp'];
      if (exp is! num) return true;
      final expiry = DateTime.fromMillisecondsSinceEpoch(
        exp.toInt() * 1000,
        isUtc: true,
      );
      return DateTime.now().toUtc().isAfter(expiry.subtract(
            const Duration(seconds: 30),
          ));
    } catch (_) {
      return true;
    }
  }

  String _extractErrorMessage(
    Map<String, dynamic> data,
    String fallback,
  ) {
    final message = data['message']?.toString().trim();
    final error = data['error']?.toString().trim();

    if (message != null && message.isNotEmpty && error != null && error.isNotEmpty) {
      return '$message: $error';
    }
    if (message != null && message.isNotEmpty) return message;
    if (error != null && error.isNotEmpty) return error;
    return fallback;
  }

  Future<AuthResult> requestOtp(String email, {String? username}) async {
    try {
      final res = await http.post(
        Uri.parse('$_baseUrl/auth/request-otp'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'email': email,
          if (username != null && username.trim().isNotEmpty)
            'username': username.trim(),
        }),
      );
      final data = jsonDecode(res.body);
      if (res.statusCode == 200) {
        return const AuthResult._(success: true);
      }
      return AuthResult.failure(
        _extractErrorMessage(data, 'Failed to send OTP'),
      );
    } catch (e) {
      return AuthResult.failure(e.toString());
    }
  }

  Future<AuthResult> verifyOtp(String email, String otp) async {
    try {
      final res = await http.post(
        Uri.parse('$_baseUrl/auth/verify-otp'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'email': email, 'otp': otp}),
      );
      final data = jsonDecode(res.body);
      if (res.statusCode == 200) {
        return const AuthResult._(success: true);
      }
      return AuthResult.failure(
        _extractErrorMessage(data, 'Verification failed'),
      );
    } catch (e) {
      return AuthResult.failure(e.toString());
    }
  }

  Future<AuthResult> forgotPassword(String email) async {
    try {
      final res = await http.post(
        Uri.parse('$_baseUrl/auth/forgot-password'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'email': email}),
      );
      final data = jsonDecode(res.body);
      if (res.statusCode == 200) {
        return const AuthResult._(success: true);
      }
      return AuthResult.failure(
        _extractErrorMessage(data, 'Failed to send reset code'),
      );
    } catch (e) {
      return AuthResult.failure(e.toString());
    }
  }

  Future<AuthResult> resetPassword(
      String email, String otp, String newPassword) async {
    try {
      final res = await http.post(
        Uri.parse('$_baseUrl/auth/reset-password'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'email': email,
          'otp': otp,
          'new_password': newPassword,
        }),
      );
      final data = jsonDecode(res.body);
      if (res.statusCode == 200) {
        return const AuthResult._(success: true);
      }
      return AuthResult.failure(
        _extractErrorMessage(data, 'Reset failed'),
      );
    } catch (e) {
      return AuthResult.failure(e.toString());
    }
  }

  Future<AuthResult> setInitialPassword(String password) async {
    try {
      final res = await authorizedRequest(
        method: 'POST',
        uri: Uri.parse('$_baseUrl/auth/set-initial-password'),
        body: {'password': password},
      );
      final data = jsonDecode(res.body);
      if (res.statusCode == 200) {
        return const AuthResult._(success: true);
      }
      return AuthResult.failure(data['message'] ?? 'Failed to set password');
    } catch (e) {
      return AuthResult.failure(e.toString());
    }
  }

  Future<AuthResult> changePassword(
      String oldPassword, String newPassword) async {
    try {
      final res = await authorizedRequest(
        method: 'POST',
        uri: Uri.parse('$_baseUrl/auth/change-password'),
        body: {
          'old_password': oldPassword,
          'new_password': newPassword,
        },
      );
      final data = jsonDecode(res.body);
      if (res.statusCode == 200) {
        return const AuthResult._(success: true);
      }
      return AuthResult.failure(data['message'] ?? 'Password change failed');
    } catch (e) {
      return AuthResult.failure(e.toString());
    }
  }

  Future<http.Response> _send({
    required String method,
    required Uri uri,
    Map<String, String>? headers,
    Object? body,
  }) async {
    final request = http.Request(method, uri);
    if (headers != null) {
      request.headers.addAll(headers);
    }
    if (body != null) {
      request.body = body is String ? body : jsonEncode(body);
    }
    final streamed = await request.send();
    return http.Response.fromStream(streamed);
  }
}

class AuthResult {
  final bool success;
  final bool launched;
  final UserModel? user;
  final String? error;
  final bool isNewUser;

  const AuthResult._({
    required this.success,
    this.launched = false,
    this.user,
    this.error,
    this.isNewUser = false,
  });

  factory AuthResult.success(UserModel user, {bool isNewUser = false}) =>
      AuthResult._(success: true, user: user, isNewUser: isNewUser);

  factory AuthResult.failure(String error) =>
      AuthResult._(success: false, error: error);

  factory AuthResult.launched(String message) => AuthResult._(
        success: false,
        launched: true,
        error: message,
      );
}
