import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/alt/alt_session.dart';
import 'core/theme/app_theme.dart';
import 'shared/navigation/app_router.dart';
import 'core/storage/hive_setup.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await HiveSetup.init();
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

  @override
  void initState() {
    super.initState();
    // Opened from ALTERA or ALTAR with "Open in ALTER": sign in as the same ALT account.
    altHandoff.listen(
      onSignedIn: (user) {
        goRouter.go('/');
        _messengerKey.currentState?.showSnackBar(SnackBar(content: Text('Signed in as @${user.handle}')));
      },
      onError: (e) => _messengerKey.currentState?.showSnackBar(SnackBar(content: Text(e.message))),
    );
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'ALTER',
      debugShowCheckedModeBanner: false,
      scaffoldMessengerKey: _messengerKey,
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      themeMode: ThemeMode.system,
      routerConfig: goRouter,
    );
  }
}
