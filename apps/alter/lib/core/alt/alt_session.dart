import 'package:alt_account/alt_account.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

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

/// The ALT inbox (security alerts, news about the AI), live while someone is signed in.
final AltInbox altInbox = AltInbox(altAccount);

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

/// `error`: ALT Core could not be reached, so we do not know yet whether the person has an AI.
enum AiPhase { unknown, loading, none, exists, error }

/// Whether the signed-in person already has a personal AI (loaded from ALT Core after sign-in).
final ValueNotifier<AiPhase> aiPhase = ValueNotifier<AiPhase>(AiPhase.unknown);

/// The AI ALTER is working on (one the person owns), kept fresh by screens that change it.
final ValueNotifier<AltAi?> currentAi = ValueNotifier<AltAi?>(null);

/// Every AI on the person's ALT account: owned, rented and subscribed, as in ALTERA and ALTAR.
final ValueNotifier<List<AccountAi>?> accountAis = ValueNotifier<List<AccountAi>?>(null);

/// The AI the person last chose, remembered per account.
String _chosenAiKey() => 'alter.currentAiId.${altAccount.currentUser.value?.id}';

Future<void> loadAccountAis() async {
  try {
    accountAis.value = await aiApi.accountAis();
  } catch (_) {
    accountAis.value ??= const [];
  }
}

Future<void> loadMyAi() async {
  aiPhase.value = AiPhase.loading;
  try {
    final results = await Future.wait([aiApi.myAis(), loadAccountAis()]);
    final list = results[0] as List<AltAi>;
    // The AI chosen last time; otherwise the one the person made themselves; otherwise the first.
    String? chosen;
    try {
      chosen = (await SharedPreferences.getInstance()).getString(_chosenAiKey());
    } catch (_) {}
    final made = (accountAis.value ?? const <AccountAi>[]).where((a) => a.owned && a.created).map((a) => a.id).toSet();
    final pick = list.where((a) => a.id == chosen).firstOrNull ?? list.where((a) => made.contains(a.id)).firstOrNull ?? list.firstOrNull;
    currentAi.value = pick == null ? null : await aiApi.get(pick.id);
    aiPhase.value = list.isEmpty ? AiPhase.none : AiPhase.exists;
  } catch (_) {
    // Offline or server trouble. Never treat that as "no AI": onboarding would create a second one.
    aiPhase.value = currentAi.value == null ? AiPhase.error : AiPhase.exists;
  }
}

/// Makes another AI the person owns the one ALTER works on (teaching, memories, versions).
Future<void> switchAi(String id) async {
  currentAi.value = await aiApi.get(id);
  try {
    await (await SharedPreferences.getInstance()).setString(_chosenAiKey(), id);
  } catch (_) {}
}

Future<AltAi?> refreshCurrentAi() async {
  final ai = currentAi.value;
  if (ai == null) return null;
  currentAi.value = await aiApi.get(ai.id);
  return currentAi.value;
}

/// Keeps the AI state in step with sign-in and sign-out.
/// Signing out, or another account signing in over this one (an ALT handoff link), starts afresh.
void watchAltSession() {
  String? lastUserId = altAccount.currentUser.value?.id;
  altAccount.currentUser.addListener(() {
    final id = altAccount.currentUser.value?.id;
    if (id != lastUserId) {
      lastUserId = id;
      currentAi.value = null;
      accountAis.value = null;
      aiPhase.value = AiPhase.unknown;
    }
    if (id != null && aiPhase.value == AiPhase.unknown) loadMyAi();
  });
}
