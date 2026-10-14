import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:go_router/go_router.dart';

import '../../core/alt/alt_session.dart';
import '../../features/ai_profile/screens/ai_profile_screen.dart';
import '../../features/ai_profile/screens/memories_screen.dart';
import '../../features/ai_profile/screens/versions_screen.dart';
import '../../features/auth/screens/auth_screen.dart';
import '../../features/dataset/screens/dataset_screen.dart';
import '../../features/onboarding/screens/onboarding_screen.dart';
import '../../features/persona_interface/screens/chat_screen.dart';
import '../../features/persona_interface/screens/home_screen.dart';
import '../../features/settings/screens/settings_screen.dart';
import '../../features/training_manager/screens/training_screen.dart';
import '../../features/your_ais/account_ai_screen.dart';
import '../../features/your_ais/talk_screen.dart';
import '../../features/your_ais/your_ais_screen.dart';
import '../ui/ui.dart';
import '../widgets/offline_screen.dart';
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
    case AiPhase.error:
      return loc == '/offline' || loc == '/account' ? null : '/offline';
    case AiPhase.none:
      // Without an AI of their own, someone may still rent or subscribe to one: show those first.
      if ((accountAis.value ?? const []).isNotEmpty) {
        const open = {'/yours', '/onboarding', '/account', '/inbox'};
        return open.contains(loc) || loc.startsWith('/talk/') || loc.startsWith('/held/') ? null : '/yours';
      }
      return loc == '/onboarding' || loc == '/account' ? null : '/onboarding';
    case AiPhase.exists:
      if (loc == '/auth' || loc == '/splash' || loc == '/' || loc == '/onboarding' || loc == '/offline') return '/home';
      return null;
  }
}

final goRouter = GoRouter(
  navigatorKey: _rootNavigatorKey,
  initialLocation: '/splash',
  // Re-run the guard on sign-in/out and once the person's AI has been loaded.
  refreshListenable: Listenable.merge([altAccount.currentUser, altSessionReady, aiPhase, accountAis]),
  redirect: _guard,
  routes: [
    GoRoute(path: '/', builder: (context, state) => const SizedBox.shrink()),
    GoRoute(
      path: '/splash',
      builder: (context, state) => Backdrop(
        intensity: 0.9,
        child: Center(
          child: const AlterMark(size: 72)
              .animate(onPlay: (c) => c.repeat(reverse: true))
              .scale(begin: const Offset(0.94, 0.94), end: const Offset(1.04, 1.04), duration: 1100.ms, curve: Curves.easeInOut),
        ),
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
    GoRoute(path: '/offline', builder: (context, state) => const OfflineScreen()),
    // The personal AI's profile, memories and versions.
    GoRoute(
      path: '/ai',
      parentNavigatorKey: _rootNavigatorKey,
      builder: (context, state) => const AiProfileScreen(),
      routes: [
        GoRoute(path: 'memories', parentNavigatorKey: _rootNavigatorKey, builder: (context, state) => const MemoriesScreen()),
        GoRoute(path: 'versions', parentNavigatorKey: _rootNavigatorKey, builder: (context, state) => const VersionsScreen()),
      ],
    ),
    // Every AI on the ALT account, and talking to the ones the person rents or subscribes to.
    GoRoute(path: '/yours', parentNavigatorKey: _rootNavigatorKey, builder: (context, state) => const YourAisScreen()),
    GoRoute(path: '/held/:id', parentNavigatorKey: _rootNavigatorKey, builder: (context, state) => AccountAiScreen(aiId: state.pathParameters['id']!)),
    GoRoute(path: '/talk/:id', parentNavigatorKey: _rootNavigatorKey, builder: (context, state) => TalkScreen(aiId: state.pathParameters['id']!)),
    // The ALT inbox, shared by every ALT app (Module 2).
    GoRoute(
      path: '/inbox',
      parentNavigatorKey: _rootNavigatorKey,
      builder: (context, state) => AltInboxScreen(
        inbox: altInbox,
        onOpen: (n) {
          final link = n.link;
          if (link != null && link.startsWith('alter://')) context.go('/${link.substring('alter://'.length)}');
        },
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
