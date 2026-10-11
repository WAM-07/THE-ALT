import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/alt/alt_session.dart';
import '../../core/theme/colors.dart';
import '../../features/auth/screens/auth_screen.dart';
import '../../features/dataset/screens/dataset_screen.dart';
import '../../features/onboarding/screens/onboarding_screen.dart';
import '../../features/persona_interface/screens/chat_screen.dart';
import '../../features/persona_interface/screens/home_screen.dart';
import '../../features/settings/screens/settings_screen.dart';
import '../../features/training_manager/screens/training_screen.dart';
import 'scaffold_with_nav_bar.dart';

final GlobalKey<NavigatorState> _rootNavigatorKey = GlobalKey<NavigatorState>(debugLabel: 'root');

/// Signed out → sign in. Signed in without an AI → onboarding creates one. Otherwise the app.
String? _guard(BuildContext context, GoRouterState state) {
  final loc = state.matchedLocation;
  if (!altSessionReady.value) return loc == '/splash' ? null : '/splash';
  if (!altAccount.isSignedIn) return loc == '/auth' ? null : '/auth';
  switch (aiPhase.value) {
    case AiPhase.unknown:
    case AiPhase.loading:
      return loc == '/splash' ? null : '/splash';
    case AiPhase.none:
      return loc == '/onboarding' || loc == '/account' ? null : '/onboarding';
    case AiPhase.exists:
      if (loc == '/auth' || loc == '/splash' || loc == '/' || loc == '/onboarding') return '/home';
      return null;
  }
}

final goRouter = GoRouter(
  navigatorKey: _rootNavigatorKey,
  initialLocation: '/splash',
  // Re-run the guard on sign-in/out and once the person's AI has been loaded.
  refreshListenable: Listenable.merge([altAccount.currentUser, altSessionReady, aiPhase]),
  redirect: _guard,
  routes: [
    GoRoute(path: '/', builder: (context, state) => const SizedBox.shrink()),
    GoRoute(
      path: '/splash',
      builder: (context, state) => const Scaffold(
        body: Center(child: CircularProgressIndicator(color: ALTColors.irisViolet)),
      ),
    ),
    GoRoute(path: '/auth', builder: (context, state) => const AuthScreen()),
    GoRoute(path: '/onboarding', builder: (context, state) => const OnboardingScreen()),
    // The ALT Account Center (shared with ALTERA and ALTAR).
    GoRoute(
      path: '/account',
      parentNavigatorKey: _rootNavigatorKey,
      builder: (context, state) => AltAccountCenterScreen(
        client: altAccount,
        handoff: altHandoff,
        onSignedOut: () => context.go('/auth'),
      ),
    ),
    StatefulShellRoute.indexedStack(
      builder: (context, state, navigationShell) => ScaffoldWithNavBar(navigationShell: navigationShell),
      branches: [
        StatefulShellBranch(routes: [GoRoute(path: '/home', builder: (context, state) => const HomeScreen())]),
        StatefulShellBranch(routes: [GoRoute(path: '/chat', builder: (context, state) => const ChatScreen())]),
        StatefulShellBranch(routes: [GoRoute(path: '/dataset', builder: (context, state) => const DatasetScreen())]),
        StatefulShellBranch(routes: [GoRoute(path: '/training', builder: (context, state) => const TrainingScreen())]),
        StatefulShellBranch(routes: [GoRoute(path: '/settings', builder: (context, state) => const SettingsScreen())]),
      ],
    ),
  ],
);
