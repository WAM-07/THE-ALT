import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:timeago/timeago.dart' as timeago;
import '../../models/post_model.dart';
import '../../providers/feed_provider.dart';
import '../../providers/saved_posts_provider.dart';
import '../../providers/auth_provider.dart';
import '../../theme/app_theme.dart';
import 'identity_badge.dart';
import 'avatar_widget.dart';
import 'image_carousel.dart';
import 'glass_card.dart';
import '../services/feed_service.dart';
import '../models/message_model.dart';
import '../providers/messaging_provider.dart';

class PostCard extends ConsumerStatefulWidget {
  final Post post;
  final VoidCallback? onTap;
  final String? heroTagPrefix;

  const PostCard({
    super.key,
    required this.post,
    this.onTap,
    this.heroTagPrefix,
  });

  @override
  ConsumerState<PostCard> createState() => _PostCardState();
}

class _PostCardState extends ConsumerState<PostCard>
    with SingleTickerProviderStateMixin {
  late AnimationController _reactAnim;
  late Animation<double> _scaleAnim;

  @override
  void initState() {
    super.initState();
    _reactAnim = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 350));
    _scaleAnim = Tween<double>(begin: 1.0, end: 1.5).animate(
        CurvedAnimation(parent: _reactAnim, curve: Curves.elasticOut));
  }

  @override
  void dispose() {
    _reactAnim.dispose();
    super.dispose();
  }

  void _handleReact() {
    if (!widget.post.hasReacted) {
      _reactAnim.forward().then((_) => _reactAnim.reverse());
    }
    ref.read(feedProvider.notifier).toggleReaction(widget.post.id);
  }

  void _toggleSave() {
    final notifier = ref.read(savedPostsProvider.notifier);
    notifier.toggleSave(widget.post);
  }

  void _handleDelete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Post?'),
        content: const Text('This action cannot be undone.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );

    if (ok == true) {
      await ref.read(feedProvider.notifier).deletePost(widget.post.id);
    }
  }

  void _handleReport() async {
    final reason = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) => _ReportSelectionSheet(
        title: 'Report Post',
        reasons: const ['Spam', 'Inappropriate', 'Hate Speech', 'Harassment', 'Other'],
      ),
    );

    if (reason != null && mounted) {
      final ok = await ref.read(feedProvider.notifier).reportPost(widget.post.id, reason);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                Icon(ok ? Icons.check_circle : Icons.error, color: Colors.white, size: 20),
                const SizedBox(width: 10),
                Text(ok ? 'Post reported. Thank you.' : 'Failed to submit report.'),
              ],
            ),
            behavior: SnackBarBehavior.floating,
            backgroundColor: ok ? AppColors.primary : Colors.redAccent,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
        );
      }
    }
  }

  void _showShareSheet() {
    Navigator.of(context, rootNavigator: true).push(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _SharePostSheet(post: widget.post),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final post = widget.post;
    final auth = ref.watch(authStateProvider);
    final isMe = post.authorUserId == auth.user?.id;
    final isSaved = ref.watch(savedPostsProvider).savedPosts.any((p) => p.id == post.id);
    final showEngagementActions = post.status == 'published';

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: GlassCard(
        child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              InkWell(
                onTap: widget.onTap ?? () => context.push('/post/${post.id}'),
                borderRadius: const BorderRadius.vertical(
                  top: Radius.circular(16),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
              // Header
              Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    GestureDetector(
                      onTap: () => context.push('/profile?id=${post.authorId}&type=${post.authorType.name}'),
                      child: AvatarWidget(
                        avatarUrl: post.authorAvatar,
                        displayName: post.authorDisplayName,
                        isAI: post.authorType == AuthorType.ai,
                        heroTag: '${widget.heroTagPrefix ?? 'post'}_avatar_${post.id}',
                      ),
                    ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: GestureDetector(
                      onTap: () => context.push('/profile?id=${post.authorId}&type=${post.authorType.name}'),
                      behavior: HitTestBehavior.opaque,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Text(
                                post.authorDisplayName,
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 15,
                                ),
                              ),
                              const SizedBox(width: 4),
                              IdentityBadge.fromAuthorType(
                                post.authorType,
                                isVerified: post.authorIsVerified,
                                compact: true,
                              ),
                            ],
                          ),
                          Text(
                            '@${post.authorUsername} • ${timeago.format(post.publishedAt)}',
                            style: TextStyle(
                              color: AppColors.textTertiary,
                              fontSize: 12,
                            ),
                          ),
                          if (post.assistedByName != null)
                            Padding(
                              padding: const EdgeInsets.only(top: 2),
                              child: Row(children: [
                                const Icon(Icons.auto_awesome_rounded, size: 12, color: AppColors.badgeAI),
                                const SizedBox(width: 4),
                                Flexible(
                                  child: Text(
                                    'Posted with ${post.assistedByName}',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(color: AppColors.badgeAI, fontSize: 11.5, fontWeight: FontWeight.w600),
                                  ),
                                ),
                              ]),
                            ),
                        ],
                      ),
                    ),
                  ),
                  if (!isMe)
                    Padding(
                      padding: const EdgeInsets.only(right: 4),
                      child: TextButton(
                        onPressed: () => ref.read(feedProvider.notifier).toggleFollow(post.authorId, post.authorType.name),
                        style: TextButton.styleFrom(
                          visualDensity: VisualDensity.compact,
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          backgroundColor: post.isFollowingAuthor 
                              ? Theme.of(context).dividerColor.withOpacity(0.1)
                              : null,
                        ),
                        child: Text(
                          post.isFollowingAuthor ? 'Following' : 'Follow',
                          style: TextStyle(
                            color: post.isFollowingAuthor 
                                ? AppColors.textSecondary 
                                : AppColors.primary,
                            fontWeight: FontWeight.bold,
                            fontSize: 13,
                          ),
                        ),
                      ),
                    ),
                  PopupMenuButton<String>(
                    icon: const Icon(Icons.more_vert, size: 20),
                    onSelected: (val) {
                      if (val == 'delete') _handleDelete();
                      if (val == 'report') _handleReport();
                    },
                    itemBuilder: (ctx) => [
                      if (isMe)
                        const PopupMenuItem(
                          value: 'delete',
                          child: Text('Delete Post', style: TextStyle(color: Colors.red)),
                        ),
                      const PopupMenuItem(value: 'report', child: Text('Report Post')),
                    ],
                  ),
                ],
              ),
            ),

            // Content — strip inline hashtags to avoid duplication
            if (post.content.isNotEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Text(
                  post.hashtags.fold(
                    post.content,
                    (text, tag) => text
                        .replaceAll(RegExp('#$tag', caseSensitive: false), '')
                        .replaceAll(RegExp(r'\s+'), ' ')
                        .trim(),
                  ),
                  style: const TextStyle(fontSize: 15, height: 1.4),
                ),
              ),

            // Hashtags — orange oval chips, shown once
            if (post.hashtags.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
                child: Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  children: post.hashtags.map((tag) => GestureDetector(
                    onTap: () {},
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.orange.withOpacity(0.12),
                        border: Border.all(color: Colors.orange.withOpacity(0.4), width: 1),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(
                        '#$tag',
                        style: const TextStyle(
                          color: Colors.orange,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  )).toList(),
                ),
              ),

            // Media
            if (post.mediaUrls.isNotEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: ImageCarousel(
                    images: post.mediaUrls,
                    aspectRatio: 1.0,
                  ),
                ),
              ),
                  ],
                ),
              ),

            if (!showEngagementActions)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 10,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.warning.withOpacity(0.08),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: AppColors.warning.withOpacity(0.25),
                    ),
                  ),
                  child: Text(
                    post.status == 'pending_approval'
                        ? 'Pending approval. This post is not live yet.'
                        : 'This post is not live yet.',
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.warning,
                    ),
                  ),
                ),
              ),
            if (showEngagementActions)
              GestureDetector(
                onTap: () {},
                behavior: HitTestBehavior.opaque,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  child: Row(
                    children: [
                      _ActionButton(
                        icon: post.hasReacted ? Icons.favorite : Icons.favorite_border,
                        label: post.reactionCount.toString(),
                        color: post.hasReacted ? Colors.red : null,
                        onTap: _handleReact,
                        scaleAnim: post.hasReacted ? _scaleAnim : null,
                      ),
                      _ActionButton(
                        icon: Icons.chat_bubble_outline,
                        label: post.commentCount.toString(),
                        onTap: () => context.push('/post/${post.id}'),
                      ),
                      _ActionButton(
                        icon: Icons.send_outlined,
                        onTap: _showShareSheet,
                      ),
                      const Spacer(),
                      IconButton(
                        icon: Icon(
                          isSaved ? Icons.bookmark : Icons.bookmark_border,
                          color: isSaved ? AppColors.primary : null,
                          size: 20,
                        ),
                        onPressed: _toggleSave,
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final String? label;
  final VoidCallback onTap;
  final Color? color;
  final Animation<double>? scaleAnim;

  const _ActionButton({
    required this.icon,
    this.label,
    required this.onTap,
    this.color,
    this.scaleAnim,
  });

  @override
  Widget build(BuildContext context) {
    Widget iconWidget = Icon(icon, size: 20, color: color);
    if (scaleAnim != null) {
      iconWidget = ScaleTransition(scale: scaleAnim!, child: iconWidget);
    }

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
        child: Row(
          children: [
            iconWidget,
            if (label != null) ...[
              const SizedBox(width: 4),
              Text(
                label!,
                style: TextStyle(
                  fontSize: 13,
                  color: color ?? AppColors.textSecondary,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
class _SharePostSheet extends ConsumerStatefulWidget {
  final Post post;
  const _SharePostSheet({required this.post});

  @override
  ConsumerState<_SharePostSheet> createState() => _SharePostSheetState();
}

class _SharePostSheetState extends ConsumerState<_SharePostSheet> {
  final _searchCtrl = TextEditingController();
  List<FollowProfile> _targets = [];
  List<FollowProfile> _filteredTargets = [];
  bool _isLoading = true;
  String? _sendingToProfileId;

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    _loadTargets();
  }

  Future<void> _loadTargets() async {
    final auth = ref.read(authStateProvider);
    final activeId = auth.activeProfileId ?? '';

    setState(() => _isLoading = true);

    if (activeId.isEmpty) {
      if (!mounted) return;
      setState(() {
        _targets = [];
        _filteredTargets = [];
        _isLoading = false;
      });
      return;
    }

    Future<List<FollowProfile>> _safeLoad(
      Future<List<FollowProfile>> future,
    ) async {
      try {
        return await future.timeout(const Duration(seconds: 5));
      } catch (e) {
        debugPrint('[ShareSheet] Fallback load error: $e');
        return [];
      }
    }

    debugPrint('[ShareSheet] Loading targets for profile: $activeId');
    final futures = await Future.wait<List<FollowProfile>>([
      _safeLoad(ref.read(messagingServiceProvider).getShareTargets(activeId)),
      _safeLoad(ref.read(feedServiceProvider).getSuggestedProfiles()),
      _safeLoad(
        ref.read(feedServiceProvider).searchProfilesFiltered(
              query: '',
              scope: 'global',
            ),
      ),
    ]);

    final combined = <FollowProfile>[];
    final seenKeys = <String>{};

    for (final bucket in futures) {
      for (final profile in bucket) {
        final key = '${profile.isAI}:${profile.id}';
        if (profile.id == activeId || seenKeys.contains(key)) continue;
        seenKeys.add(key);
        combined.add(profile);
      }
    }

    if (!mounted) return;
    setState(() {
      _targets = combined;
      _filteredTargets = combined;
      _isLoading = false;
    });
  }

  void _filterTargets(String query) {
    if (query.isEmpty) {
      setState(() => _filteredTargets = _targets);
      return;
    }
    setState(() {
      _filteredTargets = _targets
          .where((t) =>
              t.displayName.toLowerCase().contains(query.toLowerCase()) ||
              t.username.toLowerCase().contains(query.toLowerCase()))
          .toList();
    });
  }

  Future<void> _shareTo(FollowProfile target) async {
    final auth = ref.read(authStateProvider);
    final activeProfileId = auth.activeProfileId;
    
    if (activeProfileId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a profile first')),
      );
      return;
    }

    final activeIsAI = activeProfileId != auth.user?.humanProfile?.id;
    
    final participants = [
      '${activeIsAI ? 'ai' : 'human'}:$activeProfileId',
      '${target.isAI ? 'ai' : 'human'}:${target.id}',
    ]..sort();
    final conversationId = participants.join('|');

    final conv = Conversation(
      id: conversationId,
      userId: target.userId,
      profileId: target.id,
      userName: target.displayName,
      userAvatarUrl: target.avatar,
      userIsVerified: target.isVerified,
      userIsAI: target.isAI,
      unreadCount: 0,
      createdAt: DateTime.now(),
    );

    final shareContent = SharedPostPreview.buildMessageContent(
      postId: widget.post.id,
      authorName: widget.post.authorDisplayName,
      authorUsername: widget.post.authorUsername,
      content: widget.post.content,
      mediaUrl: widget.post.mediaUrls.isNotEmpty ? widget.post.mediaUrls.first : null,
    );

    setState(() => _sendingToProfileId = target.id);
    final didSend = await ref.read(messagingProvider.notifier).sendMessage(
          conv,
          shareContent,
          isForwarded: true,
        );
    if (!mounted) return;

    setState(() => _sendingToProfileId = null);

    if (!didSend) {
      final error = ref.read(messagingProvider).error ?? 'Failed to share post';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error),
          behavior: SnackBarBehavior.floating,
          backgroundColor: AppColors.error,
        ),
      );
      return;
    }

    Navigator.pop(context);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Shared with ${target.displayName}'),
        behavior: SnackBarBehavior.floating,
        backgroundColor: AppColors.primary,
        duration: const Duration(seconds: 2),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final mutedTextColor =
        isDark ? AppColors.textSecondaryDark : AppColors.textSecondary;
    final tertiaryTextColor =
        isDark ? AppColors.textTertiaryDark : AppColors.textTertiary;
    final shellColor =
        isDark ? AppColors.surfaceVariantDark : AppColors.surfaceVariant;

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        title: const Text('Share Post'),
        centerTitle: false,
        elevation: 0,
      ),
      body: SafeArea(
        top: false,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 10),
              child: Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: isDark
                        ? const [Color(0xFF172033), Color(0xFF0F172A)]
                        : const [Colors.white, Color(0xFFFFF1E9)],
                  ),
                  borderRadius: BorderRadius.circular(22),
                  border: Border.all(
                    color: AppColors.primary.withOpacity(isDark ? 0.18 : 0.12),
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: AppColors.primary.withOpacity(isDark ? 0.12 : 0.08),
                      blurRadius: 22,
                      offset: const Offset(0, 10),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 6,
                          ),
                          decoration: BoxDecoration(
                            color: AppColors.primary.withOpacity(
                              isDark ? 0.18 : 0.1,
                            ),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: const Text(
                            'Send to',
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              color: AppColors.primary,
                            ),
                          ),
                        ),
                        const Spacer(),
                        Icon(
                          Icons.send_rounded,
                          size: 18,
                          color: AppColors.primary.withOpacity(0.9),
                        ),
                      ],
                    ),
                    const SizedBox(height: 14),
                    Row(
                      children: [
                        AvatarWidget(
                          avatarUrl: widget.post.authorAvatar,
                          displayName: widget.post.authorDisplayName,
                          isAI: widget.post.authorType == AuthorType.ai,
                          radius: 24,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                widget.post.authorDisplayName,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w700,
                                  fontSize: 15,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                '@${widget.post.authorUsername}',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: mutedTextColor,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: isDark
                            ? Colors.white.withOpacity(0.04)
                            : Colors.white.withOpacity(0.72),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: Text(
                        widget.post.content.isEmpty
                            ? 'Media post'
                            : widget.post.content,
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 13,
                          height: 1.45,
                          color: Theme.of(context).colorScheme.onSurface,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: Container(
                decoration: BoxDecoration(
                  color: shellColor,
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(
                    color: Theme.of(context).dividerColor.withOpacity(0.45),
                  ),
                ),
                child: TextField(
                  controller: _searchCtrl,
                  onChanged: (value) {
                    _filterTargets(value);
                    setState(() {});
                  },
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.onSurface,
                    fontWeight: FontWeight.w500,
                  ),
                  decoration: InputDecoration(
                    hintText: 'Search people, AI personas...',
                    hintStyle: TextStyle(color: mutedTextColor),
                    prefixIcon:
                        Icon(Icons.search_rounded, color: mutedTextColor),
                    suffixIcon: _searchCtrl.text.isEmpty
                        ? null
                        : IconButton(
                            onPressed: () {
                              _searchCtrl.clear();
                              _filterTargets('');
                              setState(() {});
                            },
                            icon: Icon(
                              Icons.close_rounded,
                              color: tertiaryTextColor,
                            ),
                          ),
                    filled: true,
                    fillColor: Colors.transparent,
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 4,
                      vertical: 16,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(18),
                      borderSide: BorderSide.none,
                    ),
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 0, 18, 10),
              child: Row(
                children: [
                  Text(
                    _searchCtrl.text.isEmpty ? 'Suggested' : 'Results',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: mutedTextColor,
                      letterSpacing: 0.2,
                    ),
                  ),
                  const Spacer(),
                  Text(
                    '${_filteredTargets.length} people',
                    style: TextStyle(
                      fontSize: 12,
                      color: tertiaryTextColor,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: _isLoading
                  ? const Center(child: CircularProgressIndicator())
                  : _filteredTargets.isEmpty
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 24),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  'No people found',
                                  style: TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w700,
                                    color: Theme.of(context)
                                        .colorScheme
                                        .onSurface,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  'Try another search or reload suggestions.',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(color: mutedTextColor),
                                ),
                                const SizedBox(height: 14),
                                OutlinedButton(
                                  onPressed: _loadTargets,
                                  child: const Text('Retry'),
                                ),
                              ],
                            ),
                          ),
                        )
                      : ListView.separated(
                          padding: const EdgeInsets.fromLTRB(12, 0, 12, 24),
                          itemCount: _filteredTargets.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (ctx, index) {
                            final target = _filteredTargets[index];
                            final isSending = _sendingToProfileId == target.id;
                            return Container(
                              decoration: BoxDecoration(
                                color: Theme.of(context).cardColor,
                                borderRadius: BorderRadius.circular(18),
                                border: Border.all(
                                  color: Theme.of(context)
                                      .dividerColor
                                      .withOpacity(0.35),
                                ),
                              ),
                              child: ListTile(
                                contentPadding: const EdgeInsets.symmetric(
                                  horizontal: 14,
                                  vertical: 6,
                                ),
                                leading: AvatarWidget(
                                  avatarUrl: target.avatar,
                                  displayName: target.displayName,
                                  isAI: target.isAI,
                                  radius: 22,
                                ),
                                title: Text(
                                  target.displayName,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                subtitle: Text(
                                  '@${target.username}${target.isAI ? ' • AI persona' : ''}',
                                  style: TextStyle(
                                    color: tertiaryTextColor,
                                    fontSize: 12,
                                  ),
                                ),
                                trailing: ElevatedButton(
                                  onPressed: _sendingToProfileId == null
                                      ? () => _shareTo(target)
                                      : null,
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: AppColors.primary,
                                    foregroundColor: Colors.white,
                                    elevation: 0,
                                    minimumSize: const Size(84, 42),
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(20),
                                    ),
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 18,
                                      vertical: 10,
                                    ),
                                  ),
                                  child: isSending
                                      ? const SizedBox(
                                          width: 16,
                                          height: 16,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                            color: Colors.white,
                                          ),
                                        )
                                      : const Row(
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            Icon(Icons.send_rounded, size: 14),
                                            SizedBox(width: 6),
                                            Text('Send'),
                                          ],
                                        ),
                                ),
                              ),
                            );
                          },
                        ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ReportSelectionSheet extends StatelessWidget {
  final String title;
  final List<String> reasons;

  const _ReportSelectionSheet({required this.title, required this.reasons});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(height: 12),
          Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: Theme.of(context).dividerColor,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(20),
            child: Text(
              title,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
          ),
          ...reasons.map((r) => ListTile(
            title: Text(r),
            onTap: () => Navigator.pop(context, r),
            trailing: const Icon(Icons.chevron_right, size: 20),
          )),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}
