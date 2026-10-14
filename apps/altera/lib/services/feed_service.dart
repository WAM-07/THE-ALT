import 'package:flutter/foundation.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/app_config.dart';
import '../models/post_model.dart';
import 'auth_service.dart';

class FeedService {
  FeedService(this._auth);

  final String _baseUrl = AppConfig.baseUrl;
  final AuthService _auth;

  Future<Map<String, String>> getHeaders() => _auth.authHeaders();

  Future<Map<String, dynamic>?> getProfile(String id, {String type = 'human'}) async {
    try {
      final res = await _auth.authorizedRequest(
        method: 'GET',
        uri: Uri.parse('$_baseUrl/profiles/$id?type=$type'),
      );
      if (res.statusCode == 200) {
        return jsonDecode(res.body);
      }
      print('[FeedService] getProfile failed: ${res.statusCode} - ${res.body}');
      return null;
    } catch (e) {
      print('[FeedService] getProfile error: $e');
      return null;
    }
  }

  Future<Post?> getPost(String postId) async {
    try {
      final res = await _auth.authorizedRequest(
        method: 'GET',
        uri: Uri.parse('$_baseUrl/posts/$postId'),
      );
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        return Post.fromJson(data['post']);
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  Future<FeedResult> getFeed({
    String? cursor,
    String tab = 'feed',
    int limit = 20,
    String? hashtag,
    String? topic,
    String? aiCategory,
    String? sortBy,
  }) async {
    try {
      final params = {
        'tab': tab,
        'limit': limit.toString(),
        if (cursor != null) 'cursor': cursor,
        if (hashtag != null) 'hashtag': hashtag,
        if (topic != null) 'topic': topic,
        if (aiCategory != null) 'ai_category': aiCategory,
        if (sortBy != null) 'sort_by': sortBy,
      };
      final uri = Uri.parse('$_baseUrl/feed').replace(queryParameters: params);
      final res = await _auth.authorizedRequest(method: 'GET', uri: uri);
      final data = jsonDecode(res.body);
      if (res.statusCode == 200) {
        final posts =
            (data['posts'] as List).map((p) => Post.fromJson(p)).toList();
        return FeedResult.success(
          posts: posts,
          nextCursor: data['next_cursor'],
          hasMore: data['has_more'] ?? false,
        );
      }
      return FeedResult.failure(data['message'] ?? 'Failed to load feed');
    } catch (e) {
      return FeedResult.failure('Network error: ${e.toString()}');
    }
  }

  Future<bool> reactToPost(String postId, {String? authorId, String authorType = 'human'}) async {
    try {
      final res = await _auth.authorizedRequest(
        method: 'POST',
        uri: Uri.parse('$_baseUrl/posts/$postId/react'),
        body: {
          if (authorId != null) 'author_id': authorId,
          'author_type': authorType,
        },
      );
      return res.statusCode == 200 || res.statusCode == 201;
    } catch (_) {
      return false;
    }
  }

  Future<Map<String, dynamic>?> reactToComment(String postId, String commentId, {String? authorId, String authorType = 'human'}) async {
    try {
      final res = await _auth.authorizedRequest(
        method: 'POST',
        uri: Uri.parse('$_baseUrl/posts/$postId/comments/$commentId/react'),
        body: {
          if (authorId != null) 'author_id': authorId,
          'author_type': authorType,
        },
      );
      if (res.statusCode == 200 || res.statusCode == 201) {
        return jsonDecode(res.body);
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  Future<bool> deleteComment(String postId, String commentId) async {
    try {
      final res = await _auth.authorizedRequest(
        method: 'DELETE',
        uri: Uri.parse('$_baseUrl/posts/$postId/comments/$commentId'),
      );
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  Future<FollowResult> followProfile(
    String profileId,
    String profileType, {
    String? followerId,
    String followerType = 'human',
  }) async {
    try {
      final res = await _auth.authorizedRequest(
        method: 'POST',
        uri: Uri.parse('$_baseUrl/follows'),
        body: {
          'followee_id': profileId,
          'followee_type': profileType,
          if (followerId != null) 'follower_id': followerId,
          'follower_type': followerType,
        },
      );
      final data = jsonDecode(res.body);
      if (res.statusCode == 200 || res.statusCode == 201) {
        return FollowResult(
          success: true,
          following: data['following'] as bool? ?? false,
        );
      }
      return FollowResult(
        success: false,
        following: false,
        error: data['message']?.toString(),
      );
    } catch (_) {
      return const FollowResult(
        success: false,
        following: false,
        error: 'Network error',
      );
    }
  }

  Future<bool> isFollowingProfile(
    String profileId, {
    String? followerId,
    String followerType = 'human',
  }) async {
    try {
      final uri = Uri.parse('$_baseUrl/follows/check').replace(
        queryParameters: {
          'followee_id': profileId,
          if (followerId != null) 'follower_id': followerId,
          'follower_type': followerType,
        },
      );
      final res = await _auth.authorizedRequest(method: 'GET', uri: uri);
      if (res.statusCode != 200) return false;
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      return data['following'] as bool? ?? false;
    } catch (_) {
      return false;
    }
  }

  Future<bool> blockProfile(String profileId, {String? blockerId}) async {
    try {
      final uri = Uri.parse('$_baseUrl/profiles/$profileId/block').replace(
        queryParameters: {if (blockerId != null) 'blocker_id': blockerId},
      );
      final res = await _auth.authorizedRequest(method: 'POST', uri: uri);
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  Future<bool> unblockProfile(String profileId, {String? blockerId}) async {
    try {
      final uri = Uri.parse('$_baseUrl/profiles/$profileId/block').replace(
        queryParameters: {if (blockerId != null) 'blocker_id': blockerId},
      );
      final res = await _auth.authorizedRequest(method: 'DELETE', uri: uri);
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  Future<PostResult?> createPost({
    required String content,
    required String authorId,
    required String authorType,
    List<String> mediaUrls = const [],
    DateTime? scheduledAt,
    bool aiGenerated = false,
    String? assistedByAiId,
  }) async {
    try {
      final res = await _auth.authorizedRequest(
        method: 'POST',
        uri: Uri.parse('$_baseUrl/posts'),
        body: {
          'content': content,
          'author_type': authorType,
          if (authorType == 'ai') 'author_id': authorId,
          'ai_generated': aiGenerated,
          'media_urls': mediaUrls,
          if (scheduledAt != null)
            'scheduled_at': scheduledAt.toUtc().toIso8601String(),
          if (assistedByAiId != null) 'assisted_by_ai_id': assistedByAiId,
        },
      );
      if (res.statusCode == 201) {
        final data = jsonDecode(res.body);
        return PostResult(
          post: Post.fromJson(data['post']),
          status: data['status'] as String? ?? 'published',
          message: data['message'] as String? ?? 'Post created',
        );
      }
      try {
        final err = jsonDecode(res.body);
        return PostResult.error(
          err['message'] as String? ?? 'Failed to create post',
        );
      } catch (_) {
        return PostResult.error('Failed to create post');
      }
    } catch (e) {
      debugPrint('[FeedService] createPost error: $e');
      return PostResult.error('Post creation failed. Please check your connection or session.');
    }
  }

  Future<bool> deletePost(String postId) async {
    try {
      final res = await _auth.authorizedRequest(
        method: 'DELETE',
        uri: Uri.parse('$_baseUrl/posts/$postId'),
      );
      return res.statusCode == 200 || res.statusCode == 204;
    } catch (_) {
      return false;
    }
  }

  Future<List<Post>> searchPosts(String query) async {
    return searchPostsFiltered(query: query);
  }

  Future<List<Post>> searchPostsFiltered({
    String query = '',
    String? topic,
  }) async {
    try {
      final activeProfileId = _auth.activeProfileId;
      final uri = Uri.parse('$_baseUrl/explore/search').replace(
        queryParameters: {
          if (query.isNotEmpty) 'q': query,
          if (topic != null) 'topic': topic,
          if (activeProfileId != null) 'profile_id': activeProfileId,
        },
      );
      final res = await _auth.authorizedRequest(method: 'GET', uri: uri);
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        return (data['posts'] as List).map((p) => Post.fromJson(p)).toList();
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  Future<List<FollowProfile>> searchProfiles(String query, {String scope = 'global'}) async {
    return searchProfilesFiltered(query: query, scope: scope);
  }

  Future<List<FollowProfile>> searchProfilesFiltered({
    String query = '',
    String? aiCategory,
    String? topic,
    String scope = 'global',
  }) async {
    try {
      final activeProfileId = _auth.activeProfileId;
      final uri = Uri.parse('$_baseUrl/explore/search').replace(
        queryParameters: {
          if (query.isNotEmpty) 'q': query,
          'type': 'profiles',
          'scope': scope,
          if (aiCategory != null) 'ai_category': aiCategory,
          if (topic != null) 'topic': topic,
          if (activeProfileId != null) 'profile_id': activeProfileId,
        },
      );
      final res = await _auth.authorizedRequest(method: 'GET', uri: uri);
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        return (data['profiles'] as List)
            .map((p) => FollowProfile.fromJson(p))
            .toList();
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  Future<List<FollowProfile>> getSuggestedProfiles({String? aiCategory}) async {
    try {
      final uri = Uri.parse('$_baseUrl/explore/suggested-profiles').replace(
        queryParameters: {
          if (aiCategory != null) 'ai_category': aiCategory,
        },
      );
      final res = await _auth.authorizedRequest(method: 'GET', uri: uri);
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        return (data['profiles'] as List)
            .map((p) => FollowProfile.fromJson(p))
            .toList();
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  Future<List<Comment>> getComments(String postId) async {
    try {
      final uri = Uri.parse('$_baseUrl/posts/$postId/comments');
      final res = await _auth.authorizedRequest(method: 'GET', uri: uri);
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        return (data['comments'] as List)
            .map((c) => Comment.fromJson(c))
            .toList();
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  Future<Comment?> addComment({
    required String postId,
    required String content,
    required String authorId,
    required String authorType,
  }) async {
    try {
      final res = await _auth.authorizedRequest(
        method: 'POST',
        uri: Uri.parse('$_baseUrl/posts/$postId/comments'),
        body: {
          'content': content,
          'author_id': authorId,
          'author_type': authorType,
        },
      );
      if (res.statusCode == 201) {
        final data = jsonDecode(res.body);
        return Comment.fromJson(data['comment']);
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  Future<List<FollowProfile>> getFollowList({
    required String profileId,
    required String kind,
    String profileType = 'human',
  }) async {
    try {
      final uri = Uri.parse('$_baseUrl/follows/$kind/$profileId')
          .replace(queryParameters: {'type': profileType});
      final res = await _auth.authorizedRequest(method: 'GET', uri: uri);
      if (res.statusCode != 200) return [];
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final raw = data[kind] as List<dynamic>? ?? [];
      return raw
          .map((item) => FollowProfile.fromJson(item as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }

  Future<List<Post>> getPendingApprovals() async {
    try {
      final res = await _auth.authorizedRequest(
        method: 'GET',
        uri: Uri.parse('$_baseUrl/posts/pending'),
      );
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        return (data['posts'] as List).map((p) => Post.fromJson(p)).toList();
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  Future<bool> approvePost(String postId) async {
    try {
      final res = await _auth.authorizedRequest(
        method: 'POST',
        uri: Uri.parse('$_baseUrl/posts/$postId/approve'),
      );
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  Future<bool> rejectPost(String postId) async {
    try {
      final res = await _auth.authorizedRequest(
        method: 'POST',
        uri: Uri.parse('$_baseUrl/posts/$postId/reject'),
      );
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  Future<bool> reportPost(String postId, String reason, {String? details}) async {
    try {
      final res = await _auth.authorizedRequest(
        method: 'POST',
        uri: Uri.parse('$_baseUrl/posts/$postId/report'),
        body: {'reason': reason, 'details': details},
      );
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  Future<bool> reportProfile(String profileId, String reason, {String? details, String type = 'human'}) async {
    try {
      final res = await _auth.authorizedRequest(
        method: 'POST',
        uri: Uri.parse('$_baseUrl/profiles/$profileId/report'),
        body: {
          'reason': reason,
          'details': details,
          'profile_type': type,
        },
      );
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  Future<bool> reportComment(String postId, String commentId, String reason, {String? details}) async {
    try {
      final res = await _auth.authorizedRequest(
        method: 'POST',
        uri: Uri.parse('$_baseUrl/posts/$postId/comments/$commentId/report'),
        body: {'reason': reason, 'details': details},
      );
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  Future<Map<String, dynamic>?> getInsights() async {
    try {
      final res = await _auth.authorizedRequest(
        method: 'GET',
        uri: Uri.parse('$_baseUrl/profiles/me/insights'),
      );
      if (res.statusCode == 200) {
        return jsonDecode(res.body) as Map<String, dynamic>;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  Future<bool> setAIAutonomy(String aiProfileId, {required bool enabled}) async {
    try {
      final res = await _auth.authorizedRequest(
        method: 'PATCH',
        uri: Uri.parse('$_baseUrl/profiles/ai/$aiProfileId/autonomy'),
        body: {'enabled': enabled},
      );
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  Future<List<FlaggedPost>> getFlaggedPosts() async {
    try {
      final res = await _auth.authorizedRequest(
        method: 'GET',
        uri: Uri.parse('$_baseUrl/posts/flagged'),
      );
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        return (data['posts'] as List)
            .map((p) => FlaggedPost.fromJson(p))
            .toList();
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  Future<Map<String, dynamic>?> getComplianceData() async {
    try {
      final res = await _auth.authorizedRequest(
        method: 'GET',
        uri: Uri.parse('$_baseUrl/profiles/me/compliance'),
      );
      if (res.statusCode == 200) {
        return jsonDecode(res.body) as Map<String, dynamic>;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  Future<bool> resolveAnomaly(String anomalyId) async {
    try {
      final res = await _auth.authorizedRequest(
        method: 'POST',
        uri: Uri.parse('$_baseUrl/profiles/me/anomalies/$anomalyId/resolve'),
      );
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  Future<int> generateAIPosts() async {
    try {
      final res = await _auth.authorizedRequest(
        method: 'POST',
        uri: Uri.parse('$_baseUrl/ai/generate-posts'),
      );
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        return data['count'] ?? 0;
      }
      return 0;
    } catch (_) {
      return 0;
    }
  }
}

class FeedResult {
  final bool success;
  final List<Post> posts;
  final String? nextCursor;
  final bool hasMore;
  final String? error;

  const FeedResult._({
    required this.success,
    this.posts = const [],
    this.nextCursor,
    this.hasMore = false,
    this.error,
  });

  factory FeedResult.success({
    required List<Post> posts,
    String? nextCursor,
    bool hasMore = false,
  }) => FeedResult._(
        success: true,
        posts: posts,
        nextCursor: nextCursor,
        hasMore: hasMore,
      );

  factory FeedResult.failure(String error) =>
      FeedResult._(success: false, error: error);
}

class FollowResult {
  final bool success;
  final bool following;
  final String? error;

  const FollowResult({
    required this.success,
    required this.following,
    this.error,
  });
}

class FollowProfile {
  final String id;
  final String userId;
  final String username;
  final String displayName;
  final String? avatar;
  final String? bio;
  final String? category;
  final String? modelIdentity;
  final List<String> personalityTraits;
  final bool isVerified;
  final bool isAI;

  const FollowProfile({
    required this.id,
    required this.userId,
    required this.username,
    required this.displayName,
    this.avatar,
    this.bio,
    this.category,
    this.modelIdentity,
    this.personalityTraits = const [],
    required this.isVerified,
    required this.isAI,
  });

  factory FollowProfile.fromJson(Map<String, dynamic> json) => FollowProfile(
        id: json['id']?.toString() ?? '',
        userId: json['user_id']?.toString() ?? '',
        username: json['username']?.toString() ?? '',
        displayName: json['display_name']?.toString() ?? '',
        avatar: json['avatar']?.toString(),
        bio: json['bio']?.toString(),
        category: json['category']?.toString(),
        modelIdentity: json['model_identity']?.toString(),
        personalityTraits: (json['personality_traits'] as List<dynamic>?)
                ?.map((trait) => trait.toString())
                .toList() ??
            const [],
        isVerified: json['is_verified'] as bool? ?? false,
        isAI: json['is_ai'] as bool? ?? false,
      );
}

class FlaggedPost {
  final String id;
  final String content;
  final DateTime createdAt;
  final bool isFlagged;
  final String? flagReason;
  final String? reportReason;
  final DateTime? reportedAt;
  final String authorUsername;
  final String authorDisplayName;
  final String authorType;
  final String status;

  const FlaggedPost({
    required this.id,
    required this.content,
    required this.createdAt,
    required this.isFlagged,
    this.flagReason,
    this.reportReason,
    this.reportedAt,
    required this.authorUsername,
    required this.authorDisplayName,
    required this.authorType,
    required this.status,
  });

  factory FlaggedPost.fromJson(Map<String, dynamic> json) => FlaggedPost(
        id: json['id'] as String,
        content: json['content'] as String? ?? '',
        createdAt:
            DateTime.tryParse(json['created_at'] as String? ?? '') ??
                DateTime.now(),
        isFlagged: json['is_flagged'] as bool? ?? false,
        flagReason: json['flag_reason'] as String?,
        reportReason: json['report_reason'] as String?,
        reportedAt: json['reported_at'] != null
            ? DateTime.tryParse(json['reported_at'] as String)
            : null,
        authorUsername: json['author_username'] as String? ?? '',
        authorDisplayName: json['author_display_name'] as String? ?? '',
        authorType: json['author_type'] as String? ?? 'human',
        status: json['status'] as String? ?? 'published',
      );
}

class PostResult {
  final Post? post;
  final String status;
  final String? message;
  final String? error;
  final bool success;

  const PostResult({
    this.post,
    this.status = 'published',
    this.message,
    this.error,
    this.success = true,
  });

  factory PostResult.error(String error) => PostResult(
        success: false,
        error: error,
      );

  factory PostResult.fromJson(Map<String, dynamic> json) => PostResult(
        post: json['post'] != null ? Post.fromJson(json['post']) : null,
        status: json['status'] as String? ?? 'published',
        message: json['message'] as String?,
        success: true,
      );
}
