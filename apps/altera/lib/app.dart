import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'theme/app_theme.dart';
import 'router/app_router.dart';

import 'providers/auth_provider.dart';
import 'providers/theme_provider.dart';

class AlteraApp extends ConsumerStatefulWidget {
  const AlteraApp({super.key});

  @override
  ConsumerState<AlteraApp> createState() => _AlteraAppState();
}

class _AlteraAppState extends ConsumerState<AlteraApp> {
  final _messengerKey = GlobalKey<ScaffoldMessengerState>();

  @override
  void initState() {
    super.initState();
    // Opened from ALTER or ALTAR with "Open in ALTERA": sign in as the same ALT account, no password.
    ref.read(authServiceProvider).handoff.listen(
      onSignedIn: (user) async {
        final result = await ref.read(authStateProvider.notifier).adoptSession();
        if (result.success) {
          ref.read(routerProvider).go('/feed');
          _messengerKey.currentState?.showSnackBar(SnackBar(content: Text('Signed in as @${user.handle}')));
        }
      },
      onError: (e) => _messengerKey.currentState?.showSnackBar(SnackBar(content: Text(e.message))),
    );
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);
    final themeMode = ref.watch(themeProvider);

    return MaterialApp.router(
      title: 'ALTERA',
      debugShowCheckedModeBanner: false,
      scaffoldMessengerKey: _messengerKey,
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      themeMode: themeMode,
      routerConfig: router,
    );
  }
}
