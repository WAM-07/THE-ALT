import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../providers/feed_provider.dart';
import '../../models/post_model.dart';
import '../../theme/app_theme.dart';
import '../../widgets/post_card.dart';

class PendingApprovalsScreen extends ConsumerStatefulWidget {
  const PendingApprovalsScreen({super.key});

  @override
  ConsumerState<PendingApprovalsScreen> createState() => _PendingApprovalsScreenState();
}

class _PendingApprovalsScreenState extends ConsumerState<PendingApprovalsScreen> {
  List<Post> _pendingPosts = [];
  bool _isLoading = true;
  bool _isGenerating = false;

  @override
  void initState() {
    super.initState();
    _loadPending();
  }

  Future<void> _loadPending() async {
    setState(() => _isLoading = true);
    final posts = await ref.read(feedServiceProvider).getPendingApprovals();
    if (mounted) {
      setState(() {
        _pendingPosts = posts;
        _isLoading = false;
      });
    }
  }

  void _handleApprove(String postId) async {
    final success = await ref.read(feedServiceProvider).approvePost(postId);
    if (success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Post approved and published.'), backgroundColor: AppColors.success),
      );
      _loadPending(); // Refresh list
    }
  }

  void _handleReject(String postId) async {
    final success = await ref.read(feedServiceProvider).rejectPost(postId);
    if (success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Post rejected and deleted.'), backgroundColor: AppColors.error),
      );
      _loadPending(); // Refresh list
    }
  }

  Future<void> _generateAIPosts() async {
    setState(() => _isGenerating = true);
    final count = await ref.read(feedServiceProvider).generateAIPosts();
    if (mounted) {
      setState(() => _isGenerating = false);
      if (count > 0) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Generated $count AI post(s)!'), backgroundColor: AppColors.success),
        );
        _loadPending();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No posts generated (Rate limit or no AIs found).')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        title: const Text('Pending Approvals', style: TextStyle(fontWeight: FontWeight.bold)),
        backgroundColor: Theme.of(context).appBarTheme.backgroundColor,
        actions: [
          if (_isGenerating)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 20),
              child: Center(child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))),
            )
          else
            TextButton.icon(
              onPressed: _generateAIPosts,
              icon: const Icon(Icons.auto_awesome, size: 16),
              label: const Text('Generate'),
            ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: AppColors.primary))
          : _pendingPosts.isEmpty
              ? _buildEmptyState()
              : ListView.builder(
                  padding: const EdgeInsets.only(top: 16, bottom: 80),
                  itemCount: _pendingPosts.length,
                  itemBuilder: (ctx, i) {
                    final post = _pendingPosts[i];
                    return Column(
                      children: [
                        PostCard(post: post),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
                          child: Row(
                            children: [
                              Expanded(
                                child: OutlinedButton.icon(
                                  onPressed: () => _handleReject(post.id),
                                  icon: const Icon(Icons.close_rounded, color: AppColors.error),
                                  label: const Text('Reject', style: TextStyle(color: AppColors.error)),
                                  style: OutlinedButton.styleFrom(
                                    side: const BorderSide(color: AppColors.error),
                                  ),
                                ),
                              ),
                              const SizedBox(width: 16),
                              Expanded(
                                child: FilledButton.icon(
                                  onPressed: () => _handleApprove(post.id),
                                  icon: const Icon(Icons.check_rounded),
                                  label: const Text('Approve'),
                                  style: FilledButton.styleFrom(
                                    backgroundColor: AppColors.success,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const Divider(height: 32),
                      ],
                    );
                  },
                ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.check_circle_outline_rounded, size: 64, color: AppColors.textTertiary.withOpacity(0.5)),
          const SizedBox(height: 16),
          const Text('You\'re all caught up!', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          const Text('No AI posts are waiting for your approval.', style: TextStyle(color: AppColors.textSecondary)),
          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: _isGenerating ? null : _generateAIPosts,
            icon: const Icon(Icons.auto_awesome),
            label: Text(_isGenerating ? 'Generating...' : 'Generate AI Posts'),
          ),
        ],
      ),
    );
  }
}
