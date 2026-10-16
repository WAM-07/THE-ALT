import 'dart:async';
import 'dart:math';

import 'package:app_links/app_links.dart';
import 'package:flutter/foundation.dart';
import 'package:url_launcher/url_launcher.dart';

import 'client.dart';
import 'errors.dart';
import 'models.dart';

/// Whose ALT account a handoff link would sign this app into (read before the link is used).
typedef AltHandoffPreview = ({String handle, String displayName, String? avatarUrl});

/// Moves the signed-in person between ALT apps without asking for a password, like Meta's
/// Accounts Center. The sending app asks Core for a one-time code; the receiving app is opened
/// with `<scheme>://handoff?code=...` and exchanges the code for its own session.
///
/// A link the app asked for itself (the ALT Account window, or "Continue with ALTER") carries a
/// one-time `state` it recognises and goes straight through. Any other link ("Open in ALTERA" from
/// the other app, or one someone crafted) first shows whose account it is and waits for the person
/// to confirm, unless that account is already signed in here.
class AltHandoff {
  AltHandoff(this.client, {AppLinks? appLinks}) : _links = appLinks ?? AppLinks();

  final AltAccountClient client;
  final AppLinks _links;
  StreamSubscription<Uri>? _sub;
  StreamSubscription<Uri>? _requests;

  // States this app handed out and is waiting to see come back (shared by every AltHandoff in the app).
  static final Map<String, DateTime> _expected = {};
  static final Random _random = Random.secure();

  /// A one-time value for a handoff this app is about to ask for; the answer must carry it back.
  static String expectHandoff() {
    final now = DateTime.now();
    _expected.removeWhere((_, until) => until.isBefore(now));
    final state = List.generate(16, (_) => _random.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
    _expected[state] = now.add(const Duration(minutes: 15));
    return state;
  }

  /// Whether [state] is one this app handed out (each one works once).
  static bool consumeExpected(String? state) {
    if (state == null) return false;
    final until = _expected.remove(state);
    return until != null && until.isAfter(DateTime.now());
  }

  /// Opens [target] signed in as the current person. Returns false if the app isn't installed
  /// (the caller can then point to where to get it). [state] answers a request [target] made.
  Future<bool> open(AltPlatform target, {String? state}) async {
    final link = await client.handoffLink(target, state: state);
    final mode = link.scheme.startsWith('http') ? LaunchMode.externalApplication : LaunchMode.externalNonBrowserApplication;
    try {
      return await launchUrl(link, mode: mode);
    } catch (_) {
      return false;
    }
  }

  /// Starts listening for handoff links (including the one that launched the app).
  /// [onSignedIn] runs after a successful handoff; [onError] when the link was stale or used.
  /// [confirm] asks the person about a link this app didn't ask for (see `showAltHandoffConfirmSheet`);
  /// without it such links are refused.
  void listen({
    required void Function(AltUser user) onSignedIn,
    void Function(AltApiException error)? onError,
    Future<bool> Function(AltHandoffPreview who)? confirm,
  }) {
    _sub ??= _links.uriLinkStream.listen((uri) async {
      final code = handoffCode(uri);
      if (code == null) return;
      try {
        if (!consumeExpected(uri.queryParameters['state'])) {
          final who = await client.peekHandoff(code);
          final current = client.currentUser.value;
          // Already signed in as that account: nothing to change.
          if (current != null && current.handle.toLowerCase() == who.handle.toLowerCase()) {
            onSignedIn(current);
            return;
          }
          if (confirm == null || !await confirm(who)) return;
        }
        onSignedIn(await client.redeemHandoff(code));
      } on AltApiException catch (e) {
        onError?.call(e);
      } catch (e) {
        debugPrint('handoff failed: $e');
      }
    }, onError: (Object e) => debugPrint('handoff links unavailable: $e'));
  }

  /// Asks [from] (another ALT app on this phone) to sign this app in with its account, like "Continue
  /// with Google": opens `<from>://signin-request?for=<this app>&state=…`. That app asks the person to
  /// confirm and answers with the usual handoff link carrying the same state, which [listen] accepts.
  /// False if [from] isn't installed.
  Future<bool> requestFrom(AltPlatform from) async {
    final state = expectHandoff();
    try {
      return await launchUrl(Uri.parse('${from.name}://signin-request?for=${client.platform.name}&state=$state'), mode: LaunchMode.externalNonBrowserApplication);
    } catch (_) {
      return false;
    }
  }

  /// Answers [requestFrom]: [onRequest] runs with the app asking and its state. It should ask the
  /// person (see `showAltShareSignInSheet`) and then call [open] for that app with the state; nothing
  /// is shared without that.
  void listenForSignInRequests(void Function(AltPlatform target, String? state) onRequest) {
    _requests ??= _links.uriLinkStream.listen((uri) {
      final target = signInRequestTarget(uri);
      if (target != null) onRequest(target, uri.queryParameters['state']);
    }, onError: (Object e) => debugPrint('sign-in requests unavailable: $e'));
  }

  void dispose() {
    _sub?.cancel();
    _requests?.cancel();
  }

  /// The ALT phone app named by `<scheme>://signin-request?for=altera`, or null.
  static AltPlatform? signInRequestTarget(Uri uri) {
    if (uri.host != 'signin-request') return null;
    return switch (uri.queryParameters['for']) {
      'alter' => AltPlatform.alter,
      'altera' => AltPlatform.altera,
      _ => null,
    };
  }

  /// The other ALT phone app this one can borrow a sign-in from, if any.
  static AltPlatform? partnerOf(AltPlatform app) => switch (app) {
        AltPlatform.alter => AltPlatform.altera,
        AltPlatform.altera => AltPlatform.alter,
        _ => null,
      };

  /// Extracts the code from `altera://handoff?code=X`, `alter://handoff?code=X` or `https://…/handoff?code=X`.
  static String? handoffCode(Uri uri) {
    final isHandoff = uri.host == 'handoff' || uri.pathSegments.contains('handoff');
    final code = uri.queryParameters['code'];
    return isHandoff && code != null && code.isNotEmpty ? code : null;
  }
}
