import 'package:alt_account/alt_account.dart';
import 'package:flutter/foundation.dart';

import 'ai_api.dart';

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

// ---------------------------------------------------------------- the person's AI

enum AiPhase { unknown, loading, none, exists }

/// Whether the signed-in person already has a personal AI (loaded from ALT Core after sign-in).
final ValueNotifier<AiPhase> aiPhase = ValueNotifier<AiPhase>(AiPhase.unknown);

/// The person's AI, kept fresh by screens that change it.
final ValueNotifier<AltAi?> currentAi = ValueNotifier<AltAi?>(null);

Future<void> loadMyAi() async {
  aiPhase.value = AiPhase.loading;
  try {
    final list = await aiApi.myAis();
    currentAi.value = list.isEmpty ? null : await aiApi.get(list.first.id);
    aiPhase.value = list.isEmpty ? AiPhase.none : AiPhase.exists;
  } catch (_) {
    // Offline or server trouble: let the person in; screens retry and show errors.
    aiPhase.value = currentAi.value == null ? AiPhase.none : AiPhase.exists;
  }
}

Future<AltAi?> refreshCurrentAi() async {
  final ai = currentAi.value;
  if (ai == null) return null;
  currentAi.value = await aiApi.get(ai.id);
  return currentAi.value;
}

/// Keeps the AI state in step with sign-in and sign-out.
void watchAltSession() {
  altAccount.currentUser.addListener(() {
    if (altAccount.currentUser.value == null) {
      currentAi.value = null;
      aiPhase.value = AiPhase.unknown;
    } else if (aiPhase.value == AiPhase.unknown) {
      loadMyAi();
    }
  });
}
