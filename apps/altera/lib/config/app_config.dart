import 'package:flutter/foundation.dart';

/// Where ALTERA finds THE ALT. Everything goes through the ALT gateway:
///   ALT Core (accounts)  -> $apiUrl/core
///   ALTERA API           -> $apiUrl/altera
///
/// Set with `flutter run --dart-define-from-file=env/dev.json` (written by `npm run dev`)
/// or `--dart-define=ALT_API_URL=http://<your-pc-lan-ip>:8080` for a physical phone.
class AppConfig {
  static const String _configuredApiUrl = String.fromEnvironment('ALT_API_URL', defaultValue: '');

  /// The ALT gateway. Android emulators reach the host PC at 10.0.2.2.
  static String get apiUrl {
    if (_configuredApiUrl.isNotEmpty) return _normalizeBaseUrl(_configuredApiUrl);
    if (kIsWeb) return 'http://localhost:8080';
    return 'http://10.0.2.2:8080';
  }

  /// ALTERA's own API (feed, posts, messages, ...).
  static String get baseUrl => '$apiUrl/altera';

  /// Socket.IO connects to the gateway origin; the path routes it to ALTERA.
  /// (A path in the URL would be treated as a Socket.IO namespace, so it goes in `path` instead.)
  static String get socketUrl => apiUrl;
  static const String socketPath = '/altera/socket.io';

  static const String geminiApiKey = String.fromEnvironment('GEMINI_KEY');

  static const String apiVersion = 'v1';

  /// Google sign-in is offered only when a Google OAuth client is configured for ALT Core.
  static const String googleServerClientId = String.fromEnvironment('GOOGLE_SERVER_CLIENT_ID', defaultValue: '');
  static bool get isGoogleSignInConfigured => googleServerClientId.isNotEmpty;

  static String resolveUrl(String? url) {
    if (url == null || url.isEmpty) return '';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
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
