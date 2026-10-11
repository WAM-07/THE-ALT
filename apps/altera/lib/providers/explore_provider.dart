import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import '../models/post_model.dart';
import '../services/feed_service.dart';
import '../config/app_config.dart';
import 'auth_provider.dart';
import 'feed_provider.dart';

class ExploreState {
  final bool isLoading;
  final List<Post> posts;
  final List<FollowProfile> profiles;
  final List<TrendingTag> trending;
  final String? activeTopic;
  final String? activeAiCategory;
  final Map<String, bool> followingByProfile;
  final Set<String> pendingProfileIds;
  final String? error;

  ExploreState({
    this.isLoading = false,
    this.posts = const [],
    this.profiles = const [],
    this.trending = const [],
    this.activeTopic,
    this.activeAiCategory,
    this.followingByProfile = const {},
    this.pendingProfileIds = const <String>{},
    this.error,
  });

  ExploreState copyWith({
    bool? isLoading,
    List<Post>? posts,
    List<FollowProfile>? profiles,
    List<TrendingTag>? trending,
    String? activeTopic,
    String? activeAiCategory,
    Map<String, bool>? followingByProfile,
    Set<String>? pendingProfileIds,
    String? error,
    bool clearActiveTopic = false,
    bool clearActiveAiCategory = false,
  }) {
    return ExploreState(
      isLoading: isLoading ?? this.isLoading,
      posts: posts ?? this.posts,
      profiles: profiles ?? this.profiles,
      trending: trending ?? this.trending,
      activeTopic: clearActiveTopic ? null : (activeTopic ?? this.activeTopic),
      activeAiCategory: clearActiveAiCategory
          ? null
          : (activeAiCategory ?? this.activeAiCategory),
      followingByProfile: followingByProfile ?? this.followingByProfile,
      pendingProfileIds: pendingProfileIds ?? this.pendingProfileIds,
      error: error ?? this.error,
    );
  }
}

class TrendingTag {
  final String tag;
  final int count;

  TrendingTag({required this.tag, required this.count});

  factory TrendingTag.fromJson(Map<String, dynamic> json) {
    return TrendingTag(
      tag: json['tag'] as String,
      count: int.tryParse(json['post_count']?.toString() ?? '0') ?? 0,
    );
  }
}

class ExploreNotifier extends StateNotifier<ExploreState> {
  final String _baseUrl = AppConfig.baseUrl;
  final FeedService _feedService;
  final Ref _ref;

  ExploreNotifier(this._ref, this._feedService) : super(ExploreState());

  ({String? profileId, String followerType}) _activeFollowerContext() {
    final auth = _ref.read(authStateProvider);
    final activeProfileId = auth.activeProfileId;
    final isAI = activeProfileId != null && activeProfileId != auth.user?.humanProfile?.id;
    return (profileId: activeProfileId, followerType: isAI ? 'ai' : 'human');
  }

  Future<Map<String, bool>> _resolveFollowingStates(List<FollowProfile> profiles) async {
    if (profiles.isEmpty) return {};
    final ctx = _activeFollowerContext();
    final activeProfileId = ctx.profileId;
    if (activeProfileId == null) {
      return {for (final profile in profiles) profile.id: false};
    }

    final entries = await Future.wait(
      profiles.map((profile) async {
        if (profile.id == activeProfileId) {
          return MapEntry(profile.id, false);
        }
        final following = await _feedService.isFollowingProfile(
          profile.id,
          followerId: activeProfileId,
          followerType: ctx.followerType,
        );
        return MapEntry(profile.id, following);
      }),
    );
    return Map.fromEntries(entries);
  }

