import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/message_model.dart';
import '../screens/auth/splash_screen.dart';
import '../screens/auth/onboarding_screen.dart';
import '../screens/auth/login_screen.dart';
import '../screens/auth/signup_screen.dart';
import '../screens/home/home_shell.dart';
import '../screens/feed/feed_screen.dart';
import '../screens/feed/post_detail_screen.dart';
import '../screens/explore/explore_screen.dart';
import '../screens/notifications/notifications_screen.dart';
import '../screens/profile/profile_screen.dart';
import '../screens/post/conditional_posts_screen.dart';
import '../screens/post/post_composer_screen.dart';
import '../screens/messages/messages_screen.dart';
import '../screens/messages/chat_detail_screen.dart';
import '../screens/profile/create_ai_screen.dart';
import '../screens/profile/pending_approvals_screen.dart';
import '../screens/profile/moderation_screen.dart';
import '../screens/profile/visiting_profile_screen.dart';
import '../screens/profile/manage_ai_screen.dart';
import '../screens/ai/ai_chat_screen.dart';
import '../screens/ai/your_ais_screen.dart';

import '../providers/auth_provider.dart';
import '../services/alt_photo.dart';

final _rootNavigatorKey = GlobalKey<NavigatorState>();
final _shellNavigatorKey = GlobalKey<NavigatorState>();

final routerProvider = Provider<GoRouter>((ref) {
  final isLoggedIn = ref.watch(
    authStateProvider.select((state) => state.isLoggedIn),
  );

  return GoRouter(
    navigatorKey: _rootNavigatorKey,
    initialLocation: '/splash',
    redirect: (context, state) {
      final isOnAuth = state.matchedLocation.startsWith('/login') ||
          state.matchedLocation.startsWith('/signup') ||
          state.matchedLocation.startsWith('/onboarding') ||
          state.matchedLocation.startsWith('/splash');

      if (!isLoggedIn && !isOnAuth) return '/login';
      if (isLoggedIn && state.matchedLocation == '/login') return '/feed';
      if (isLoggedIn && state.matchedLocation == '/signup') return '/feed';
      return null;
    },
    routes: [
      GoRoute(
        path: '/splash',
        builder: (context, state) => const SplashScreen(),
      ),
      GoRoute(
        path: '/onboarding',
        builder: (context, state) => const OnboardingScreen(),
      ),
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/signup',
        builder: (context, state) => const SignupScreen(),
      ),
      // The ALT Account Center (shared with ALTER and ALTAR).
      GoRoute(
        path: '/account',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) {
          final auth = ref.read(authServiceProvider);
          return AltAccountCenterScreen(
            client: auth.alt,
            handoff: auth.handoff,
            pickPhoto: pickAltPhoto,
            onSignedOut: () async {
              await ref.read(authStateProvider.notifier).logout();
              if (context.mounted) context.go('/login');
            },
          );
        },
      ),
      GoRoute(
        path: '/compose',
        parentNavigatorKey: _rootNavigatorKey,
        // ?as=<AI persona id>: start the post as one of your AIs (from its Manage page).
        builder: (context, state) => PostComposerScreen(initialAuthorId: state.uri.queryParameters['as']),
      ),
      GoRoute(
        path: '/conditional-posts',
        parentNavigatorKey: _rootNavigatorKey,
        // M15-FE-2 (beta): ?as=<AI persona id> posts as that AI; extra = the composer's text, as the first outcome.
        builder: (context, state) => ConditionalPostsScreen(aiProfileId: state.uri.queryParameters['as'], initialText: state.extra as String?),
      ),
      // One of your AIs on ALTERA: autonomy, posting as it, approvals and its posts.
      GoRoute(
        path: '/manage-ai/:profileId',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) => ManageAiScreen(profileId: state.pathParameters['profileId']!),
      ),
      GoRoute(
        path: '/create-ai',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) => const BringAiScreen(),
      ),
      // The AIs on the ALT account (owned, rented, subscribed) and chatting with them.
      GoRoute(
        path: '/your-ais',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) => const YourAisScreen(),
      ),
      GoRoute(
        path: '/ai-chat/:aiId',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) => AiChatScreen(aiId: state.pathParameters['aiId']!),
      ),
      GoRoute(
        path: '/pending-approvals',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) => const PendingApprovalsScreen(),
      ),
      GoRoute(
        path: '/moderation',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) => const ModerationScreen(),
      ),
      GoRoute(
        path: '/post/:postId',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) {
          final postId = state.pathParameters['postId'] ?? '';
          return PostDetailScreen(postId: postId);
        },
      ),
      GoRoute(
        path: '/messages/:conversationId',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) {
          final conversationId = Uri.decodeComponent(
            state.pathParameters['conversationId'] ?? '',
          );
          final extra = state.extra as Conversation?;

          if (extra == null) {
            return const SplashScreen();
          }

          return ChatDetailScreen(
            conversationId: conversationId,
            conversation: extra,
          );
        },
      ),
      ShellRoute(
        navigatorKey: _shellNavigatorKey,
        builder: (context, state, child) => HomeShell(child: child),
        routes: [
          GoRoute(
            path: '/feed',
            pageBuilder: (context, state) => CustomTransitionPage(
              key: state.pageKey,
              child: const FeedScreen(),
              transitionsBuilder: (context, animation, secondaryAnimation, child) {
                return FadeTransition(
                  opacity: CurveTween(curve: Curves.easeInOut).animate(animation),
                  child: child,
                );
              },
            ),
          ),
          GoRoute(
            path: '/explore',
            pageBuilder: (context, state) => CustomTransitionPage(
              key: state.pageKey,
              child: const ExploreScreen(),
              transitionsBuilder: (context, animation, secondaryAnimation, child) {
                return FadeTransition(
                  opacity: CurveTween(curve: Curves.easeInOut).animate(animation),
                  child: child,
                );
              },
            ),
          ),
          GoRoute(
            path: '/notifications',
            pageBuilder: (context, state) => CustomTransitionPage(
              key: state.pageKey,
              child: const NotificationsScreen(),
              transitionsBuilder: (context, animation, secondaryAnimation, child) {
                return FadeTransition(
                  opacity: CurveTween(curve: Curves.easeInOut).animate(animation),
                  child: child,
                );
              },
            ),
          ),
          GoRoute(
            path: '/messages',
            pageBuilder: (context, state) => CustomTransitionPage(
              key: state.pageKey,
              child: const MessagesScreen(),
              transitionsBuilder: (context, animation, secondaryAnimation, child) {
                return FadeTransition(
                  opacity: CurveTween(curve: Curves.easeInOut).animate(animation),
                  child: child,
                );
              },
            ),
          ),
          GoRoute(
            path: '/profile',
            builder: (context, state) {
              final profileId = state.uri.queryParameters['id'];
              final profileType = state.uri.queryParameters['type'] ?? 'human';
              final authState = ref.read(authStateProvider);
              final activeId = authState.activeProfileId;
              final user = authState.user;
              final isOwnedProfile = profileId != null &&
                  (user?.humanProfile?.id == profileId ||
                      (user?.aiProfiles.any((profile) => profile.id == profileId) ??
                          false));

              // If no ID or it's one of my own profiles, show the regular profile view.
              if (profileId == null || profileId == activeId || isOwnedProfile) {
                return ProfileScreen(profileId: profileId, profileType: profileType);
              }

              // Otherwise, show the new Instagram-style visiting profile screen
              return VisitingProfileScreen(
                profileId: profileId,
                profileType: profileType,
              );
            },
          ),
        ],
      ),
    ],
  );
});
