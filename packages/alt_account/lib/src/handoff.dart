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

  void dispose() => _sub?.cancel();

  /// Extracts the code from `altera://handoff?code=X`, `alter://handoff?code=X` or `https://…/handoff?code=X`.
  static String? handoffCode(Uri uri) {
    final isHandoff = uri.host == 'handoff' || uri.pathSegments.contains('handoff');
    final code = uri.queryParameters['code'];
    return isHandoff && code != null && code.isNotEmpty ? code : null;
  }
}