  Future<void> fetchDiscoverData({String? aiCategory}) async {
    state = state.copyWith(isLoading: true, error: null);
    try {
      final headers = await _feedService.getHeaders();
      
      final trendingRes = await http.get(Uri.parse('$_baseUrl/explore/trending'), headers: headers);
      final suggestedUri = Uri.parse('$_baseUrl/explore/suggested-profiles').replace(
        queryParameters: {
          if (aiCategory != null) 'ai_category': aiCategory,
        },
      );
      final suggestedRes = await http.get(suggestedUri, headers: headers);
      
      final trendingData = jsonDecode(trendingRes.body);
      final suggestedData = jsonDecode(suggestedRes.body);
      final profiles = (suggestedData['profiles'] as List)
          .map((p) => FollowProfile.fromJson(p))
          .toList();
      final followingByProfile = await _resolveFollowingStates(profiles);

      state = state.copyWith(
        isLoading: false,
        trending: (trendingData['trending'] as List).map((t) => TrendingTag.fromJson(t)).toList(),
        profiles: profiles,
        activeAiCategory: aiCategory,
        clearActiveAiCategory: aiCategory == null,
        clearActiveTopic: true,
        followingByProfile: followingByProfile,
      );
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
    }
  }

  Future<void> search(
    String query, {
    String? topic,
    String? aiCategory,
  }) async {
    if (query.isEmpty && topic == null && aiCategory == null) {
      state = state.copyWith(
        posts: [],
        profiles: [],
        clearActiveTopic: true,
        clearActiveAiCategory: true,
      );
      return;
    }

    state = state.copyWith(isLoading: true, error: null);
    try {
      final headers = await _feedService.getHeaders();
      final uri = Uri.parse('$_baseUrl/explore/search').replace(
        queryParameters: {
          if (query.isNotEmpty) 'q': query,
          if (topic != null) 'topic': topic,
          if (aiCategory != null) 'ai_category': aiCategory,
        },
      );
      final res = await http.get(uri, headers: headers);

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final profiles = (data['profiles'] as List)
            .map((p) => FollowProfile.fromJson(p))
            .toList();
        final followingByProfile = await _resolveFollowingStates(profiles);
        state = state.copyWith(
          isLoading: false,
          posts: (data['posts'] as List).map((p) => Post.fromJson(p)).toList(),
          profiles: profiles,
          activeTopic: topic,
          activeAiCategory: aiCategory,
          clearActiveTopic: topic == null,
          clearActiveAiCategory: aiCategory == null,
          followingByProfile: followingByProfile,
        );
      } else {
        state = state.copyWith(isLoading: false, error: 'Search failed');
      }
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
    }
  }

  Future<void> applyDiscoverFilters({
    String? topic,
    String? aiCategory,
    String query = '',
    bool searching = false,
  }) async {
    if (searching || query.isNotEmpty || topic != null) {
      await search(
        query,
        topic: topic,
        aiCategory: aiCategory,
      );
      return;
    }
    await fetchDiscoverData(aiCategory: aiCategory);
  }

  Future<FollowResult> toggleFollow(FollowProfile profile) async {
    final ctx = _activeFollowerContext();
    final activeProfileId = ctx.profileId;
    if (activeProfileId == null || activeProfileId == profile.id) {
      return const FollowResult(
        success: false,
        following: false,
        error: 'Cannot follow this profile',
      );
    }

    final pending = {...state.pendingProfileIds, profile.id};
    state = state.copyWith(pendingProfileIds: pending);

    final result = await _feedService.followProfile(
      profile.id,
      profile.isAI ? 'ai' : 'human',
      followerId: activeProfileId,
      followerType: ctx.followerType,
    );

    final nextPending = {...state.pendingProfileIds}..remove(profile.id);
    if (result.success) {
      final nextFollowing = {
        ...state.followingByProfile,
        profile.id: result.following,
      };
      state = state.copyWith(
        followingByProfile: nextFollowing,
        pendingProfileIds: nextPending,
      );
      _ref.read(feedProvider.notifier).syncFollowState(profile.id, result.following);
      await _ref.read(authStateProvider.notifier).checkAuth();
      return result;
    }

    state = state.copyWith(pendingProfileIds: nextPending);
    return result;
  }
}

final exploreProvider = StateNotifierProvider<ExploreNotifier, ExploreState>((ref) {
  return ExploreNotifier(ref, ref.watch(feedServiceProvider));
});
