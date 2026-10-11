import 'dart:async';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../providers/explore_provider.dart';
import '../../providers/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/post_card.dart';
import '../../widgets/avatar_widget.dart';
import '../../services/feed_service.dart';

class ExploreScreen extends ConsumerStatefulWidget {
  const ExploreScreen({super.key});

  @override
  ConsumerState<ExploreScreen> createState() => _ExploreScreenState();
}

class _ExploreScreenState extends ConsumerState<ExploreScreen>
    with SingleTickerProviderStateMixin {
  final _searchCtrl = TextEditingController();
  final _focusNode = FocusNode();
  late TabController _tabController;
  Timer? _debounce;
  bool _isSearching = false;
  String? _activeTopic;
  String? _activeAiCategory;
  final _topicFilters = ['web3', 'aiethics', 'flutter', 'defi', 'vectordb'];
  final _aiCategories = ['companion', 'creative', 'technical', 'general'];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(exploreProvider.notifier).fetchDiscoverData();
    });
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    _focusNode.dispose();
    _tabController.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  void _onSearchChanged(String query) {
    if (_debounce?.isActive ?? false) _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 500), () {
      if (query.isNotEmpty ||
          _activeTopic != null ||
          _activeAiCategory != null) {
        setState(() => _isSearching = true);
        ref.read(exploreProvider.notifier).search(
              query,
              topic: _activeTopic,
              aiCategory: _activeAiCategory,
            );
      } else {
        setState(() => _isSearching = false);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final exploreState = ref.watch(exploreProvider);

    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: PreferredSize(
        preferredSize: Size.fromHeight(_isSearching ? 120 : 84),
        child: ClipRRect(
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 15, sigmaY: 15),
            child: AppBar(
              toolbarHeight: 84,
              titleSpacing: 16,
              backgroundColor: Theme.of(context)
                  .appBarTheme
                  .backgroundColor!
                  .withOpacity(0.7),
              title: _buildSearchBar(),
              bottom: _isSearching
                  ? TabBar(
                      controller: _tabController,
                      tabs: const [
                        Tab(text: 'Profiles'),
                        Tab(text: 'Posts'),
                        Tab(text: 'Tags')
                      ],
                      labelStyle: const TextStyle(fontWeight: FontWeight.bold),
                      dividerColor: Colors.transparent,
                    )
                  : null,
            ),
          ),
        ),
      ),
      body: _isSearching
          ? _buildSearchResults(exploreState)
          : _buildDiscoverView(exploreState),
    );
  }

  Widget _buildSearchBar() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      height: 48,
      decoration: BoxDecoration(
        color: isDark
            ? AppColors.surfaceVariantDark.withOpacity(0.92)
            : Colors.white.withOpacity(0.95),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isDark
              ? AppColors.borderDark.withOpacity(0.9)
              : AppColors.border.withOpacity(0.8),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(isDark ? 0.18 : 0.05),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: TextField(
        controller: _searchCtrl,
        focusNode: _focusNode,
        onChanged: _onSearchChanged,
        decoration: InputDecoration(
          hintText: 'Search people, AIs, or tags...',
          prefixIcon: const Icon(Icons.search,
              size: 20, color: AppColors.textSecondary),
          suffixIcon: _searchCtrl.text.isNotEmpty
              ? IconButton(
                  icon: const Icon(Icons.close, size: 18),
                  onPressed: () {
                    _searchCtrl.clear();
                    setState(() => _isSearching =
                        _activeTopic != null || _activeAiCategory != null);
                    ref.read(exploreProvider.notifier).applyDiscoverFilters(
                          topic: _activeTopic,
                          aiCategory: _activeAiCategory,
                          query: '',
                          searching: _isSearching,
                        );
                  },
                )
              : null,
          border: InputBorder.none,
          enabledBorder: InputBorder.none,
          focusedBorder: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(vertical: 12),
        ),
      ),
    );
  }

  Widget _buildDiscoverView(ExploreState state) {
    final topPadding = MediaQuery.of(context).padding.top + 100;
    return ListView(
      padding: EdgeInsets.fromLTRB(16, topPadding, 16, 120),
      children: [
        _buildFilterBar(),
        const SizedBox(height: 14),
        const Text('Suggested for You',
            style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800)),
        const SizedBox(height: 12),
        _buildSuggestedProfiles(state),
        const SizedBox(height: 24),
        const Text('Trending Hashtags',
            style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800)),
        const SizedBox(height: 12),
        ...state.trending.map((t) => _buildTrendingItem(t)),
      ],
    );
  }

  Widget _buildSuggestedProfiles(ExploreState state) {
    final profiles = state.profiles;
    if (profiles.isEmpty)
      return const SizedBox(
          height: 100, child: Center(child: CircularProgressIndicator()));
    return SizedBox(
      height: 224,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: profiles.length,
        separatorBuilder: (_, __) => const SizedBox(width: 12),
        itemBuilder: (ctx, i) => _SuggestedProfileCard(profile: profiles[i]),
      ),
    );
  }

  Widget _buildTrendingItem(TrendingTag t) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.circular(18),
        border:
            Border.all(color: Theme.of(context).dividerColor.withOpacity(0.75)),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
        leading: Container(
          width: 42,
          height: 42,
          decoration: BoxDecoration(
              color: AppColors.primary.withOpacity(0.1),
              borderRadius: BorderRadius.circular(12)),
          child:
              const Icon(Icons.trending_up, color: AppColors.primary, size: 20),
        ),
        title: Text(t.tag, style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text('${t.count} posts',
            style:
                const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
        trailing: const Icon(Icons.arrow_outward_rounded,
            size: 18, color: AppColors.textTertiary),
        onTap: () {
          _searchCtrl.text = t.tag;
          _onSearchChanged(t.tag);
          _tabController.animateTo(1); // Switch to Posts tab
        },
      ),
    );
  }

  Widget _buildSearchResults(ExploreState state) {
    if (state.isLoading)
      return const Center(child: CircularProgressIndicator());

    // Pre-compute tag-filtered posts for the Tags tab
    final tagQuery = _searchCtrl.text.replaceAll('#', '').toLowerCase().trim();
    final tagPosts = tagQuery.isEmpty
        ? state.posts
        : state.posts
            .where((p) => p.hashtags.any((h) =>
                h.toLowerCase().contains(tagQuery) ||
                p.content.toLowerCase().contains('#$tagQuery')))
            .toList();

    final topPadding = MediaQuery.of(context).padding.top + 76;
    return Column(
      children: [
        Padding(
          padding: EdgeInsets.fromLTRB(16, topPadding, 16, 8),
          child: _buildFilterBar(),
        ),
        Expanded(
          child: TabBarView(
            controller: _tabController,
            children: [
              // ── Profiles tab ──────────────────────────────────────
              state.profiles.isEmpty
                  ? _emptyResults()
                  : ListView.builder(
                      padding: const EdgeInsets.only(bottom: 100),
                      itemCount: state.profiles.length,
                      itemBuilder: (ctx, i) =>
                          _ProfileResultTile(profile: state.profiles[i]),
                    ),
              // ── Posts tab ─────────────────────────────────────────
              state.posts.isEmpty
                  ? _emptyResults()
                  : ListView.builder(
                      padding: const EdgeInsets.only(bottom: 100),
                      itemCount: state.posts.length,
                      itemBuilder: (ctx, i) => PostCard(
                        post: state.posts[i],
                        heroTagPrefix: 'explore_posts',
                        onTap: () => context.push('/post/${state.posts[i].id}'),
                      ),
                    ),
              // ── Tags tab ──────────────────────────────────────────
              tagPosts.isEmpty
                  ? _emptyResults(tagQuery.isEmpty
                      ? 'Search a hashtag to see posts'
                      : 'No posts found for #$tagQuery')
                  : ListView.builder(
                      padding: const EdgeInsets.only(bottom: 100),
                      itemCount: tagPosts.length,
                      itemBuilder: (ctx, i) => PostCard(
                        post: tagPosts[i],
                        heroTagPrefix: 'explore_tags',
                        onTap: () => context.push('/post/${tagPosts[i].id}'),
                      ),
                    ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _emptyResults([String msg = 'No results found']) {
    return ListView(
      children: [
        SizedBox(height: 100),
        Center(
            child: Text(msg,
                style: const TextStyle(color: AppColors.textTertiary))),
      ],
    );
  }

  Widget _buildFilterBar() {
    return SizedBox(
      height: 52,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(vertical: 6),
        children: [
          ..._topicFilters.map((topic) => Padding(
                padding: const EdgeInsets.only(right: 8),
                child: _ExploreFilterChip(
                  label: '#${_formatLabel(topic)}',
                  active: _activeTopic == topic,
                  onTap: () {
                    setState(() {
                      _activeTopic = _activeTopic == topic ? null : topic;
                      _isSearching = _searchCtrl.text.isNotEmpty ||
                          _activeTopic != null ||
                          _activeAiCategory != null;
                    });
                    ref.read(exploreProvider.notifier).applyDiscoverFilters(
                          topic: _activeTopic,
                          aiCategory: _activeAiCategory,
                          query: _searchCtrl.text,
                          searching: _isSearching,
                        );
                  },
                ),
              )),
          ..._aiCategories.map((category) => Padding(
                padding: const EdgeInsets.only(right: 8),
                child: _ExploreFilterChip(
                  label: _formatLabel(category),
                  active: _activeAiCategory == category,
                  onTap: () {
                    setState(() {
                      _activeAiCategory =
                          _activeAiCategory == category ? null : category;
                      _isSearching = _searchCtrl.text.isNotEmpty ||
                          _activeTopic != null ||
                          _activeAiCategory != null;
                    });
                    ref.read(exploreProvider.notifier).applyDiscoverFilters(
                          topic: _activeTopic,
                          aiCategory: _activeAiCategory,
                          query: _searchCtrl.text,
                          searching: _isSearching,
                        );
                  },
                ),
              )),
        ],
      ),
    );
  }

  String _formatLabel(String value) {
    if (value.isEmpty) return value;
    return value[0].toUpperCase() + value.substring(1);
  }
}

class _SuggestedProfileCard extends StatelessWidget {
  final FollowProfile profile;
  const _SuggestedProfileCard({required this.profile});

  @override
  Widget build(BuildContext context) {
    return Consumer(
      builder: (context, ref, _) {
        final state = ref.watch(exploreProvider);
        final auth = ref.watch(authStateProvider);
        final activeProfileId = auth.activeProfileId;
        final isOwnProfile = profile.id == activeProfileId;
        final isFollowing = state.followingByProfile[profile.id] ?? false;
        final isPending = state.pendingProfileIds.contains(profile.id);

        return GestureDetector(
          onTap: () => context.push(
              '/profile?id=${profile.id}&type=${profile.isAI ? 'ai' : 'human'}'),
          child: Container(
            width: 152,
            padding: const EdgeInsets.fromLTRB(12, 14, 12, 12),
            decoration: BoxDecoration(
              color: Theme.of(context).cardColor,
              borderRadius: BorderRadius.circular(22),
              border: Border.all(
                  color: Theme.of(context).dividerColor.withOpacity(0.6)),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(
                    Theme.of(context).brightness == Brightness.dark
                        ? 0.16
                        : 0.04,
                  ),
                  blurRadius: 16,
                  offset: const Offset(0, 8),
                ),
              ],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  padding: const EdgeInsets.all(3),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: profile.isAI
                        ? const LinearGradient(colors: AppColors.aiGradient)
                        : const LinearGradient(colors: AppColors.warmGradient),
                  ),
                  child: AvatarWidget(
                      avatarUrl: profile.avatar,
                      displayName: profile.displayName,
                      radius: 28,
                      isAI: profile.isAI),
                ),
                const SizedBox(height: 10),
                Text(profile.displayName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontWeight: FontWeight.w700, fontSize: 13)),
                const SizedBox(height: 3),
                Text('@${profile.username}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        color: AppColors.textTertiary, fontSize: 11)),
                if (profile.isAI && profile.category != null) ...[
                  const SizedBox(height: 8),
                  _MetaPill(label: profile.category!),
                ],
                const SizedBox(height: 10),
                const Spacer(),
                SizedBox(
                  width: double.infinity,
                  height: 34,
                  child: FilledButton(
                    onPressed: isOwnProfile || isPending
                        ? null
                        : () async {
                            final result = await ref
                                .read(exploreProvider.notifier)
                                .toggleFollow(profile);
                            if (!context.mounted) return;
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text(
                                  result.success
                                      ? (result.following
                                          ? 'Following ${profile.displayName}'
                                          : 'Unfollowed ${profile.displayName}')
                                      : (result.error ??
                                          'Could not update follow'),
                                ),
                                backgroundColor: result.success
                                    ? AppColors.primary
                                    : AppColors.error,
                                behavior: SnackBarBehavior.floating,
                              ),
                            );
                          },
                    style: FilledButton.styleFrom(
                      padding: EdgeInsets.zero,
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12)),
                      backgroundColor: isFollowing
                          ? AppColors.textSecondary.withOpacity(0.2)
                          : null,
                      foregroundColor:
                          isFollowing ? AppColors.textSecondary : null,
                    ),
                    child: Text(
                      isOwnProfile
                          ? 'You'
                          : isPending
                              ? '...'
                              : isFollowing
                                  ? 'Following'
                                  : 'Follow',
                      style: const TextStyle(
                          fontSize: 11, fontWeight: FontWeight.bold),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _ProfileResultTile extends StatelessWidget {
  final FollowProfile profile;
  const _ProfileResultTile({required this.profile});

  @override
  Widget build(BuildContext context) {
    return Consumer(
      builder: (context, ref, _) {
        final state = ref.watch(exploreProvider);
        final auth = ref.watch(authStateProvider);
        final activeProfileId = auth.activeProfileId;
        final isOwnProfile = profile.id == activeProfileId;
        final isFollowing = state.followingByProfile[profile.id] ?? false;
        final isPending = state.pendingProfileIds.contains(profile.id);

        return ListTile(
          onTap: () => context.push(
              '/profile?id=${profile.id}&type=${profile.isAI ? 'ai' : 'human'}'),
          leading: AvatarWidget(
              avatarUrl: profile.avatar,
              displayName: profile.displayName,
              radius: 22,
              isAI: profile.isAI),
          title: Text(profile.displayName,
              style: const TextStyle(fontWeight: FontWeight.w600)),
          subtitle: Text(
            profile.isAI && profile.category != null
                ? '@${profile.username} • ${profile.category}'
                : '@${profile.username}',
            style: const TextStyle(fontSize: 13),
          ),
          trailing: OutlinedButton(
            onPressed: isOwnProfile || isPending
                ? null
                : () async {
                    final result = await ref
                        .read(exploreProvider.notifier)
                        .toggleFollow(profile);
                    if (!context.mounted) return;
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text(
                          result.success
                              ? (result.following
                                  ? 'Following ${profile.displayName}'
                                  : 'Unfollowed ${profile.displayName}')
                              : (result.error ?? 'Could not update follow'),
                        ),
                        backgroundColor: result.success
                            ? AppColors.primary
                            : AppColors.error,
                        behavior: SnackBarBehavior.floating,
                      ),
                    );
                  },
            child: Text(
              isOwnProfile
                  ? 'You'
                  : isPending
                      ? '...'
                      : isFollowing
                          ? 'Following'
                          : 'Follow',
            ),
          ),
        );
      },
    );
  }
}

class _ExploreFilterChip extends StatelessWidget {
  final String label;
  final bool active;
  final VoidCallback onTap;

  const _ExploreFilterChip({
    required this.label,
    required this.active,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          gradient: active
              ? const LinearGradient(colors: AppColors.warmGradient)
              : null,
          color: active
              ? null
              : (isDark
                  ? AppColors.surfaceVariantDark.withOpacity(0.9)
                  : AppColors.primary.withOpacity(0.07)),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: active
                ? Colors.transparent
                : AppColors.primary.withOpacity(0.18),
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

class _MetaPill extends StatelessWidget {
  final String label;

  const _MetaPill({required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.badgeAI.withOpacity(0.1),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppColors.badgeAI.withOpacity(0.14)),
      ),
      child: Text(
        label[0].toUpperCase() + label.substring(1),
        style: const TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w600,
          color: AppColors.badgeAI,
        ),
      ),
    );
  }
}
