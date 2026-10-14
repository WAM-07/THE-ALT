import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/alt/alt_session.dart';
import 'core/theme/app_theme.dart';
import 'core/theme/palettes.dart';
import 'shared/navigation/app_router.dart';
import 'core/storage/hive_setup.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await HiveSetup.init();
  // The theme chosen on this phone (Profile → Advanced → Theme), before the first frame.
  await AlterThemeController.load();
  // Loads the person's AI whenever someone signs in (and forgets it on sign-out).
  watchAltSession();
  runApp(const ProviderScope(child: AlterApp()));
  // Restores the ALT session in the background; the router shows a splash until it is done.
  restoreAltSession();
}

class AlterApp extends StatefulWidget {
  const AlterApp({super.key});

  @override
  State<AlterApp> createState() => _AlterAppState();
}

class _AlterAppState extends State<AlterApp> {
  final _messengerKey = GlobalKey<ScaffoldMessengerState>();

  /// A new theme: every screen reads its colours from `Ds`, so rebuild the whole tree (const widgets
  /// included), the way a hot reload does.
  void _retheme() {
    setState(() {});
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      void mark(Element e) {
        e.markNeedsBuild();
        e.visitChildren(mark);
      }

      (context as Element).visitChildren(mark);
    });
  }

  @override
  void dispose() {
    AlterThemeController.current.removeListener(_retheme);
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    AlterThemeController.current.addListener(_retheme);
    // Opened from ALTERA or ALTAR with "Open in ALTER": sign in as the same ALT account.
    altHandoff.listen(
      onSignedIn: (user) {
        goRouter.go('/');
        _messengerKey.currentState?.showSnackBar(SnackBar(content: Text('Signed in as @${user.handle}')));
      },
      onError: (e) => _messengerKey.currentState?.showSnackBar(SnackBar(content: Text(e.message))),
    );
    // The sign-in card lists the accounts used here, however they signed in.
    AltKnownAccounts.instance.track(altAccount);
    // Pushes while ALTER is closed (only when built with Firebase); tapping one opens the inbox.
    altPush.start(onOpen: (_) => goRouter.push('/inbox'));
    // "Continue with ALTER" in ALTERA: ask the person here, then sign ALTERA in.
    answerAltSignInRequests(
      altHandoff,
      context: () => goRouter.routerDelegate.navigatorKey.currentContext,
      onMessage: (m) => _messengerKey.currentState?.showSnackBar(SnackBar(content: Text(m))),
    );
    // New notifications pop up wherever the person is in the app.
    altInbox.incoming.listen((n) {
      _messengerKey.currentState?.showSnackBar(SnackBar(
        content: Text(n.title),
        action: SnackBarAction(label: 'View', onPressed: () => goRouter.push('/inbox')),
      ));
    });
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'ALTER',
      debugShowCheckedModeBanner: false,
      scaffoldMessengerKey: _messengerKey,
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      themeMode: ThemeMode.dark,
      routerConfig: goRouter,
      // Biometric unlock, when turned on in the Account Center.
      builder: (context, child) => AltAppLockGate(client: altAccount, child: child ?? const SizedBox.shrink()),
    );
  }
}
