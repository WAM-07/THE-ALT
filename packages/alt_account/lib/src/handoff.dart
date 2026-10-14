import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/foundation.dart';
import 'package:url_launcher/url_launcher.dart';

import 'client.dart';
import 'errors.dart';
import 'models.dart';

/// Moves the signed-in person between ALT apps without asking for a password, like Meta's
/// Accounts Center. The sending app asks Core for a one-time code; the receiving app is opened
/// with `<scheme>://handoff?code=...` and exchanges the code for its own session.
class AltHandoff {
  AltHandoff(this.client, {AppLinks? appLinks}) : _links = appLinks ?? AppLinks();

  final AltAccountClient client;
  final AppLinks _links;
  StreamSubscription<Uri>? _sub;
  StreamSubscription<Uri>? _requests;

  /// Opens [target] signed in as the current person. Returns false if the app isn't installed
  /// (the caller can then point to where to get it).
  Future<bool> open(AltPlatform target) async {
    final link = await client.handoffLink(target);
    final mode = link.scheme.startsWith('http') ? LaunchMode.externalApplication : LaunchMode.externalNonBrowserApplication;
    try {
      return await launchUrl(link, mode: mode);
    } catch (_) {
      return false;
    }
  }

  /// Starts listening for handoff links (including the one that launched the app).
  /// [onSignedIn] runs after a successful handoff; [onError] when the link was stale or used.
  void listen({required void Function(AltUser user) onSignedIn, void Function(AltApiException error)? onError}) {
    _sub ??= _links.uriLinkStream.listen((uri) async {
      final code = handoffCode(uri);
      if (code == null) return;
      try {
        onSignedIn(await client.redeemHandoff(code));
      } on AltApiException catch (e) {
        onError?.call(e);
      } catch (e) {
        debugPrint('handoff failed: $e');
      }
    }, onError: (Object e) => debugPrint('handoff links unavailable: $e'));
  }

  /// Asks [from] (another ALT app on this phone) to sign this app in with its account, like "Continue
  /// with Google": opens `<from>://signin-request?for=<this app>`. That app asks the person to confirm
  /// and answers with the usual handoff link, which [listen] turns into a session. False if [from]
  /// isn't installed.
  Future<bool> requestFrom(AltPlatform from) async {
    try {
      return await launchUrl(Uri.parse('${from.name}://signin-request?for=${client.platform.name}'), mode: LaunchMode.externalNonBrowserApplication);
    } catch (_) {
      return false;
    }
  }

  /// Answers [requestFrom]: [onRequest] runs with the app asking. It should ask the person (see
  /// `showAltShareSignInSheet`) and then call [open] for that app; nothing is shared without that.
  void listenForSignInRequests(void Function(AltPlatform target) onRequest) {
    _requests ??= _links.uriLinkStream.listen((uri) {
      final target = signInRequestTarget(uri);
      if (target != null) onRequest(target);
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
