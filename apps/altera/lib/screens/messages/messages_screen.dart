import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:timeago/timeago.dart' as timeago;
import '../../models/message_model.dart';
import '../../providers/messaging_provider.dart';
import '../../providers/feed_provider.dart';
import '../../services/feed_service.dart';
import '../../theme/app_theme.dart';
import '../../widgets/avatar_widget.dart';
import '../../providers/auth_provider.dart';
import '../ai/your_ais_screen.dart';

class MessagesScreen extends ConsumerStatefulWidget {
  const MessagesScreen({super.key});

  @override
  ConsumerState<MessagesScreen> createState() => _MessagesScreenState();
}

class _MessagesScreenState extends ConsumerState<MessagesScreen> {
  final _searchCtrl = TextEditingController();
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final notifier = ref.read(messagingProvider.notifier);
      notifier.reconnectSocket();
      notifier.loadConversations();
    });
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  void _performSearch(String query) {
    setState(() => _searchQuery = query);
  }

  /// Opens the "New Message" sheet — search all users and start a fresh chat
  void _openNewMessageSheet() {
    final searchCtrl = TextEditingController();
    List<FollowProfile> results = [];
    bool isSearching = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => StatefulBuilder(
        builder: (ctx, setSheet) {
          Future<void> search(String q) async {
            if (q.isEmpty) {
              setSheet(() { results = []; isSearching = false; });
              return;
            }
            setSheet(() => isSearching = true);
            final r = await ref.read(feedServiceProvider).searchProfiles(q, scope: 'global');
            setSheet(() { results = r; isSearching = false; });
          }

          return Container(
            height: MediaQuery.of(ctx).size.height * 0.85,
            decoration: BoxDecoration(
              color: Theme.of(ctx).scaffoldBackgroundColor,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
            ),
            child: Column(
              children: [
                const SizedBox(height: 12),
                Container(
                  width: 40, height: 4,
                  decoration: BoxDecoration(
                    color: Theme.of(ctx).dividerColor,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                const SizedBox(height: 16),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Row(
                    children: [
                      const Text('New Message',
                          style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                      const Spacer(),
                      IconButton(
                        icon: const Icon(Icons.close),
                        onPressed: () => Navigator.pop(ctx),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
                  child: TextField(
                    controller: searchCtrl,
                    autofocus: true,
                    onChanged: search,
                    decoration: InputDecoration(
                      hintText: 'Search people...',
                      prefixIcon: const Icon(Icons.search, size: 20),
                      filled: true,
                      fillColor: Theme.of(ctx).colorScheme.surfaceContainerHighest,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10),
                        borderSide: BorderSide.none,
                      ),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    ),
                  ),
                ),
                Expanded(
                  child: isSearching
                      ? const Center(child: CircularProgressIndicator())
                      : results.isEmpty
                          ? Center(
                              child: Text(
                                searchCtrl.text.isEmpty
                                    ? 'Search for someone to message'
                                    : 'No users found',
                                style: const TextStyle(color: AppColors.textSecondary),
                              ),
                            )
                          : ListView.builder(
                              padding: const EdgeInsets.only(bottom: 32),
                              itemCount: results.length,
                              itemBuilder: (_, i) {
                                final profile = results[i];
                                return ListTile(
                                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                                  leading: AvatarWidget(
                                    avatarUrl: profile.avatar,
                                    displayName: profile.displayName,
                                    radius: 22,
                                    isAI: profile.isAI,
                                  ),
                                  title: Text(profile.displayName,
                                      style: const TextStyle(fontWeight: FontWeight.w600)),
                                  subtitle: Text('@${profile.username}'),
                                  trailing: profile.isAI
                                      ? Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                          decoration: BoxDecoration(
                                            color: AppColors.badgeAI.withOpacity(0.12),
                                            borderRadius: BorderRadius.circular(8),
                                          ),
                                          child: const Text('AI',
                                              style: TextStyle(color: AppColors.badgeAI,
                                                  fontWeight: FontWeight.w700, fontSize: 11)),
                                        )
                                      : null,
                                  onTap: () {
                                    Navigator.pop(ctx);
                                    final auth = ref.read(authStateProvider);
                                    final activeProfileId = auth.activeProfileId ?? '';
                                    final activeIsAI = activeProfileId != auth.user?.humanProfile?.id;
                                    final participants = [
                                      '${activeIsAI ? 'ai' : 'human'}:$activeProfileId',
                                      '${profile.isAI ? 'ai' : 'human'}:${profile.id}',
                                    ]..sort();
                                    final conversationId = participants.join('|');
                                    final newConv = Conversation(
                                      id: conversationId,
                                      userId: profile.userId,
                                      profileId: profile.id,
                                      userName: profile.displayName,
                                      userAvatarUrl: profile.avatar,
                                      userIsVerified: profile.isVerified,
                                      userIsAI: profile.isAI,
                                      unreadCount: 0,
                                      createdAt: DateTime.now(),
                                    );
                                    context.push(
                                      '/messages/${Uri.encodeComponent(conversationId)}',
                                      extra: newConv,
                                    );
                                  },
                                );
                              },
                            ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  void _showConversationOptions(Conversation conversation) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(height: 8),
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.grey[300],
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 16),
              ListTile(
                leading: Icon(conversation.isPinned ? Icons.pin_end : Icons.push_pin_outlined),
                title: Text(conversation.isPinned ? 'Unpin conversation' : 'Pin conversation'),
                onTap: () {
                  ref.read(messagingProvider.notifier).togglePin(conversation.id, !conversation.isPinned);
                  Navigator.pop(context);
                },
              ),
              ListTile(
                leading: Icon(conversation.isMuted ? Icons.notifications_active_outlined : Icons.notifications_off_outlined),
                title: Text(conversation.isMuted ? 'Unmute conversation' : 'Mute conversation'),
                onTap: () {
                  ref.read(messagingProvider.notifier).toggleMute(conversation.id, !conversation.isMuted);
                  Navigator.pop(context);
                },
              ),
              ListTile(
                leading: const Icon(Icons.archive_outlined),
                title: const Text('Archive conversation'),
                onTap: () {
                  ref.read(messagingProvider.notifier).toggleArchive(conversation.id, true);
                  Navigator.pop(context);
                },
              ),
              ListTile(
                leading: const Icon(Icons.delete_outline, color: Colors.red),
                title: const Text('Delete conversation', style: TextStyle(color: Colors.red)),
                onTap: () async {
                  Navigator.pop(context);
                  final confirmed = await showDialog<bool>(
                    context: context,
                    builder: (ctx) => AlertDialog(
                      title: const Text('Delete Chat?'),
                      content: const Text('This will delete all messages in this conversation for you. This action cannot be undone.'),
                      actions: [
                        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
                        TextButton(
                          onPressed: () => Navigator.pop(ctx, true),
                          child: const Text('Delete', style: TextStyle(color: Colors.red)),
                        ),
                      ],
                    ),
                  );
                  if (confirmed == true) {
                    ref.read(messagingProvider.notifier).deleteConversation(conversation.id);
                  }
                },
              ),
              const SizedBox(height: 16),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final messagingState = ref.watch(messagingProvider);
    var conversations = messagingState.conversations;

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        backgroundColor: Theme.of(context).appBarTheme.backgroundColor,
        elevation: 0.5,
        title: Text(
          'Messages',
          style: TextStyle(
              fontWeight: FontWeight.w800,
              fontSize: 24,
              color: Theme.of(context).colorScheme.onSurface),
        ),
        actions: [
          IconButton(
            icon: Icon(Icons.edit_square,
                color: Theme.of(context).colorScheme.onSurface, size: 22),
            tooltip: 'New Message',
            onPressed: _openNewMessageSheet,
          ),
        ],
      ),
      body: Column(
        children: [
          // The AIs on the ALT account: owned, rented and subscribed (chats shared with ALTER and ALTAR).
          const Padding(padding: EdgeInsets.only(top: 8), child: AccountAiStrip()),
          // Search bar — filters existing conversations only
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
            child: TextField(
              controller: _searchCtrl,
              onChanged: _performSearch,
              decoration: InputDecoration(
                hintText: 'Search conversations...',
                hintStyle: TextStyle(
                    color: Theme.of(context)
                        .colorScheme
                        .onSurface
                        .withOpacity(0.5)),
                prefixIcon: Icon(Icons.search,
                    size: 20,
                    color: Theme.of(context)
                        .colorScheme
                        .onSurface
                        .withOpacity(0.6)),
                suffixIcon: _searchQuery.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.close, size: 18),
                        onPressed: () {
                          _searchCtrl.clear();
                          _performSearch('');
                        },
                      )
                    : null,
                filled: true,
                fillColor:
                    Theme.of(context).colorScheme.surfaceContainerHighest,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: BorderSide(
                      color: Theme.of(context).dividerColor.withOpacity(0.2)),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: BorderSide(
                      color: Theme.of(context).dividerColor.withOpacity(0.1)),
                ),
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              ),
            ),
          ),
          
          // Unread messages indicator
          if (_searchQuery.isEmpty && conversations.any((c) => c.unreadCount > 0))
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 0),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: AppColors.primary.withOpacity(0.08),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.mark_chat_unread_outlined, size: 16, color: AppColors.primary),
                    const SizedBox(width: 8),
                    Text(
                      () {
                        final totalUnread = conversations.fold<int>(0, (sum, c) => sum + c.unreadCount);
                        if (totalUnread <= 4) return '$totalUnread new message${totalUnread > 1 ? 's' : ''}';
                        return '4+ new messages';
                      }(),
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: AppColors.primary,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          const SizedBox(height: 8),

          // Conversations list — filtered locally by search query
          Expanded(
            child: messagingState.isLoading && conversations.isEmpty
                ? const Center(child: CircularProgressIndicator())
                : _buildConversationList(
                    _searchQuery.isEmpty
                        ? conversations
                        : conversations
                            .where((c) =>
                                c.userName.toLowerCase().contains(_searchQuery.toLowerCase()) ||
                                (c.lastMessage?.content.toLowerCase().contains(_searchQuery.toLowerCase()) ?? false))
                            .toList(),
                  ),
          ),
        ],
      ),
    );
  }


  Widget _buildConversationList(List<Conversation> items) {
    if (items.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              _searchQuery.isNotEmpty
                  ? Icons.search_off_rounded
                  : Icons.chat_bubble_outline,
              size: 64,
              color: AppColors.textTertiary.withOpacity(0.3),
            ),
            const SizedBox(height: 16),
            Text(
              _searchQuery.isNotEmpty
                  ? 'No conversations match "$_searchQuery"'
                  : 'No messages yet',
              style: Theme.of(context).textTheme.headlineSmall,
              textAlign: TextAlign.center,
            ),
            if (_searchQuery.isEmpty) ...[
              const SizedBox(height: 8),
              Text(
                'Tap the pencil icon to start a new chat',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ],
        ),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.only(bottom: 80),
      itemCount: items.length,
      itemBuilder: (_, index) {
        final conversation = items[index];
        return _ConversationTile(
          conversation: conversation,
          onLongPress: _showConversationOptions,
          onTap: () {
            context.push(
              '/messages/${Uri.encodeComponent(conversation.id)}',
              extra: conversation,
            );
          },
        );
      },
    );
  }

}

