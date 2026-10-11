import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/story_model.dart';
import '../../providers/auth_provider.dart';
import '../../providers/story_provider.dart';
import '../../providers/messaging_provider.dart';
import '../../models/message_model.dart';
import '../../theme/app_theme.dart';
import '../../widgets/avatar_widget.dart';
import '../../config/app_config.dart';
import 'package:cached_network_image/cached_network_image.dart';

class StoryViewerDialog extends ConsumerStatefulWidget {
  final StoryGroup group;
  final bool isMe;

  const StoryViewerDialog({
    super.key,
    required this.group,
    required this.isMe,
  });

  @override
  ConsumerState<StoryViewerDialog> createState() => _StoryViewerDialogState();
}

class _StoryViewerDialogState extends ConsumerState<StoryViewerDialog> {
  late PageController _pageController;
  int _currentIndex = 0;
  final _replyCtrl = TextEditingController();
  bool _isSendingReply = false;

  @override
  void initState() {
    super.initState();
    _pageController = PageController();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _markViewed(_currentIndex);
    });
  }

  @override
  void dispose() {
    _pageController.dispose();
    _replyCtrl.dispose();
    super.dispose();
  }

  void _markViewed(int index) {
    if (widget.group.stories.isEmpty) return;
    final story = widget.group.stories[index];
    if (!story.viewed && !widget.isMe) {
      ref.read(storiesProvider.notifier).markStoryViewed(story.id);
    }
  }

  void _onPageChanged(int index) {
    setState(() => _currentIndex = index);
    _markViewed(index);
  }

  Future<void> _showViewers() async {
    final story = widget.group.stories[_currentIndex];
    
    showModalBottomSheet(
      context: context,
      backgroundColor: Theme.of(context).cardColor,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => _ViewersBottomSheet(storyId: story.id),
    );
  }

  Future<void> _sendReply() async {
    final content = _replyCtrl.text.trim();
    if (content.isEmpty) return;
    setState(() => _isSendingReply = true);

    try {
      final conversations = ref.read(messagingProvider).conversations;
      var conversation = conversations.where((c) => c.userId == widget.group.userId).firstOrNull;

      // If no conversation exists, we just send a DM and the backend will create one.
      // But MessagingProvider requires a Conversation object. Let's create a dummy one.
      conversation ??= Conversation(
        id: '',
        userId: widget.group.userId,
        userName: widget.group.displayName,
        userIsVerified: false,
        userIsAI: false,
        unreadCount: 0,
        createdAt: DateTime.now(),
      );

      final story = widget.group.stories[_currentIndex];
      final messageContent = 'Replying to your story: "$content"';
      
      await ref.read(messagingProvider.notifier).sendMessage(
        conversation!,
        messageContent,
        mediaUrl: story.mediaUrl.isNotEmpty ? story.mediaUrl : null,
      );

      _replyCtrl.clear();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Reply sent!'), behavior: SnackBarBehavior.floating),
        );
      }
    } finally {
      if (mounted) setState(() => _isSendingReply = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.group.stories.isEmpty) return const SizedBox.shrink();
    final story = widget.group.stories[_currentIndex];

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          PageView.builder(
            controller: _pageController,
            onPageChanged: _onPageChanged,
            itemCount: widget.group.stories.length,
            itemBuilder: (context, index) {
              final s = widget.group.stories[index];
              return Container(
                color: s.backgroundColor != null && s.backgroundColor!.isNotEmpty
                    ? Color(int.tryParse(s.backgroundColor!) ?? 0xFF000000)
                    : Colors.black,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    if (s.mediaUrl.isNotEmpty)
                      CachedNetworkImage(
                        imageUrl: AppConfig.resolveUrl(s.mediaUrl),
                        fit: BoxFit.cover,
                      ),
                    if (s.textContent != null && s.textContent!.isNotEmpty)
                      Center(
                        child: Padding(
                          padding: const EdgeInsets.all(40.0),
                          child: Text(
                            s.textContent!,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 24,
                              fontWeight: FontWeight.bold,
                              shadows: [Shadow(color: Colors.black, blurRadius: 4)],
                            ),
                            textAlign: TextAlign.center,
                          ),
                        ),
                      ),
                  ],
                ),
              );
            },
          ),
          
          // Header
          Positioned(
            top: 50,
            left: 0,
            right: 0,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16.0),
              child: Row(
                children: [
                  AvatarWidget(
                    avatarUrl: widget.group.avatar,
                    displayName: widget.group.displayName,
                    radius: 20,
                    heroTag: 'story_${widget.group.userId}',
                  ),
                  const SizedBox(width: 12),
                  Text(
                    widget.group.displayName,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                      shadows: [Shadow(color: Colors.black, blurRadius: 4)],
                    ),
                  ),
                  const Spacer(),
                  IconButton(
                    icon: const Icon(Icons.close, color: Colors.white, shadows: [Shadow(color: Colors.black, blurRadius: 4)]),
                    onPressed: () => Navigator.pop(context),
                  ),
                ],
              ),
            ),
          ),

          // Bottom Bar (Reply or Viewers)
          Positioned(
            bottom: MediaQuery.of(context).viewInsets.bottom + 16,
            left: 16,
            right: 16,
            child: widget.isMe
                ? Center(
                    child: GestureDetector(
                      onTap: _showViewers,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                        decoration: BoxDecoration(
                          color: Colors.black54,
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.visibility, color: Colors.white, size: 20),
                            const SizedBox(width: 8),
                            Text(
                              '${story.viewCount} Viewers',
                              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                            ),
                          ],
                        ),
                      ),
                    ),
                  )
                : Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _replyCtrl,
                          style: const TextStyle(color: Colors.white),
                          decoration: InputDecoration(
                            hintText: 'Reply to ${widget.group.displayName}...',
                            hintStyle: const TextStyle(color: Colors.white70),
                            filled: true,
                            fillColor: Colors.black54,
                            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(24),
                              borderSide: BorderSide.none,
                            ),
                          ),
                          onSubmitted: (_) => _sendReply(),
                        ),
                      ),
                      if (_isSendingReply)
                        const Padding(
                          padding: EdgeInsets.only(left: 12),
                          child: CircularProgressIndicator(color: Colors.white),
                        )
                      else
                        IconButton(
                          icon: const Icon(Icons.send, color: Colors.white),
                          onPressed: _sendReply,
                        ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}

