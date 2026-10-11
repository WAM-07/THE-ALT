import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../models/story_model.dart';
import '../../providers/feed_provider.dart';
import '../../providers/auth_provider.dart';
import '../../providers/story_provider.dart';
import '../../providers/notifications_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/post_card.dart';
import '../../widgets/avatar_widget.dart';
import '../../services/image_service.dart';
import 'package:image_picker/image_picker.dart';
import 'story_viewer_dialog.dart';

class FeedScreen extends ConsumerStatefulWidget {
  const FeedScreen({super.key});

  @override
  ConsumerState<FeedScreen> createState() => _FeedScreenState();
}

class _FeedScreenState extends ConsumerState<FeedScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final _scrollController = ScrollController();

  static const _tabs = [
    ('feed', 'All'),
    ('ai', 'AI Personas'),
    ('humans', 'Humans'),
  ];

  final _trendingTags = [
    '#AIT',
    '#ALTERA',
    '#AIPersonas',
    '#Web3Social',
    '#LLaMA3',
  ];
  final _topicFilters = ['web3', 'aiethics', 'flutter', 'defi', 'vectordb'];
  final _aiCategories = ['companion', 'creative', 'technical', 'general'];

  String? _activeHashtag;
  String? _activeTopic;
  String? _activeAiCategory;
  String? _activeSortBy;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: _tabs.length, vsync: this);
    _tabController.addListener(_onTabChange);
    _scrollController.addListener(_onScroll);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(feedProvider.notifier).loadFeed(tab: 'feed', refresh: true);
    });
  }

  void _onTabChange() {
    if (!_tabController.indexIsChanging) {
      final tab = _tabs[_tabController.index].$1;
      ref.read(feedProvider.notifier).loadFeed(
            tab: tab,
            refresh: true,
            hashtag: _activeHashtag,
            topic: _activeTopic,
            aiCategory: _activeAiCategory,
            sortBy: _activeSortBy,
          );
    }
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 300) {
      ref.read(feedProvider.notifier).loadMore();
    }
  }

  @override
  void dispose() {
    _tabController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final feedState = ref.watch(feedProvider);

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      extendBodyBehindAppBar: true,
      appBar: PreferredSize(
        preferredSize: const Size.fromHeight(140),
        child: ClipRRect(
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 15, sigmaY: 15),
            child: AppBar(
              backgroundColor: Theme.of(context)
                  .appBarTheme
                  .backgroundColor!
                  .withOpacity(0.7),
              elevation: 0,
              scrolledUnderElevation: 0,
              titleSpacing: 16,
              title: ShaderMask(
                shaderCallback: (bounds) => const LinearGradient(
                  colors: AppColors.primaryGradient,
                  begin: Alignment.centerLeft,
                  end: Alignment.centerRight,
                ).createShader(bounds),
                child: const Text(
                  'ALTERA',
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                    letterSpacing: 2,
                  ),
                ),
              ),
              actions: [
                Consumer(
                  builder: (context, ref, child) {
                    final unreadCount =
                        ref.watch(notificationsProvider).unreadCount;
                    return IconButton(
                      icon: Stack(
                        children: [
                          Icon(
                            Icons.notifications_none_rounded,
                            size: 26,
                            color: Theme.of(context).colorScheme.onSurface,
                          ),
                          if (unreadCount > 0)
                            Positioned(
                              right: 0,
                              top: 0,
                              child: Container(
                                padding: const EdgeInsets.all(2),
                                decoration: BoxDecoration(
                                  color: AppColors.primary,
                                  shape: BoxShape.circle,
                                  border: Border.all(
                                    color: Theme.of(context)
                                        .appBarTheme
                                        .backgroundColor!,
                                    width: 1.5,
                                  ),
                                ),
                                constraints: const BoxConstraints(
                                  minWidth: 14,
                                  minHeight: 14,
                                ),
                                child: Text(
                                  unreadCount > 9 ? '9+' : '$unreadCount',
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 8,
                                    fontWeight: FontWeight.bold,
                                  ),
                                  textAlign: TextAlign.center,
                                ),
                              ),
                            ),
                        ],
                      ),
                      onPressed: () => context.push('/notifications'),
                    );
                  },
                ),
                const SizedBox(width: 8),
              ],
              bottom: PreferredSize(
                preferredSize: const Size.fromHeight(80),
                child: Column(
                  children: [
                    Container(
                      decoration: BoxDecoration(
                        border: Border(
                          bottom: BorderSide(
                            color:
                                Theme.of(context).dividerColor.withOpacity(0.1),
                            width: 0.5,
                          ),
                        ),
                      ),
                      child: TabBar(
                        controller: _tabController,
                        tabs: _tabs.map((t) => Tab(text: t.$2)).toList(),
                        isScrollable: false,
                        dividerColor: Colors.transparent,
                        labelStyle: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 13,
                        ),
                        unselectedLabelStyle: const TextStyle(
                          fontWeight: FontWeight.w500,
                          fontSize: 13,
                        ),
                      ),
                    ),
                    SizedBox(
                      height: 38,
                      child: ListView(
                        scrollDirection: Axis.horizontal,
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 4,
                        ),
                        children: [
                          _FilterChip(
                            label: 'Top',
                            active: _activeSortBy == 'engagement',
                            onTap: () {
                              setState(() {
                                _activeSortBy = _activeSortBy == 'engagement'
                                    ? null
                                    : 'engagement';
                              });
                              _reloadFeed();
                            },
                          ),
                          const SizedBox(width: 6),
                          ..._trendingTags.map(
                            (tag) => Padding(
                              padding: const EdgeInsets.only(right: 6),
                              child: _FilterChip(
                                label: tag,
                                active: _activeHashtag == tag,
                                onTap: () {
                                  setState(() {
                                    _activeHashtag =
                                        _activeHashtag == tag ? null : tag;
                                  });
                                  _reloadFeed();
                                },
                              ),
                            ),
                          ),
                          ..._topicFilters.map(
                            (topic) => Padding(
                              padding: const EdgeInsets.only(right: 6),
                              child: _FilterChip(
                                label: '#${_formatFilterLabel(topic)}',
                                active: _activeTopic == topic,
                                onTap: () {
                                  setState(() {
                                    _activeTopic =
                                        _activeTopic == topic ? null : topic;
                                  });
                                  _reloadFeed();
                                },
                              ),
                            ),
                          ),
                          ..._aiCategories.map(
                            (category) => Padding(
                              padding: const EdgeInsets.only(right: 6),
                              child: _FilterChip(
                                label: _formatFilterLabel(category),
                                active: _activeAiCategory == category,
                                onTap: () {
                                  setState(() {
                                    _activeAiCategory =
                                        _activeAiCategory == category
                                            ? null
                                            : category;
                                  });
                                  _reloadFeed();
                                },
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: List.generate(_tabs.length, (_) {
          return feedState.isLoading && feedState.posts.isEmpty
              ? _buildShimmer()
              : feedState.error != null && feedState.posts.isEmpty
                  ? _buildError(feedState.error!)
                  : RefreshIndicator(
                      color: AppColors.primary,
                      onRefresh: () async => _reloadFeed(),
                      child: CustomScrollView(
                        controller: _scrollController,
                        slivers: [
                          SliverPadding(
                            padding: EdgeInsets.only(
                                top: MediaQuery.of(context).padding.top + 140),
                            sliver: const SliverToBoxAdapter(
                              child: SizedBox.shrink(),
                            ),
                          ),
                          SliverList(
                            delegate: SliverChildBuilderDelegate(
                              (ctx, i) {
                                if (i == feedState.posts.length) {
                                  return feedState.isLoadingMore
                                      ? const Padding(
                                          padding: EdgeInsets.all(24),
                                          child: Center(
                                            child: CircularProgressIndicator(
                                              color: AppColors.primary,
                                              strokeWidth: 2,
                                            ),
                                          ),
                                        )
                                      : const SizedBox(height: 80);
                                }
                                return PostCard(
                                  post: feedState.posts[i],
                                  onTap: () => context
                                      .push('/post/${feedState.posts[i].id}'),
                                );
                              },
                              childCount: feedState.posts.length + 1,
                            ),
                          ),
                        ],
                      ),
                    );
        }),
      ),
    );
  }

  Future<void> _reloadFeed() {
    final tab = _tabs[_tabController.index].$1;
    return ref.read(feedProvider.notifier).loadFeed(
          tab: tab,
          refresh: true,
          hashtag: _activeHashtag,
          topic: _activeTopic,
          aiCategory: _activeAiCategory,
          sortBy: _activeSortBy,
        );
  }

  String _formatFilterLabel(String value) {
    if (value.isEmpty) return value;
    return value[0].toUpperCase() + value.substring(1);
  }

  Widget _buildStoriesStrip(WidgetRef ref) {
    final storyState = ref.watch(storiesProvider);
    final authState = ref.watch(authStateProvider);
    final activeId = authState.activeProfileId;

    return Container(
      height: 120,
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(
            color: Theme.of(context).dividerColor.withOpacity(0.05),
          ),
        ),
      ),
      child: storyState.when(
        data: (groups) {
          final hasMyStory = groups.any((g) => g.userId == activeId);

          return ListView.builder(
            scrollDirection: Axis.horizontal,
            itemCount: groups.length + (hasMyStory ? 0 : 1),
            padding: const EdgeInsets.symmetric(horizontal: 16),
            itemBuilder: (context, index) {
              if (!hasMyStory && index == 0) {
                return _buildAddStoryItem(ref, authState);
              }

              final group = hasMyStory ? groups[index] : groups[index - 1];
              final isMe = group.userId == activeId;

              return Padding(
                padding: const EdgeInsets.only(right: 16),
                child: GestureDetector(
                  onTap: () => _showStoryView(context, group),
                  child: Column(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(2.5),
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          gradient: const LinearGradient(
                            colors: [AppColors.primary, AppColors.secondary],
                          ),
                        ),
                        child: Container(
                          padding: const EdgeInsets.all(2),
                          decoration: BoxDecoration(
                            color: Theme.of(context).scaffoldBackgroundColor,
                            shape: BoxShape.circle,
                          ),
                          child: AvatarWidget(
                            avatarUrl: group.avatar,
                            displayName: group.displayName,
                            radius: 26,
                            isAI: false,
                            heroTag: 'story_${group.userId}',
                          ),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        isMe ? 'Your Story' : group.displayName,
                        style: TextStyle(
                          fontSize: 11,
                          color: Theme.of(context).colorScheme.onSurface,
                          fontWeight: FontWeight.w500,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              );
            },
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
      ),
    );
  }

  Widget _buildAddStoryItem(WidgetRef ref, AuthState auth) {
    final dynamic profile = auth.activeProfileId == auth.user?.humanProfile?.id
        ? auth.user?.humanProfile
        : auth.user?.aiProfiles
            .where((p) => p.id == auth.activeProfileId)
            .firstOrNull;

    return Padding(
      padding: const EdgeInsets.only(right: 16),
      child: GestureDetector(
        onTap: () => _handleCreateStory(ref),
        child: Column(
          children: [
            Stack(
              children: [
                AvatarWidget(
                  avatarUrl: profile?.avatar,
                  displayName: profile?.displayName ?? 'Me',
                  radius: 30,
                  isAI: auth.activeProfileId != auth.user?.humanProfile?.id,
                ),
                Positioned(
                  right: 0,
                  bottom: 0,
                  child: Container(
                    decoration: BoxDecoration(
                      color: AppColors.primary,
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: Theme.of(context).scaffoldBackgroundColor,
                        width: 2,
                      ),
                    ),
                    child: const Icon(
                      Icons.add,
                      size: 18,
                      color: Colors.white,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              'Your Story',
              style: TextStyle(
                fontSize: 11,
                color: Theme.of(context).colorScheme.onSurface.withOpacity(0.7),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _handleCreateStory(WidgetRef ref) async {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        decoration: BoxDecoration(
          color: Theme.of(context).cardColor,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(height: 12),
              Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                      color: Theme.of(context).dividerColor,
                      borderRadius: BorderRadius.circular(2))),
              const SizedBox(height: 12),
              const ListTile(
                  title: Text('Create Story',
                      style: TextStyle(fontWeight: FontWeight.bold))),
              ListTile(
                leading: const Icon(Icons.camera_alt_outlined),
                title: const Text('Take Photo'),
                onTap: () async {
                  Navigator.pop(ctx);
                  await _pickAndUploadStory(ref, ImageSource.camera);
                },
              ),
              ListTile(
                leading: const Icon(Icons.photo_library_outlined),
                title: const Text('Choose from Gallery'),
                onTap: () async {
                  Navigator.pop(ctx);
                  await _pickAndUploadStory(ref, ImageSource.gallery);
                },
              ),
              const SizedBox(height: 12),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _pickAndUploadStory(WidgetRef ref, ImageSource source) async {
    final picker = ImagePicker();
    final image = await picker.pickImage(source: source);
    if (image == null) return;

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Uploading story...'),
            duration: Duration(seconds: 1)),
      );
    }

    final imageService = ImageService();
    final base64Image = await imageService.uploadImage(image);

    if (base64Image != null) {
      final success = await ref.read(storiesProvider.notifier).uploadStory(
            mediaUrl: base64Image,
            mediaType: 'image',
          );

      if (success && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Story posted successfully!')),
        );
      }
    }
  }

  void _showStoryView(BuildContext context, StoryGroup group) {
    final activeId = ref.read(authStateProvider).activeProfileId;
    showDialog(
      context: context,
      useSafeArea: false,
      builder: (ctx) => StoryViewerDialog(
        group: group,
        isMe: group.userId == activeId,
      ),
    );
  }

  Widget _buildShimmer() {
    return ListView.builder(
      itemCount: 4,
      padding: const EdgeInsets.only(top: 8),
      itemBuilder: (_, __) => _ShimmerCard(),
    );
  }

  Widget _buildError(String error) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.wifi_off_rounded,
            size: 52,
            color: AppColors.textTertiary,
          ),
          const SizedBox(height: 16),
          Text(
            error,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 14,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _reloadFeed,
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final bool active;
  final VoidCallback onTap;

  const _FilterChip({
    required this.label,
    required this.active,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        decoration: BoxDecoration(
          color:
              active ? AppColors.primary : AppColors.primary.withOpacity(0.06),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color:
                active ? AppColors.primary : AppColors.primary.withOpacity(0.2),
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: active ? Colors.white : AppColors.primary,
          ),
        ),
      ),
    );
  }
}

class _ShimmerCard extends StatefulWidget {
  @override
  State<_ShimmerCard> createState() => _ShimmerCardState();
}

class _ShimmerCardState extends State<_ShimmerCard>
    with SingleTickerProviderStateMixin {
  late AnimationController _ctrl;
  late Animation<double> _anim;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat(reverse: true);
    _anim = CurvedAnimation(parent: _ctrl, curve: Curves.easeInOut);
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _anim,
      builder: (_, __) {
        final opacity = 0.3 + 0.4 * _anim.value;
        return Container(
          margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Theme.of(context).cardColor,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: Theme.of(context).dividerColor,
              width: 0.5,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  _box(44, 44, radius: 22, opacity: opacity),
                  const SizedBox(width: 12),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _box(130, 13, opacity: opacity),
                      const SizedBox(height: 6),
                      _box(80, 10, opacity: opacity),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 14),
              _box(double.infinity, 13, opacity: opacity),
              const SizedBox(height: 8),
              _box(double.infinity, 13, opacity: opacity),
              const SizedBox(height: 8),
              _box(180, 13, opacity: opacity),
            ],
          ),
        );
      },
    );
  }

  Widget _box(double w, double h,
      {double radius = 8, required double opacity}) {
    return Container(
      width: w,
      height: h,
      decoration: BoxDecoration(
        color: AppColors.border.withOpacity(opacity.clamp(0.0, 1.0)),
        borderRadius: BorderRadius.circular(radius),
      ),
    );
  }
}
