import 'package:flutter/foundation.dart';

class AppConfig {
  static const String _configuredApiUrl =
      String.fromEnvironment('API_URL', defaultValue: '');
  static const String _configuredSocketUrl =
      String.fromEnvironment('SOCKET_URL', defaultValue: '');

  static String get baseUrl {
    final url = _configuredApiUrl.isNotEmpty
        ? _configuredApiUrl
        : (kReleaseMode
            ? 'https://altera-d57k.onrender.com'
            : 'https://altera-d57k.onrender.com');
    return _normalizeBaseUrl(url);
  }

  static String get socketUrl {
    final url =
        _configuredSocketUrl.isNotEmpty ? _configuredSocketUrl : baseUrl;
    return _normalizeBaseUrl(url);
  }

  static const String geminiApiKey = String.fromEnvironment('GEMINI_KEY');

  static const String apiVersion = 'v1';

  static const String auth0Domain = String.fromEnvironment(
    'AUTH0_DOMAIN',
    defaultValue: 'dev-5ntz6q1ho6k7jxdg.us.auth0.com',
  );
  static const String auth0ClientId = String.fromEnvironment(
    'AUTH0_CLIENT_ID',
    defaultValue: 'kMym7cX1CX6jNjMao6iJ4prKhB9bBPDN',
  );
  // Never ship a client secret in an app; Auth0 is being replaced by ALT Core sign-in.
  static const String auth0ClientSecret = String.fromEnvironment(
    'AUTH0_CLIENT_SECRET',
    defaultValue: '',
  );
  static const String auth0Audience = String.fromEnvironment(
    'AUTH0_AUDIENCE',
    defaultValue: 'https://dev-5ntz6q1ho6k7jxdg.us.auth0.com/api/v2/',
  );
  static const String auth0RedirectUrl = String.fromEnvironment(
    'AUTH0_REDIRECT_URL',
    defaultValue:
        'altera://dev-5ntz6q1ho6k7jxdg.us.auth0.com/android/com.alteraapp.altera_app/callback',
  );

  static String get auth0LogoutUrl {
    const envUrl = String.fromEnvironment('AUTH0_LOGOUT_URL', defaultValue: '');
    return envUrl.isNotEmpty ? envUrl : auth0AndroidRedirectUrl;
  }

  static const String auth0Scheme = String.fromEnvironment(
    'AUTH0_SCHEME',
    defaultValue: 'altera',
  );

  static const String auth0AndroidPackageName = 'com.alteraapp.altera_app';
  static String get auth0AndroidRedirectUrl =>
      '$auth0Scheme://$auth0Domain/android/$auth0AndroidPackageName/callback';

  static bool get isAuth0Configured {
    final bothSet = auth0Domain.isNotEmpty && auth0ClientId.isNotEmpty;
    final neitherSet = auth0Domain.isEmpty && auth0ClientId.isEmpty;
    assert(
      bothSet || neitherSet,
      'Auth0 domain and client ID must both be set or both be empty.',
    );
    return bothSet;
  }

  static String resolveUrl(String? url) {
    if (url == null || url.isEmpty) return '';
    if (url.startsWith('http://') ||
        url.startsWith('https://') ||
        url.startsWith('data:')) {
      return url;
    }
    return '$baseUrl$url';
  }

  static String _normalizeBaseUrl(String url) {
    if (url.endsWith('/')) {
      return url.substring(0, url.length - 1);
    }
    return url;
  }
}