class _ViewersBottomSheet extends ConsumerStatefulWidget {
  final String storyId;
  const _ViewersBottomSheet({required this.storyId});

  @override
  ConsumerState<_ViewersBottomSheet> createState() => _ViewersBottomSheetState();
}

class _ViewersBottomSheetState extends ConsumerState<_ViewersBottomSheet> {
  List<StoryViewer>? _viewers;
  
  @override
  void initState() {
    super.initState();
    _loadViewers();
  }
  
  Future<void> _loadViewers() async {
    final viewers = await ref.read(storiesProvider.notifier).getStoryViewers(widget.storyId);
    if (mounted) {
      setState(() => _viewers = viewers);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_viewers == null) {
      return const SizedBox(height: 200, child: Center(child: CircularProgressIndicator()));
    }
    
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const SizedBox(height: 16),
        const Text('Viewers', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        const Divider(),
        if (_viewers!.isEmpty)
          const Padding(
            padding: EdgeInsets.all(32.0),
            child: Text('No viewers yet', style: TextStyle(color: AppColors.textSecondary)),
          )
        else
          Flexible(
            child: ListView.builder(
              shrinkWrap: true,
              itemCount: _viewers!.length,
              itemBuilder: (context, index) {
                final viewer = _viewers![index];
                return ListTile(
                  leading: AvatarWidget(
                    avatarUrl: viewer.avatar,
                    displayName: viewer.displayName,
                    radius: 20,
                  ),
                  title: Text(viewer.displayName, style: const TextStyle(fontWeight: FontWeight.bold)),
                  subtitle: Text('@${viewer.username}'),
                  trailing: Text(
                    '${viewer.viewedAt.hour}:${viewer.viewedAt.minute.toString().padLeft(2, '0')}',
                    style: const TextStyle(fontSize: 12, color: AppColors.textTertiary),
                  ),
                );
              },
            ),
          ),
      ],
    );
  }
}
