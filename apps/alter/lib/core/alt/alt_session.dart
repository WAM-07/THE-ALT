import 'package:alt_account/alt_account.dart';
import 'package:flutter/foundation.dart';

/// Where ALTER finds THE ALT. Set with `flutter run --dart-define-from-file=env/dev.json`
/// (written by `npm run dev`) or `--dart-define=ALT_API_URL=http://<pc-lan-ip>:8080` on a phone.
class AltConfig {
  static const String _configured = String.fromEnvironment('ALT_API_URL', defaultValue: '');

  static String get apiUrl {
    if (_configured.isNotEmpty) return _configured.endsWith('/') ? _configured.substring(0, _configured.length - 1) : _configured;
    return kIsWeb ? 'http://localhost:8080' : 'http://10.0.2.2:8080';
  }
}

/// The person's ALT account, shared with ALTERA and ALTAR. One instance for the whole app.
final AltAccountClient altAccount = AltAccountClient(
  apiUrl: AltConfig.apiUrl,
  platform: AltPlatform.alter,
  deviceName: 'ALTER app',
);

/// Opens ALTERA / ALTAR already signed in, and receives `alter://handoff?code=...` links.
final AltHandoff altHandoff = AltHandoff(altAccount);

/// Becomes true once the saved session has been restored (or found missing) at start-up.
final ValueNotifier<bool> altSessionReady = ValueNotifier<bool>(false);

Future<void> restoreAltSession() async {
  try {
    await altAccount.restore();
  } finally {
    altSessionReady.value = true;
  }
}
