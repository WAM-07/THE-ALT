import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/post_model.dart';
import '../services/feed_service.dart';
import 'auth_provider.dart';

// ─── Feed State ───────────────────────────────────────────────────────────────

class FeedState {
  final List<Post> posts;
  final bool isLoading;
  final bool isLoadingMore;
  final bool hasMore;
  final String? nextCursor;
  final String? error;
  final String activeTab;
  final String? activeHashtag;
  final String? activeTopic;
  final String? activeAiCategory;
  final String? sortBy;

  const FeedState({
    this.posts = const [],
    this.isLoading = false,
    this.isLoadingMore = false,
    this.hasMore = true,
    this.nextCursor,
    this.error,
    this.activeTab = 'feed',
    this.activeHashtag,
    this.activeTopic,
    this.activeAiCategory,
    this.sortBy,
  });

  FeedState copyWith({
    List<Post>? posts,
    bool? isLoading,
    bool? isLoadingMore,
    bool? hasMore,
    String? nextCursor,
    String? error,
    String? activeTab,
    String? activeHashtag,
    String? activeTopic,
    String? activeAiCategory,
    String? sortBy,
    bool clearHashtag = false,
    bool clearTopic = false,
    bool clearAiCategory = false,
    bool clearSortBy = false,
  }) =>
      FeedState(
        posts: posts ?? this.posts,
        isLoading: isLoading ?? this.isLoading,
        isLoadingMore: isLoadingMore ?? this.isLoadingMore,
        hasMore: hasMore ?? this.hasMore,
        nextCursor: nextCursor,
        error: error,
        activeTab: activeTab ?? this.activeTab,
        activeHashtag: clearHashtag ? null : (activeHashtag ?? this.activeHashtag),
        activeTopic: clearTopic ? null : (activeTopic ?? this.activeTopic),
        activeAiCategory: clearAiCategory
            ? null
            : (activeAiCategory ?? this.activeAiCategory),
        sortBy: clearSortBy ? null : (sortBy ?? this.sortBy),
      );
}

// ─── Feed Notifier ────────────────────────────────────────────────────────────

class FeedNotifier extends StateNotifier<FeedState> {
  final FeedService _feedService;
  final Ref _ref;

  FeedNotifier(this._feedService, this._ref) : super(const FeedState());

  /// The engagement level the feed is filtered to (low, medium, high), or null for all.
  String? _engagement;

  Future<void> loadFeed({
    String tab = 'feed',
    bool refresh = false,
    String? hashtag,
    String? topic,
    String? aiCategory,
    String? sortBy,
    String? engagement,
  }) async {
    if (refresh) _engagement = engagement;
    if (refresh) {
      state = state.copyWith(
        isLoading: true,
        posts: [],
        nextCursor: null,
        error: null,
        activeTab: tab,
        activeHashtag: hashtag,
        activeTopic: topic,
        activeAiCategory: aiCategory,
        sortBy: sortBy,
        clearHashtag: hashtag == null,
        clearTopic: topic == null,
        clearAiCategory: aiCategory == null,
        clearSortBy: sortBy == null,
      );
    } else if (state.isLoading || state.isLoadingMore) {
      return;
    } else {
      state = state.copyWith(isLoading: true, error: null);
    }

    final result = await _feedService.getFeed(
      tab: tab,
      hashtag: hashtag ?? state.activeHashtag,
      topic: topic ?? state.activeTopic,
      aiCategory: aiCategory ?? state.activeAiCategory,
      sortBy: sortBy ?? state.sortBy,
      engagement: _engagement,
    );
    if (result.success) {
      state = state.copyWith(
        posts: result.posts,
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
        isLoading: false,
        activeTab: tab,
      );
    } else {
      state = state.copyWith(isLoading: false, error: result.error);
    }
  }

  Future<void> loadMore() async {
    if (!state.hasMore || state.isLoadingMore || state.nextCursor == null) return;
    state = state.copyWith(isLoadingMore: true);
    final result = await _feedService.getFeed(
      tab: state.activeTab,
      cursor: state.nextCursor,
      hashtag: state.activeHashtag,
      topic: state.activeTopic,
      aiCategory: state.activeAiCategory,
      sortBy: state.sortBy,
      engagement: _engagement,
    );
    if (result.success) {
      state = state.copyWith(
        posts: [...state.posts, ...result.posts],
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
        isLoadingMore: false,
      );
    } else {
      state = state.copyWith(isLoadingMore: false);
    }
  }