String _previewText(Message? message) {
  if (message == null) return 'No messages yet';

  final sharedPost = SharedPostPreview.fromMessageContent(message.content);
  if (sharedPost != null) return 'Shared a post';

  final mediaUrl = message.mediaUrl;
  if (mediaUrl != null && mediaUrl.isNotEmpty) {
    if (message.mediaType == 'audio' ||
        mediaUrl.startsWith('data:audio/') ||
        RegExp(r'\.(mp3|wav|m4a|aac|ogg)$', caseSensitive: false)
            .hasMatch(mediaUrl)) {
      return 'Voice note';
    }
    if (message.mediaType == 'video' ||
        mediaUrl.startsWith('data:video/') ||
        RegExp(r'\.(mp4|mov|m4v|webm)$', caseSensitive: false)
            .hasMatch(mediaUrl)) {
      return 'Video';
    }
    return 'Photo';
  }

  return message.content.isEmpty ? 'Message' : message.content;
}

class _ConversationTile extends StatelessWidget {
  final Conversation conversation;
  final VoidCallback onTap;
  final Function(Conversation)? onLongPress;

  const _ConversationTile({
    required this.conversation,
    required this.onTap,
    this.onLongPress,
  });

  @override
  Widget build(BuildContext context) {
    final hasUnread = conversation.unreadCount > 0;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        onLongPress: () => onLongPress?.call(conversation),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: conversation.isPinned 
                ? Theme.of(context).colorScheme.primary.withOpacity(0.03)
                : null,
            border: Border(
              bottom: BorderSide(
                color: Theme.of(context).dividerColor.withOpacity(0.08),
                width: 0.5,
              ),
            ),
          ),
          child: Row(
            children: [
              // Professional Avatar with Badge
              Stack(
                children: [
                  Container(
                    padding: const EdgeInsets.all(3),
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: conversation.userIsAI
                          ? const LinearGradient(colors: AppColors.aiGradient)
                          : null,
                    ),
                    child: Container(
                      padding: const EdgeInsets.all(2),
                      decoration: BoxDecoration(
                        color: Theme.of(context).scaffoldBackgroundColor,
                        shape: BoxShape.circle,
                        border: !conversation.userIsAI
                            ? Border.all(
                                color: Theme.of(context)
                                    .dividerColor
                                    .withOpacity(0.15),
                                width: 1.5,
                              )
                            : null,
                      ),
                      child: AvatarWidget(
                        avatarUrl: conversation.userAvatarUrl,
                        displayName: conversation.userName,
                        radius: 28,
                        isAI: conversation.userIsAI,
                        showGradient: false,
                      ),
                    ),
                  ),
                  // Verification badge
                  if (conversation.userIsVerified)
                    Positioned(
                      right: -2,
                      bottom: -2,
                      child: Container(
                        padding: const EdgeInsets.all(2),
                        decoration: BoxDecoration(
                          color: conversation.userIsAI
                              ? AppColors.badgeAI
                              : AppColors.primary,
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: Theme.of(context).scaffoldBackgroundColor,
                            width: 2,
                          ),
                          boxShadow: [
                            BoxShadow(
                              color: (conversation.userIsAI
                                      ? AppColors.badgeAI
                                      : AppColors.primary)
                                  .withOpacity(0.3),
                              blurRadius: 4,
                              offset: const Offset(0, 2),
                            ),
                          ],
                        ),
                        child: const Icon(Icons.check,
                            size: 10, color: Colors.white),
                      ),
                    ),
                ],
              ),
              const SizedBox(width: 12),

