import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:timeago/timeago.dart' as timeago;
import '../../models/notification_model.dart';
import '../../providers/auth_provider.dart';
import '../../providers/notifications_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/avatar_widget.dart';

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(notificationsProvider.notifier).loadNotifications();
    });
  }

  Future<void> _markAllRead() async {
    await ref.read(notificationsProvider.notifier).markAllRead();
  }

  Future<void> _markRead(NotificationModel notification) async {
    if (notification.isRead) return;
    await ref.read(notificationsProvider.notifier).markRead(notification.id);
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(notificationsProvider);
    final notifications = state.notifications;
    final isLoading = state.isLoading;
    final hasUnread = notifications.any((n) => !n.isRead);

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        backgroundColor: Theme.of(context).appBarTheme.backgroundColor,
        title: const Text('Notifications'),
        actions: [
          TextButton(
            onPressed: hasUnread ? _markAllRead : null,
            child: const Text(
              'Mark all read',
              style: TextStyle(fontSize: 13),
            ),
          ),
        ],
      ),
      body: Column(children: [
        _altInboxTile(),
        const Divider(height: 1),
        Expanded(
          child: isLoading && notifications.isEmpty
              ? const Center(child: CircularProgressIndicator())
              : _buildList(notifications),
        ),
      ]),
    );
  }

  /// Account-wide notifications (security, AI identity, moderation) live in the ALT inbox,
  /// shared with ALTER and ALTAR; this screen's list is ALTERA's social activity.
  Widget _altInboxTile() {
    final auth = ref.read(authServiceProvider);
    return ValueListenableBuilder<int>(
      valueListenable: auth.inbox.unread,
      builder: (context, unread, _) => ListTile(
        leading: const CircleAvatar(
          backgroundColor: AppColors.primary,
          child: Icon(Icons.shield_outlined, color: Colors.white, size: 20),
        ),
        title: const Text('ALT inbox', style: TextStyle(fontWeight: FontWeight.w700)),
        subtitle: const Text('Security alerts and news about your AI, from every ALT app'),
        trailing: unread > 0 ? Badge(label: Text('$unread')) : const Icon(Icons.chevron_right),
        onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(
          builder: (_) => AltInboxScreen(
            inbox: auth.inbox,
            onOpen: (n) {
              if (n.link?.startsWith('alter://') == true) auth.handoff.open(AltPlatform.alter);
            },
          ),
        )),
      ),
    );
  }

  Widget _buildList(List<NotificationModel> items) {
    if (items.isEmpty) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.notifications_none_rounded,
                size: 48, color: AppColors.subtle),
            SizedBox(height: 12),
            Text(
              'No notifications yet',
              style: TextStyle(color: AppColors.subtle, fontSize: 15),
            ),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: () => ref.read(notificationsProvider.notifier).loadNotifications(
            profileId: ref.read(authStateProvider).activeProfileId,
          ),
      child: ListView.separated(
        padding: const EdgeInsets.only(top: 8, bottom: 80),
        itemCount: items.length,
        separatorBuilder: (_, __) => const Divider(height: 1, indent: 72),
        itemBuilder: (_, i) {
          final n = items[i];
          return _NotificationTile(
            notification: n,
            onTap: () {
              _markRead(n);
              final postId = n.payload['post_id'];
              if (postId != null) {
                GoRouter.of(context).push('/post/$postId');
              } else if (n.type == NotificationType.message) {
                GoRouter.of(context).push('/messages');
              }
            },
          );
        },
      ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  final NotificationModel notification;
  final VoidCallback onTap;

  const _NotificationTile({
    required this.notification,
    required this.onTap,
  });

  IconData get _icon {
    switch (notification.type) {
      case NotificationType.follow:
        return Icons.person_add_outlined;
      case NotificationType.comment:
        return Icons.chat_bubble_outline;
      case NotificationType.reaction:
        return Icons.favorite_border;
      case NotificationType.message:
        return Icons.chat_bubble_outline_rounded;
      case NotificationType.aiDraftReady:
        return Icons.edit_note;
      case NotificationType.aiPostPublished:
        return Icons.auto_awesome;
      case NotificationType.mention:
        return Icons.alternate_email;
    }
  }

  Color get _color {
    switch (notification.type) {
      case NotificationType.follow:
        return AppColors.badgeHuman;
      case NotificationType.comment:
        return AppColors.primary;
      case NotificationType.reaction:
        return Colors.red;
      case NotificationType.message:
        return AppColors.primary;
      case NotificationType.aiDraftReady:
      case NotificationType.aiPostPublished:
        return AppColors.badgeAI;
      case NotificationType.mention:
        return AppColors.badgeBot;
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      leading: Stack(
        children: [
          AvatarWidget(
            avatarUrl: notification.payload['actor_avatar'],
            displayName: notification.title,
            radius: 22,
            isAI: notification.payload['actor_type'] == 'ai',
          ),
          Positioned(
            right: 0,
            bottom: 0,
            child: Container(
              padding: const EdgeInsets.all(2),
              decoration: BoxDecoration(
                color: _color,
                shape: BoxShape.circle,
                border: Border.all(color: Theme.of(context).scaffoldBackgroundColor, width: 2),
              ),
              child: Icon(_icon, size: 10, color: Colors.white),
            ),
          ),
        ],
      ),
      title: Text(
        notification.title,
        style: TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w600,
          color: Theme.of(context).colorScheme.onSurface,
        ),
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 2),
          Text(
            notification.body,
            style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurface.withOpacity(0.7)),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 4),
          Text(
            timeago.format(notification.createdAt),
            style: TextStyle(fontSize: 11, color: Theme.of(context).colorScheme.onSurface.withOpacity(0.5)),
          ),
        ],
      ),
      trailing: notification.isRead
          ? null
          : Container(
              width: 8,
              height: 8,
              decoration: const BoxDecoration(
                color: AppColors.primary,
                shape: BoxShape.circle,
              ),
            ),
      onTap: onTap,
    );
  }
}