  Future<void> toggleReaction(String postId) async {
    final idx = state.posts.indexWhere((p) => p.id == postId);
    if (idx == -1) return;
    final post = state.posts[idx];
    
    final auth = _ref.read(authStateProvider);
    final activeProfileId = auth.activeProfileId;
    final authorType =
        activeProfileId != null && activeProfileId != auth.user?.humanProfile?.id
            ? 'ai'
            : 'human';

    // Optimistic update
    final updated = List<Post>.from(state.posts);
    updated[idx] = post.copyWith(
      hasReacted: !post.hasReacted,
      reactionCount: post.hasReacted ? post.reactionCount - 1 : post.reactionCount + 1,
    );
    state = state.copyWith(posts: updated);
    
    final ok = await _feedService.reactToPost(
      postId,
      authorId: activeProfileId,
      authorType: authorType,
    );
    if (!ok) {
      // Rollback
      updated[idx] = post;
      state = state.copyWith(posts: List<Post>.from(updated));
    }
  }

  void addNewPost(Post post) {
    state = state.copyWith(posts: [post, ...state.posts]);
  }

  Future<bool> deletePost(String postId) async {
    final idx = state.posts.indexWhere((p) => p.id == postId);
    if (idx == -1) return false;
    
    final post = state.posts[idx];
    final updated = List<Post>.from(state.posts)..removeAt(idx);
    state = state.copyWith(posts: updated);
    
    final ok = await _feedService.deletePost(postId);
    if (!ok) {
      final rollbackList = List<Post>.from(state.posts)..insert(idx, post);
      state = state.copyWith(posts: rollbackList);
    }
    return ok;
  }

  Future<bool> reportPost(String postId, String reason, {String? details}) async {
    return await _feedService.reportPost(postId, reason, details: details);
  }

  Future<bool> toggleFollow(String profileId, String profileType) async {
    final auth = _ref.read(authStateProvider);
    final activeProfileId = auth.activeProfileId;
    final followerType =
        activeProfileId != null && activeProfileId != auth.user?.humanProfile?.id
            ? 'ai'
            : 'human';

    final affectedIndexes = <int>[];
    bool currentFollowState = false;

    // Check if we can find the current follow state from the feed
    for (var i = 0; i < state.posts.length; i++) {
      final post = state.posts[i];
      if (post.authorId == profileId) {
        affectedIndexes.add(i);
        currentFollowState = post.isFollowingAuthor;
      }
    }

    // If we don't have posts, we might not know the follow state, but toggleFollow 
    // is usually called when we KNOW we want to toggle.
    // However, if we are on a profile screen, we usually have the current state from the profile data.
    // For now, let's just proceed with the API call. 
    // We'll use a dummy 'shouldFollow' if we don't know, or let the backend handle it.
    // Actually, FeedService.followProfile seems to handle the toggle if we don't provide a specific action,
    // or it just takes the followee_id and returns the new state.

    if (affectedIndexes.isNotEmpty) {
      final shouldFollow = !currentFollowState;
      final optimistic = List<Post>.from(state.posts);
      for (final index in affectedIndexes) {
        optimistic[index] =
            optimistic[index].copyWith(isFollowingAuthor: shouldFollow);
      }
      state = state.copyWith(posts: optimistic);
    }

    final result = await _feedService.followProfile(
      profileId,
      profileType,
      followerId: activeProfileId,
      followerType: followerType,
    );
    
    if (!result.success) {
      if (affectedIndexes.isNotEmpty) {
        final rollback = List<Post>.from(state.posts);
        for (final index in affectedIndexes) {
          rollback[index] = rollback[index]
              .copyWith(isFollowingAuthor: currentFollowState);
        }
        state = state.copyWith(posts: rollback);
      }
      return false;
    }

    if (affectedIndexes.isNotEmpty) {
      final synced = List<Post>.from(state.posts);
      for (final index in affectedIndexes) {
        synced[index] = synced[index]
            .copyWith(isFollowingAuthor: result.following);
      }
      state = state.copyWith(posts: synced);
    }
    
    return true;
  }

  void syncCommentCount(String postId, int newCount) {
    final idx = state.posts.indexWhere((p) => p.id == postId);
    if (idx != -1) {
      final updated = List<Post>.from(state.posts);
      updated[idx] = updated[idx].copyWith(commentCount: newCount);
      state = state.copyWith(posts: updated);
    }
  }

  void syncFollowState(String profileId, bool following) {
    final updated = List<Post>.from(state.posts);
    var changed = false;
    for (var i = 0; i < updated.length; i++) {
      if (updated[i].authorId == profileId) {
        updated[i] = updated[i].copyWith(isFollowingAuthor: following);
        changed = true;
      }
    }
    if (changed) {
      state = state.copyWith(posts: updated);
    }
  }
}

// ─── Providers ────────────────────────────────────────────────────────────────

final feedServiceProvider = Provider<FeedService>((ref) {
  return FeedService(ref.watch(authServiceProvider));
});

final feedProvider = StateNotifierProvider<FeedNotifier, FeedState>((ref) {
  return FeedNotifier(ref.watch(feedServiceProvider), ref);
});
