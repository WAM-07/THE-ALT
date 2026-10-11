import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../config/app_config.dart';
import '../../models/post_model.dart';
import '../../providers/auth_provider.dart';
import '../../providers/feed_provider.dart';
import '../../services/feed_service.dart';
import '../../theme/app_theme.dart';
import '../../widgets/avatar_widget.dart';
import '../../models/message_model.dart';
import '../../models/user_model.dart';


class VisitingProfileScreen extends ConsumerStatefulWidget {
  final String profileId;
  final String profileType;

  const VisitingProfileScreen({
    super.key,
    required this.profileId,
    this.profileType = 'human',
  });

  @override
  ConsumerState<VisitingProfileScreen> createState() => _VisitingProfileScreenState();
}

class _VisitingProfileScreenState extends ConsumerState<VisitingProfileScreen> with SingleTickerProviderStateMixin {
  bool _isLoading = true;
  Map<String, dynamic>? _profileData;
  String? _error;
  List<Post> _posts = [];
  List<AIProfile> _aiProfiles = [];
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _fetchProfile();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _fetchProfile() async {
    if (!mounted) return;
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final data = await ref.read(feedServiceProvider).getProfile(
            widget.profileId,
            type: widget.profileType,
          );
      if (mounted) {
        setState(() {
          if (data == null) {
            _error = 'Profile not found';
          } else {
            _profileData = data;
            _posts = (data['posts'] as List)
                .map((p) => Post.fromJson(p))
                .toList();
            
            // Extract AI profiles from the response
            final List<dynamic> aiRaw = data['profile']['ai_profiles'] ?? [];
            _aiProfiles = aiRaw.map((p) => AIProfile.fromJson(p)).toList();
          }
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = 'Failed to load profile';
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator(color: AppColors.primary)),
      );
    }

    if (_error != null) {
      return Scaffold(
        appBar: AppBar(
          leading: IconButton(
            icon: const Icon(Icons.arrow_back_ios_new_rounded),
            onPressed: () => context.pop(),
          ),
          title: const Text('Error'),
        ),
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_error!),
              const SizedBox(height: 16),
              ElevatedButton(onPressed: _fetchProfile, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }

    final vProfile = _profileData!['visiting_profile'];
    final username = vProfile['username'] ?? 'user';
    final displayName = vProfile['display_name'] ?? vProfile['full_name'] ?? 'User';
    final avatar = vProfile['avatar'];
    final bio = vProfile['bio'];
    final followerCount = vProfile['follower_count'] ?? 0;
    final followingCount = vProfile['following_count'] ?? 0;
    final postCount = vProfile['post_count'] ?? 0;
    final isFollowing = vProfile['is_following'] ?? false;
    final isBlocked = vProfile['is_blocked'] ?? false;
    final isAI = vProfile['is_ai'] == true;

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        backgroundColor: Theme.of(context).scaffoldBackgroundColor,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 20),
          onPressed: () => context.pop(),
        ),
        title: Text(
          username,
          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.more_vert_rounded),
            onPressed: () => _showMoreOptions(isBlocked),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _fetchProfile,
        child: NestedScrollView(
          headerSliverBuilder: (context, innerBoxIsScrolled) => [
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        AvatarWidget(
                          avatarUrl: avatar,
                          displayName: displayName,
                          radius: 42,
                          isAI: isAI,
                        ),
                        Expanded(
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                            children: [
                              _StatItem(label: 'Posts', value: '$postCount'),
                              GestureDetector(
                                onTap: () => _showFollowList(context, 'Followers', widget.profileId, isAI),
                                child: _StatItem(label: 'Followers', value: _fmt(followerCount)),
                              ),
                              GestureDetector(
                                onTap: () => _showFollowList(context, 'Following', widget.profileId, isAI),
                                child: _StatItem(label: 'Following', value: _fmt(followingCount)),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Text(
                      displayName,
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                    ),
                    if (bio != null && bio.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        bio,
                        style: const TextStyle(fontSize: 14, height: 1.4),
                      ),
                    ],
                    const SizedBox(height: 20),
                    Row(
                      children: [
                        if (isBlocked)
                          Expanded(
                            child: _ActionButton(
                              label: 'Unblock',
                              color: Colors.red,
                              onTap: () => _toggleBlock(true),
                            ),
                          )
                        else ...[
                          Expanded(
                            child: _ActionButton(
                              label: isFollowing ? 'Following' : 'Follow',
                              color: isFollowing ? AppColors.textTertiary : AppColors.primary,
                              onTap: () async {
                                final ok = await ref.read(feedProvider.notifier).toggleFollow(
                                  widget.profileId,
                                  widget.profileType,
                                );
                                if (ok) _fetchProfile();
                              },
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: _ActionButton(
                              label: 'Message',
                              onTap: () => _openConversation(vProfile),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SliverToBoxAdapter(child: SizedBox(height: 12)),
            SliverPersistentHeader(
              pinned: true,
              delegate: _TabDelegate(_tabController),
            ),
          ],
          body: TabBarView(
            controller: _tabController,
            children: [
              // Posts Tab
              _posts.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.camera_alt_outlined, size: 64, color: AppColors.textTertiary),
                          const SizedBox(height: 16),
                          const Text(
                            'No Posts Yet',
                            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                          ),
                        ],
                      ),
                    )
                  : GridView.builder(
                      padding: const EdgeInsets.only(top: 1),
                      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: 3,
                        crossAxisSpacing: 1,
                        mainAxisSpacing: 1,
                      ),
                      itemCount: _posts.length,
                      itemBuilder: (context, index) => _PostGridItem(post: _posts[index]),
                    ),
              
              // AIs Tab
              _aiProfiles.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.smart_toy_outlined, size: 64, color: AppColors.textTertiary),
                          const SizedBox(height: 16),
                          const Text(
                            'No AI Personas',
                            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            '@$username hasn\'t created any AI personas yet.',
                            style: const TextStyle(color: AppColors.textSecondary),
                          ),
                        ],
                      ),
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      itemCount: _aiProfiles.length,
                      itemBuilder: (context, index) {
                        final ai = _aiProfiles[index];
                        return ListTile(
                          leading: AvatarWidget(
                            avatarUrl: ai.avatar,
                            displayName: ai.displayName,
                            radius: 24,
                            isAI: true,
                          ),
                          title: Text(ai.displayName, style: const TextStyle(fontWeight: FontWeight.bold)),
                          subtitle: Text('@${ai.username}'),
                          trailing: const Icon(Icons.chevron_right_rounded),
                          onTap: () {
                            context.push('/profile?id=${ai.id}&type=ai');
                          },
                        );
                      },
                    ),
            ],
          ),
        ),
      ),
    );
  }

  void _handleReport() async {
    final reasons = ['Spam', 'Impersonation', 'Inappropriate Content', 'Harassment', 'Other'];
    final reason = await showModalBottomSheet<String>(
      context: context,
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
                'Report Profile',
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
      final type = widget.profileType == 'ai' ? 'ai' : 'human';
      final ok = await ref.read(feedServiceProvider).reportProfile(widget.profileId, reason, type: type);
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                Icon(ok ? Icons.check_circle : Icons.error, color: Colors.white, size: 20),
                const SizedBox(width: 10),
                Text(ok ? 'Profile reported. Thank you.' : 'Failed to submit report.'),
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

  void _toggleBlock(bool isBlocked) async {
    final activeId = ref.read(authStateProvider).activeProfileId;
    bool success;
    if (isBlocked) {
      success = await ref.read(feedServiceProvider).unblockProfile(widget.profileId, blockerId: activeId);
    } else {
      success = await ref.read(feedServiceProvider).blockProfile(widget.profileId, blockerId: activeId);
    }

    if (success) {
      _fetchProfile();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(isBlocked ? 'Profile unblocked' : 'Profile blocked')),
        );
      }
    }
  }

  void _showMoreOptions(bool isBlocked) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        decoration: BoxDecoration(
          color: Theme.of(ctx).cardColor,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: SafeArea(
          top: false,
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
              const SizedBox(height: 12),
              ListTile(
                leading: Icon(
                  isBlocked ? Icons.check_circle_outline_rounded : Icons.block_flipped,
                  color: Colors.red,
                ),
                title: Text(
                  isBlocked ? 'Unblock Profile' : 'Block Profile',
                  style: const TextStyle(color: Colors.red, fontWeight: FontWeight.w600),
                ),
                onTap: () {
                  Navigator.pop(ctx);
                  _toggleBlock(isBlocked);
                },
              ),
              ListTile(
                leading: const Icon(Icons.report_gmailerrorred_rounded),
                title: const Text('Report Profile'),
                onTap: () {
                  Navigator.pop(ctx);
                  _handleReport();
                },
              ),
              const SizedBox(height: 12),
            ],
          ),
        ),
      ),
    );
  }

  String _fmt(int n) => n >= 1000 ? '${(n / 1000).toStringAsFixed(1)}K' : '$n';

  void _openConversation(Map<String, dynamic> pData) {
    final auth = ref.read(authStateProvider);
    final activeProfileId = auth.activeProfileId;
    if (activeProfileId == null) return;

    final activeIsAI = activeProfileId != auth.user?.humanProfile?.id;
    final isAI = pData['is_ai'] == true;
    final profileId = pData['id'] ?? '';
    
    final participants = [
      '${activeIsAI ? 'ai' : 'human'}:$activeProfileId',
      '${isAI ? 'ai' : 'human'}:$profileId',
    ]..sort();
    final conversationId = participants.join('|');

    final conversation = Conversation(
      id: conversationId,
      userId: pData['user_id'] ?? profileId,
      profileId: profileId,
      userName: pData['display_name'] ?? pData['full_name'] ?? '',
      userAvatarUrl: pData['avatar'],
      userIsVerified: pData['is_verified'] ?? false,
      userIsAI: isAI,
      unreadCount: 0,
      createdAt: DateTime.now(),
    );

    context.push(
      '/messages/${Uri.encodeComponent(conversationId)}',
      extra: conversation,
    );
  }

  void _showFollowList(BuildContext context, String title, String targetProfileId, bool targetIsAI) {
    final auth = ref.read(authStateProvider);
    final profileIdNullable = auth.activeProfileId;
    if (profileIdNullable == null) return;
    final String profileId = profileIdNullable;
    final activeIsAI = auth.user?.aiProfiles.any((p) => p.id == profileId) ?? false;

    final kind = title.toLowerCase();
    var refreshTick = 0;

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => StatefulBuilder(
        builder: (context, setModalState) => Container(
          height: MediaQuery.of(context).size.height * 0.7,
          decoration: BoxDecoration(
            color: Theme.of(context).cardColor,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: Column(
            children: [
              const SizedBox(height: 12),
              Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                      color: Theme.of(context).dividerColor,
                      borderRadius: BorderRadius.circular(2))),
              Padding(
                padding: const EdgeInsets.all(16),
                child: Text(title,
                    style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        color: Theme.of(context).colorScheme.onSurface)),
              ),
              const Divider(height: 1, color: AppColors.divider),
              Expanded(
                child: FutureBuilder<List<FollowProfile>>(
                  future: ref.read(feedServiceProvider).getFollowList(
                        profileId: targetProfileId,
                        kind: kind,
                        profileType: targetIsAI ? 'ai' : 'human',
                      ),
                  builder: (context, snapshot) {
                    if (!snapshot.hasData) {
                      return const Center(child: CircularProgressIndicator());
                    }

                    final items = snapshot.data ?? [];
                    if (items.isEmpty) {
                      return Center(
                        child: Text(
                          'No $kind yet',
                          style: TextStyle(color: AppColors.textSecondary),
                        ),
                      );
                    }

                    return ListView.builder(
                      itemCount: items.length,
                      itemBuilder: (ctx, i) {
                        final item = items[i];
                        return ListTile(
                          leading: CircleAvatar(
                            backgroundColor: item.isAI
                                ? AppColors.badgeAI.withOpacity(0.15)
                                : AppColors.primary.withOpacity(0.1),
                            child: Text(
                              item.isAI
                                  ? 'AI'
                                  : item.displayName[0].toUpperCase(),
                              style: TextStyle(
                                color: item.isAI
                                    ? AppColors.badgeAI
                                    : AppColors.primary,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          title: Text(
                            item.displayName,
                            style: TextStyle(
                              fontWeight: FontWeight.w600,
                              color: Theme.of(context).colorScheme.onSurface,
                            ),
                          ),
                          subtitle: Text(
                            '@${item.username}',
                            style:
                                const TextStyle(color: AppColors.textSecondary),
                          ),
                          trailing: item.id == profileId
                              ? null
                              : FutureBuilder<bool>(
                                  key: ValueKey('${kind}:${item.id}:$refreshTick'),
                                  future: kind == 'followers'
                                      ? ref
                                          .read(feedServiceProvider)
                                          .isFollowingProfile(
                                            item.id,
                                            followerId: profileId,
                                            followerType:
                                                activeIsAI ? 'ai' : 'human',
                                          )
                                      : _doesProfileFollowActiveProfile(
                                          activeProfileId: profileId,
                                          profile: item,
                                        ),
                                  builder: (context, relationSnapshot) {
                                    final isMutual = relationSnapshot.data ?? false;
                                    
                                    if (kind == 'followers') {
                                       return TextButton(
                                         onPressed: () async {
                                           await ref.read(feedProvider.notifier).toggleFollow(
                                             item.id,
                                             item.isAI ? 'ai' : 'human',
                                           );
                                           setModalState(() {
                                             refreshTick++;
                                           });
                                         },
                                         child: Text(isMutual ? 'Following' : 'Follow Back'),
                                       );
                                    }
                                    return const SizedBox.shrink();
                                  },
                                ),
                          onTap: () {
                            Navigator.pop(context);
                            context.push('/profile?id=${item.id}&type=${item.isAI ? 'ai' : 'human'}');
                          },
                        );
                      },
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<bool> _doesProfileFollowActiveProfile({
    required String activeProfileId,
    required FollowProfile profile,
  }) {
    return ref.read(feedServiceProvider).isFollowingProfile(
          activeProfileId,
          followerId: profile.id,
          followerType: profile.isAI ? 'ai' : 'human',
        );
  }
}

class _StatItem extends StatelessWidget {
  final String label;
  final String value;
  const _StatItem({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          value,
          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18),
        ),
        Text(
          label,
          style: const TextStyle(fontSize: 13, color: AppColors.textSecondary),
        ),
      ],
    );
  }
}

class _FollowButton extends StatelessWidget {
  final bool isFollowing;
  final VoidCallback onTap;
  const _FollowButton({required this.isFollowing, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8),
        decoration: BoxDecoration(
          color: isFollowing ? AppColors.divider : AppColors.primary,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Center(
          child: Text(
            isFollowing ? 'Following' : 'Follow',
            style: TextStyle(
              fontWeight: FontWeight.w700,
              fontSize: 14,
              color: isFollowing ? Theme.of(context).colorScheme.onSurface : Colors.white,
            ),
          ),
        ),
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final String? label;
  final IconData? icon;
  final VoidCallback onTap;
  final bool compact;
  final Color? color;
  const _ActionButton({this.label, this.icon, required this.onTap, this.compact = false, this.color});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: EdgeInsets.symmetric(vertical: 8, horizontal: compact ? 8 : 12),
        decoration: BoxDecoration(
          color: color?.withOpacity(0.1) ?? AppColors.divider,
          borderRadius: BorderRadius.circular(8),
          border: color != null ? Border.all(color: color!.withOpacity(0.5)) : null,
        ),
        child: Center(
          child: icon != null
              ? Icon(icon, size: 20, color: color)
              : Text(
                  label!,
                  style: TextStyle(
                    fontWeight: FontWeight.w700, 
                    fontSize: 14,
                    color: color,
                  ),
                ),
        ),
      ),
    );
  }
}

class _TabDelegate extends SliverPersistentHeaderDelegate {
  final TabController tabController;
  _TabDelegate(this.tabController);

  @override
  double get minExtent => 48;
  @override
  double get maxExtent => 48;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).scaffoldBackgroundColor,
        border: Border(
          bottom: BorderSide(color: Theme.of(context).dividerColor, width: 0.5),
        ),
      ),
      child: TabBar(
        controller: tabController,
        indicatorColor: AppColors.primary,
        indicatorWeight: 1.5,
        labelColor: AppColors.primary,
        unselectedLabelColor: AppColors.textTertiary.withOpacity(0.5),
        dividerColor: Colors.transparent,
        tabs: [
          const Tab(icon: Icon(Icons.grid_on_rounded, size: 22)),
          const Tab(icon: Icon(Icons.smart_toy_outlined, size: 22)),
        ],
      ),
    );
  }

  @override
  bool shouldRebuild(covariant _TabDelegate oldDelegate) => 
      tabController != oldDelegate.tabController;
}

class _PostGridItem extends StatelessWidget {
  final Post post;
  const _PostGridItem({required this.post});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => context.push('/post/${post.id}'),
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (post.mediaUrls.isNotEmpty)
            Image.network(
              AppConfig.resolveUrl(post.mediaUrls.first),
              fit: BoxFit.cover,
              errorBuilder: (context, error, stackTrace) => Container(
                color: Theme.of(context).dividerColor.withOpacity(0.1),
                child: const Icon(Icons.broken_image, color: AppColors.textTertiary),
              ),
            )
          else
            Container(
              color: AppColors.primary.withOpacity(0.05),
              padding: const EdgeInsets.all(12),
              child: Text(
                post.content,
                maxLines: 6,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 10, color: AppColors.textSecondary),
              ),
            ),
          if (post.mediaUrls.length > 1)
            const Positioned(
              top: 8,
              right: 8,
              child: Icon(Icons.collections_rounded, color: Colors.white, size: 18),
            ),
        ],
      ),
    );
  }
}
