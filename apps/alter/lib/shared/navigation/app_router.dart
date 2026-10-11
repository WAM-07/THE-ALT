import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:hive/hive.dart';
import 'scaffold_with_nav_bar.dart';

import '../../core/alt/alt_session.dart';
import '../../core/models/persona.dart';
import '../../core/theme/colors.dart';
import '../../features/auth/screens/auth_screen.dart';

import '../../features/persona_interface/screens/home_screen.dart';
import '../../features/training_manager/screens/training_screen.dart';
import '../../features/training_manager/screens/simulated_training_screen.dart';
import '../../features/dataset/screens/dataset_screen.dart';
import '../../features/settings/screens/settings_screen.dart';
import '../../features/onboarding/screens/onboarding_screen.dart';

final GlobalKey<NavigatorState> _rootNavigatorKey = GlobalKey<NavigatorState>(debugLabel: 'root');
final GlobalKey<NavigatorState> _homeNavigatorKey = GlobalKey<NavigatorState>(debugLabel: 'home');
final GlobalKey<NavigatorState> _trainingNavigatorKey = GlobalKey<NavigatorState>(debugLabel: 'training');
final GlobalKey<NavigatorState> _datasetNavigatorKey = GlobalKey<NavigatorState>(debugLabel: 'dataset');
final GlobalKey<NavigatorState> _settingsNavigatorKey = GlobalKey<NavigatorState>(debugLabel: 'settings');

/// Signed out → sign in. Signed in → onboarding until a persona exists, then home.
String? _guard(BuildContext context, GoRouterState state) {
  final loc = state.matchedLocation;
  if (!altSessionReady.value) return loc == '/splash' ? null : '/splash';
  if (!altAccount.isSignedIn) return loc == '/auth' ? null : '/auth';
  if (loc == '/auth' || loc == '/splash' || loc == '/') {
    final hasPersona = Hive.box<Persona>('personaBox').get('current_user') != null;
    return hasPersona ? '/home' : '/onboarding';
  }
  return null;
}

final goRouter = GoRouter(
  navigatorKey: _rootNavigatorKey,
  initialLocation: '/splash',
  // Re-run the guard whenever the person signs in or out (in this app, or remotely).
  refreshListenable: Listenable.merge([altAccount.currentUser, altSessionReady]),
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
    GoRoute(
      path: '/onboarding',
      builder: (context, state) => const OnboardingScreen(),
    ),
    GoRoute(
      path: '/simulate_training',
      parentNavigatorKey: _rootNavigatorKey,
      builder: (context, state) => const SimulatedTrainingScreen(),
    ),
    StatefulShellRoute.indexedStack(
      builder: (context, state, navigationShell) {
        return ScaffoldWithNavBar(navigationShell: navigationShell);
      },
      branches: [
        StatefulShellBranch(
          navigatorKey: _homeNavigatorKey,
          routes: [
            GoRoute(
              path: '/home',
              builder: (context, state) => const HomeScreen(),
            ),
          ],
        ),
        StatefulShellBranch(
          navigatorKey: _trainingNavigatorKey,
          routes: [
            GoRoute(
              path: '/training',
              builder: (context, state) => const TrainingScreen(),
            ),
          ],
        ),
        StatefulShellBranch(
          navigatorKey: _datasetNavigatorKey,
          routes: [
            GoRoute(
              path: '/dataset',
              builder: (context, state) => const DatasetScreen(),
            ),
          ],
        ),
        StatefulShellBranch(
          navigatorKey: _settingsNavigatorKey,
          routes: [
            GoRoute(
              path: '/settings',
              builder: (context, state) => const SettingsScreen(),
            ),
          ],
        ),
      ],
    ),
  ],
);