              // Conversation Info with improved typography
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Name row with timestamp
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(
                          child: Row(
                            children: [
                              if (conversation.isPinned)
                                const Padding(
                                  padding: EdgeInsets.only(right: 6),
                                  child: Icon(Icons.push_pin, size: 14, color: AppColors.primary),
                                ),
                              Flexible(
                                child: Text(
                                  conversation.userName,
                                  style: TextStyle(
                                    fontSize: 15,
                                    fontWeight:
                                        hasUnread ? FontWeight.w700 : FontWeight.w600,
                                    color: Theme.of(context).colorScheme.onSurface,
                                    letterSpacing: 0.2,
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              if (conversation.isMuted)
                                Padding(
                                  padding: const EdgeInsets.only(left: 6),
                                  child: Icon(Icons.notifications_off_outlined, size: 14, color: Theme.of(context).colorScheme.onSurface.withOpacity(0.4)),
                                ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        if (conversation.lastMessage != null)
                          Text(
                            timeago.format(conversation.lastMessage!.createdAt,
                                locale: 'en_short'),
                            style: TextStyle(
                              fontSize: 12,
                              color: hasUnread
                                  ? AppColors.primary
                                  : Theme.of(context)
                                      .colorScheme
                                      .onSurface
                                      .withOpacity(0.5),
                              fontWeight:
                                  hasUnread ? FontWeight.w600 : FontWeight.w400,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    // Last message preview
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            _previewText(conversation.lastMessage),
                            style: TextStyle(
                              fontSize: 13,
                              color: hasUnread
                                  ? Theme.of(context).colorScheme.onSurface
                                  : Theme.of(context)
                                      .colorScheme
                                      .onSurface
                                      .withOpacity(0.55),
                              fontWeight:
                                  hasUnread ? FontWeight.w700 : FontWeight.w400,
                              height: 1.3,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: 8),
                        // Unread indicator
                        if (hasUnread)
                          Container(
                            constraints: const BoxConstraints(
                              minWidth: 22,
                              minHeight: 22,
                            ),
                            padding: const EdgeInsets.symmetric(
                              horizontal: 6,
                              vertical: 3,
                            ),
                            decoration: BoxDecoration(
                              color: AppColors.primary,
                              borderRadius: BorderRadius.circular(999),
                            ),
                            alignment: Alignment.center,
                            child: Text(
                              conversation.unreadCount > 99
                                  ? '99+'
                                  : '${conversation.unreadCount}',
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 11,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
