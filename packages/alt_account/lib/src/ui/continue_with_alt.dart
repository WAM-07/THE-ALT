import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../client.dart';
import '../handoff.dart';

/// "Continue with ALT", like "Continue with Google": opens the ALT Account window (served by ALT
/// Core at `/core/account/`) over the app. The person signs in or registers there; the window then
/// opens `<app>://handoff?code=…`, which [AltHandoff.listen] already turns into a session. The app
/// never handles the password.
class AltAccountWindow {
  AltAccountWindow._();

  /// The window returns through the app's own link, so it needs a phone (Android or iOS). On the
  /// web and desktop the app keeps its built-in form.
  static bool get supported => !kIsWeb && (defaultTargetPlatform == TargetPlatform.android || defaultTargetPlatform == TargetPlatform.iOS);

  /// The window hands back `<app>://handoff?code=…&state=…`; the state tells the app it asked for it.
  static Uri url(AltAccountClient client, {bool signUp = false}) => Uri.parse('${client.apiUrl}/core/account/').replace(queryParameters: {
        'platform': client.platform.name,
        'mode': signUp ? 'signup' : 'signin',
        'return': 'app',
        'state': AltHandoff.expectHandoff(),
      });

  /// Opens the window in an in-app browser tab. False if no browser could open it.
  static Future<bool> open(AltAccountClient client, {bool signUp = false}) async {
    try {
      return await launchUrl(url(client, signUp: signUp), mode: LaunchMode.inAppBrowserView);
    } catch (_) {
      return false;
    }
  }
}

/// ALT's mark: three bars in the platforms' colours (ALTAR green, ALTERA orange, ink).
class AltMark extends StatelessWidget {
  const AltMark({super.key, this.height = 18, this.ink = const Color(0xFF15171A)});

  final double height;
  final Color ink;

  @override
  Widget build(BuildContext context) {
    Widget bar(Color c) => Container(width: height * 0.32, height: height, decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(height * 0.15)));
    return Row(mainAxisSize: MainAxisSize.min, children: [
      bar(const Color(0xFF1F9A5C)),
      SizedBox(width: height * 0.14),
      bar(const Color(0xFFF0802A)),
      SizedBox(width: height * 0.14),
      bar(ink),
    ]);
  }
}

/// The button every ALT app shows on its sign-in screen. Neutral on purpose: it belongs to ALT,
/// not to the app it sits in.
class ContinueWithAltButton extends StatelessWidget {
  const ContinueWithAltButton({super.key, required this.onPressed, this.label = 'Continue with ALT', this.busy = false});

  final VoidCallback? onPressed;
  final String label;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final bg = dark ? const Color(0xFFF4F3EF) : const Color(0xFF15171A);
    final fg = dark ? const Color(0xFF15171A) : const Color(0xFFF4F3EF);
    return SizedBox(
      width: double.infinity,
      height: 54,
      child: FilledButton(
        onPressed: busy ? null : onPressed,
        style: FilledButton.styleFrom(
          backgroundColor: bg,
          foregroundColor: fg,
          disabledBackgroundColor: bg.withValues(alpha: 0.6),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          textStyle: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700),
        ),
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          AltMark(height: 18, ink: fg),
          const SizedBox(width: 12),
          Flexible(child: Text(busy ? 'Waiting for ALT…' : label, overflow: TextOverflow.ellipsis)),
        ]),
      ),
    );
  }
}
