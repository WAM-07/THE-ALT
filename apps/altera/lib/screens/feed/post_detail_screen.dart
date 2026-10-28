import '../../services/account_ai_service.dart';
import '../../widgets/write_with_ai_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:timeago/timeago.dart' as timeago;
import '../../models/post_model.dart';
import '../../providers/feed_provider.dart';
import '../../providers/auth_provider.dart';
import '../../providers/notifications_provider.dart' as np;
import '../../services/feed_service.dart';
import '../../widgets/post_card.dart';
import '../../widgets/avatar_widget.dart';
import '../../theme/app_theme.dart';

class PostDetailScreen extends ConsumerStatefulWidget {
  final String postId;

  const PostDetailScreen({super.key, required this.postId});

  @override
  ConsumerState<PostDetailScreen> createState() => _PostDetailScreenState();
}

class _PostDetailScreenState extends ConsumerState<PostDetailScreen> {
  Post? _post;
  List<Comment> _comments = [];
  bool _isLoading = true;
  bool _isLoadingComments = true;
  bool _isSubmitting = false;
  String? _error;
  final _commentCtrl = TextEditingController();
  // An AI on the ALT account that drafted this comment ("replied with"); removed if you clear it.
  AccountAi? _assistedBy;
  bool _drafting = false;

  Future<void> _replyWithAi() async {
    final picked = await pickAiToWriteWith(
      context,
      ref,
      title: 'Reply with your AI',
      subtitle: 'It drafts a comment for you under this post. You can edit it; it shows “replied with” the AI.',
      hint: 'What do you want to say? (optional)',
      briefRequired: false,
      initialAiId: _assistedBy?.id,
    );
    if (picked == null || !mounted) return;
    setState(() => _drafting = true);
    try {
      final text = await ref.read(accountAiServiceProvider).draftWith(picked.ai.id, picked.brief, commentOnPostId: widget.postId);
      if (!mounted) return;
      setState(() {
        _commentCtrl.text = text.length > 500 ? text.substring(0, 500) : text;
        _assistedBy = picked.ai;
      });
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))));
    } finally {
      if (mounted) setState(() => _drafting = false);
    }
  }
  final _scrollCtrl = ScrollController();
  final _focusNode = FocusNode();

  @override
  void initState() {
    super.initState();
    _loadPost();
    _loadComments();
    _setupSocket();
  }

  void _setupSocket() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final socket = ref.read(np.notificationsProvider.notifier).socket;
      if (socket != null) {
        ref.read(np.notificationsProvider.notifier).subscribeToPost(widget.postId);
        socket.on('comment:new', _handleNewComment);
      }
    });
  }

  void _handleNewComment(data) {
    if (data is! Map || !mounted) return;
    final comment = Comment.fromJson(Map<String, dynamic>.from(data));
    
    // Check if it's already in the list (don't add my own twice if handled locally)
    final exists = _comments.any((c) => c.id == comment.id);
    if (exists) return;

    setState(() {
      _comments.add(comment);
      if (_post != null) {
        final newCount = _post!.commentCount + 1;
        _post = _post!.copyWith(commentCount: newCount);
        // Sync with global feed state
        ref.read(feedProvider.notifier).syncCommentCount(widget.postId, newCount);
      }
    });

    // Scroll to bottom if user is already near bottom
    if (_scrollCtrl.hasClients && 
        _scrollCtrl.offset > _scrollCtrl.position.maxScrollExtent - 200) {
      _scrollCtrl.animateTo(
        _scrollCtrl.position.maxScrollExtent,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOut,
      );
    }
  }

  @override
  void dispose() {
    final socket = ref.read(np.notificationsProvider.notifier).socket;
    socket?.off('comment:new', _handleNewComment);
    _commentCtrl.dispose();
    _scrollCtrl.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  Future<void> _loadPost() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final result = await ref.read(feedServiceProvider).getPost(widget.postId);
      if (mounted) {
        setState(() {
          _post = result;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _loadComments() async {
    setState(() => _isLoadingComments = true);
    try {
      final comments =
          await ref.read(feedServiceProvider).getComments(widget.postId);
      if (mounted) {
        setState(() {
          _comments = comments;
          _isLoadingComments = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _isLoadingComments = false);
    }
  }

  Future<void> _submitComment() async {
    final text = _commentCtrl.text.trim();
    if (text.isEmpty || _isSubmitting) return;

    final auth = ref.read(authStateProvider);
    final authorId = auth.activeProfileId;
    final user = auth.user;
    if (authorId == null || user == null) return;

    final isAI =
        user.aiProfiles.any((p) => p.id == authorId);
    final authorType = isAI ? 'ai' : 'human';

    setState(() => _isSubmitting = true);
    _focusNode.unfocus();

    try {
      final newComment = await ref.read(feedServiceProvider).addComment(
            postId: widget.postId,
            content: text,
            authorId: authorId,
            authorType: authorType,
            assistedByAiId: authorType == 'human' ? _assistedBy?.id : null,
          );

      if (newComment != null && mounted) {
        _commentCtrl.clear();
        _assistedBy = null;
        setState(() {
          // The live update (comment:new) may have added it already.
          if (!_comments.any((c) => c.id == newComment.id)) {
            _comments.add(newComment);
            if (_post != null) {
              final newCount = _post!.commentCount + 1;
              _post = _post!.copyWith(commentCount: newCount);
              ref.read(feedProvider.notifier).syncCommentCount(widget.postId, newCount);
            }
          }
        });
        // Scroll to bottom
        Future.delayed(const Duration(milliseconds: 100), () {
          if (_scrollCtrl.hasClients) {
            _scrollCtrl.animateTo(
              _scrollCtrl.position.maxScrollExtent,
              duration: const Duration(milliseconds: 300),
              curve: Curves.easeOut,
            );
          }
        });
      } else if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Failed to post comment. Please try again.'),
            behavior: SnackBarBehavior.floating,
            backgroundColor: AppColors.error,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _toggleCommentLike(Comment comment) async {
    final idx = _comments.indexWhere((c) => c.id == comment.id);
    if (idx == -1) return;

    final auth = ref.read(authStateProvider);
    final authorId = auth.activeProfileId;
    final user = auth.user;
    if (authorId == null || user == null) return;

    final isAI = user.aiProfiles.any((p) => p.id == authorId);
    final authorType = isAI ? 'ai' : 'human';

    // Optimistic update
    setState(() {
      _comments[idx] = comment.copyWith(
        hasReacted: !comment.hasReacted,
        likeCount: comment.hasReacted
            ? comment.likeCount - 1
            : comment.likeCount + 1,
      );
    });

    final result = await ref.read(feedServiceProvider).reactToComment(
      _post!.id, 
      comment.id,
      authorId: authorId,
      authorType: authorType,
    );
    if (result == null && mounted) {
      // Rollback
      setState(() {
        _comments[idx] = comment;
      });
    } else if (result != null && mounted) {
      setState(() {
        _comments[idx] = _comments[idx].copyWith(
          likeCount: result['reaction_count'],
          hasReacted: result['reacted'],
        );
      });
    }
  }

  void _showCommentOptions(Comment comment) {
    final auth = ref.read(authStateProvider);
    final userId = auth.user?.id;
    final isCommentAuthor = comment.authorId == userId || (comment.authorType == AuthorType.human && comment.authorId == auth.user?.humanProfile?.id);
    final isPostAuthor = _post?.authorId == userId || (_post?.authorType == AuthorType.human && _post?.authorId == auth.user?.humanProfile?.id);

    // Allow reporting anyone's comment. 
    // Delete is restricted, but Report is public.
    // if (!isCommentAuthor && !isPostAuthor) return; 
    // Removing the early return so everyone can report.

    showModalBottomSheet(
      context: context,
      useRootNavigator: true, // above the home screen's frosted bar
      backgroundColor: Colors.transparent,
      builder: (context) => Container(
        decoration: BoxDecoration(
          color: Theme.of(context).scaffoldBackgroundColor,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        ),
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
              leading: const Icon(Icons.report_gmailerrorred_rounded, color: Colors.orange),
              title: const Text('Report Comment', style: TextStyle(color: Colors.orange)),
              onTap: () {
                Navigator.pop(context);
                _handleReportComment(comment);
              },
            ),
            if (isCommentAuthor || isPostAuthor)
              ListTile(
                leading: const Icon(Icons.delete_outline, color: AppColors.error),
                title: const Text('Delete Comment', style: TextStyle(color: AppColors.error)),
                onTap: () {
                  Navigator.pop(context);
                  _confirmDeleteComment(comment);
                },
              ),
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }

  void _handleReportComment(Comment comment) async {
    final reasons = ['Spam', 'Harassment', 'Hate Speech', 'Inappropriate', 'Other'];
    final reason = await showModalBottomSheet<String>(
      context: context,
      useRootNavigator: true, // above the home screen's frosted bar
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        decoration: BoxDecoration(
          color: Theme.of(ctx).cardColor,
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
                color: Theme.of(ctx).dividerColor,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const Padding(
              padding: EdgeInsets.all(20),
              child: Text(
                'Report Comment',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
              ),
            ),
            ...reasons.map((r) => ListTile(
                  title: Text(r),
                  onTap: () => Navigator.pop(ctx, r),
                  trailing: const Icon(Icons.chevron_right, size: 20),
                )),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );

    if (reason != null && mounted) {
      final ok = await ref.read(feedServiceProvider).reportComment(_post!.id, comment.id, reason);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                Icon(ok ? Icons.check_circle : Icons.error, color: Colors.white, size: 20),
                const SizedBox(width: 10),
                Text(ok ? 'Comment reported.' : 'Failed to submit report.'),
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

  void _confirmDeleteComment(Comment comment) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete Comment?'),
        content: const Text('Are you sure you want to delete this comment? This action cannot be undone.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              _deleteComment(comment);
            },
            style: TextButton.styleFrom(foregroundColor: AppColors.error),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
  }

  Future<void> _deleteComment(Comment comment) async {
    final ok = await ref.read(feedServiceProvider).deleteComment(_post!.id, comment.id);
    if (ok && mounted) {
      setState(() {
        _comments.removeWhere((c) => c.id == comment.id);
        _post = _post!.copyWith(commentCount: _post!.commentCount - 1);
        ref.read(feedProvider.notifier).syncCommentCount(_post!.id, _post!.commentCount);
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Comment deleted')),
      );
    } else if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Failed to delete comment'), backgroundColor: AppColors.error),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final isPublished = _post?.status == 'published';

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        backgroundColor: Theme.of(context).appBarTheme.backgroundColor,
        elevation: 0,
        title: const Text(
          'Post',
          style: TextStyle(fontWeight: FontWeight.w700),
        ),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, size: 20),
          onPressed: () => context.pop(),
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: AppColors.primary))
          : _error != null
              ? _buildError()
              : _post == null
                  ? const Center(child: Text('Post not found'))
                  : !isPublished
                      ? ListView(
                          controller: _scrollCtrl,
                          children: [
                            PostCard(post: _post!),
                            Padding(
                              padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                              child: Container(
                                width: double.infinity,
                                padding: const EdgeInsets.all(14),
                                decoration: BoxDecoration(
                                  color: AppColors.warning.withOpacity(0.08),
                                  borderRadius: BorderRadius.circular(14),
                                  border: Border.all(
                                    color: AppColors.warning.withOpacity(0.25),
                                  ),
                                ),
                                child: const Text(
                                  'This post is still pending approval, so comments are disabled until it is published.',
                                  style: TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                    color: AppColors.warning,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        )
                  : Column(
                      children: [
                        Expanded(
                          child: ListView(
                            controller: _scrollCtrl,
                            children: [
                              // ── The Post ────────────────────────────────
                              PostCard(post: _post!),

                              // ── Comments header ─────────────────────────
                              Padding(
                                padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                                child: Row(
                                  children: [
                                    const Icon(Icons.chat_bubble_outline_rounded,
                                        size: 18, color: AppColors.primary),
                                    const SizedBox(width: 8),
                                    Text(
                                      '${_post!.commentCount} Comment${_post!.commentCount == 1 ? '' : 's'}',
                                      style: TextStyle(
                                        fontSize: 15,
                                        fontWeight: FontWeight.w700,
                                        color: Theme.of(context)
                                            .colorScheme
                                            .onSurface,
                                      ),
                                    ),
                                    const Spacer(),
                                    if (_isLoadingComments)
                                      const SizedBox(
                                        width: 16,
                                        height: 16,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                          color: AppColors.primary,
                                        ),
                                      ),
                                  ],
                                ),
                              ),

                              // ── Comments List ────────────────────────────
                              if (_comments.isEmpty && !_isLoadingComments)
                                Padding(
                                  padding: const EdgeInsets.symmetric(
                                      vertical: 32, horizontal: 24),
                                  child: Column(
                                    children: [
                                      Icon(
                                        Icons.chat_bubble_outline_rounded,
                                        size: 48,
                                        color: isDark
                                            ? AppColors.textSecondaryDark
                                            : AppColors.textTertiary,
                                      ),
                                      const SizedBox(height: 12),
                                      Text(
                                        'No comments yet',
                                        style: TextStyle(
                                          fontSize: 15,
                                          fontWeight: FontWeight.w600,
                                          color: isDark
                                              ? AppColors.textSecondaryDark
                                              : AppColors.textSecondary,
                                        ),
                                      ),
                                      const SizedBox(height: 6),
                                      Text(
                                        'Be the first to share your thoughts!',
                                        textAlign: TextAlign.center,
                                        style: TextStyle(
                                          fontSize: 13,
                                          color: isDark
                                              ? AppColors.textSecondaryDark
                                              : AppColors.textTertiary,
                                        ),
                                      ),
                                    ],
                                  ),
                                )
                              else
                                ..._comments
                                    .map((c) => _CommentTile(
                                          comment: c,
                                          onLike: () => _toggleCommentLike(c),
                                          onLongPress: () => _showCommentOptions(c),
                                        ))
                                    .toList(),

                              const SizedBox(height: 80),
                            ],
                          ),
                        ),

                        // ── Comment Input Bar ────────────────────────────
                        _buildCommentInput(isDark),
                      ],
                    ),
    );
  }

  Widget _buildCommentInput(bool isDark) {
    final auth = ref.watch(authStateProvider);
    final user = auth.user;
    final avatar = user?.humanProfile?.avatar;
    final name = user?.humanProfile?.displayName ?? 'You';

    return Container(
      decoration: BoxDecoration(
        color: isDark ? AppColors.surfaceDark : AppColors.surface,
        border: Border(
          top: BorderSide(
            color: isDark ? AppColors.borderDark : AppColors.border,
            width: 0.5,
          ),
        ),
      ),
      padding: EdgeInsets.only(
        left: 16,
        right: 12,
        top: 10,
        bottom: MediaQuery.of(context).padding.bottom > 0
            ? MediaQuery.of(context).padding.bottom
            : 10,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          AvatarWidget(
            avatarUrl: avatar,
            displayName: name,
            radius: 18,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: TextField(
              controller: _commentCtrl,
              focusNode: _focusNode,
              maxLines: 3,
              minLines: 1,
              textInputAction: TextInputAction.newline,
              decoration: InputDecoration(
                hintText: _drafting ? 'Your AI is writing…' : 'Add a comment...',
                prefixIcon: _assistedBy == null
                    ? null
                    : IconButton(
                        tooltip: 'Replied with ${_assistedBy!.name}. Tap to remove the tag.',
                        icon: const Icon(Icons.auto_awesome_rounded, color: AppColors.badgeAI, size: 18),
                        onPressed: () => setState(() => _assistedBy = null),
                      ),
                hintStyle: TextStyle(
                  color: isDark
                      ? AppColors.textSecondaryDark
                      : AppColors.textSecondary,
                  fontSize: 14,
                ),
                filled: true,
                fillColor: isDark
                    ? AppColors.borderDark.withOpacity(0.5)
                    : AppColors.surfaceVariant,
                contentPadding: const EdgeInsets.symmetric(
                    horizontal: 16, vertical: 10),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(20),
                  borderSide: BorderSide.none,
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(20),
                  borderSide: BorderSide.none,
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(20),
                  borderSide: const BorderSide(
                      color: AppColors.primary, width: 1.5),
                ),
              ),
              onChanged: (_) => setState(() {}),
            ),
          ),
          IconButton(
            tooltip: 'Reply with your AI',
            onPressed: _drafting ? null : _replyWithAi,
            icon: _drafting
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.smart_toy_outlined, color: AppColors.primary),
          ),
          GestureDetector(
            onTap: _commentCtrl.text.trim().isEmpty || _isSubmitting
                ? null
                : _submitComment,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: _commentCtrl.text.trim().isEmpty || _isSubmitting
                    ? (isDark
                        ? AppColors.borderDark
                        : AppColors.subtle)
                    : AppColors.primary,
                shape: BoxShape.circle,
              ),
              child: _isSubmitting
                  ? const Padding(
                      padding: EdgeInsets.all(10),
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        valueColor:
                            AlwaysStoppedAnimation<Color>(Colors.white),
                      ),
                    )
                  : Icon(
                      Icons.send_rounded,
                      size: 18,
                      color: _commentCtrl.text.trim().isEmpty
                          ? AppColors.textTertiary
                          : Colors.white,
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildError() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.error_outline, size: 48, color: AppColors.error),
          const SizedBox(height: 16),
          Text(_error ?? 'Unknown error'),
          const SizedBox(height: 16),
          ElevatedButton(
            onPressed: _loadPost,
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}

// ─── Comment Tile ─────────────────────────────────────────────────────────────
class _CommentTile extends StatelessWidget {
  final Comment comment;
  final VoidCallback onLike;
  final VoidCallback onLongPress;

  const _CommentTile({
    required this.comment,
    required this.onLike,
    required this.onLongPress,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return GestureDetector(
      onLongPress: onLongPress,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AvatarWidget(
              avatarUrl: comment.authorAvatar,
              displayName: comment.authorDisplayName,
              radius: 18,
              isAI: comment.authorType == AuthorType.ai,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 14, vertical: 10),
                    decoration: BoxDecoration(
                      color: isDark
                          ? AppColors.surfaceDark
                          : AppColors.surfaceVariant,
                      borderRadius: const BorderRadius.only(
                        topLeft: Radius.circular(4),
                        topRight: Radius.circular(16),
                        bottomLeft: Radius.circular(16),
                        bottomRight: Radius.circular(16),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Text(
                              comment.authorDisplayName,
                              style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w700,
                                color: Theme.of(context).colorScheme.onSurface,
                              ),
                            ),
                            const SizedBox(width: 4),
                            Text(
                              '@${comment.authorUsername}',
                              style: const TextStyle(
                                fontSize: 12,
                                color: AppColors.textSecondary,
                              ),
                            ),
                            if (comment.authorType == AuthorType.ai) ...const [
                              SizedBox(width: 4),
                              Icon(Icons.smart_toy_outlined,
                                  size: 12, color: AppColors.badgeAI),
                            ],
                          ],
                        ),
                        if (comment.assistedByName != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 2),
                            child: Row(children: [
                              const Icon(Icons.auto_awesome_rounded, size: 11, color: AppColors.badgeAI),
                              const SizedBox(width: 3),
                              Flexible(
                                child: Text('Replied with ${comment.assistedByName}',
                                    maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.badgeAI, fontSize: 11, fontWeight: FontWeight.w600)),
                              ),
                            ]),
                          ),
                        const SizedBox(height: 4),
                        Text(
                          comment.content,
                          style: TextStyle(
                            fontSize: 14,
                            height: 1.4,
                            color: Theme.of(context).colorScheme.onSurface,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 4),
                  Padding(
                    padding: const EdgeInsets.only(left: 4),
                    child: Row(
                      children: [
                        Text(
                          timeago.format(comment.createdAt),
                          style: const TextStyle(
                            fontSize: 11,
                            color: AppColors.textTertiary,
                          ),
                        ),
                        const SizedBox(width: 16),
                        GestureDetector(
                          onTap: onLike,
                          child: Row(
                            children: [
                              Icon(
                                comment.hasReacted
                                    ? Icons.favorite_rounded
                                    : Icons.favorite_outline_rounded,
                                size: 14,
                                color: comment.hasReacted
                                    ? AppColors.error
                                    : AppColors.textTertiary,
                              ),
                              if (comment.likeCount > 0) ...[
                                const SizedBox(width: 4),
                                Text(
                                  comment.likeCount.toString(),
                                  style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w600,
                                    color: comment.hasReacted
                                        ? AppColors.error
                                        : AppColors.textTertiary,
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
