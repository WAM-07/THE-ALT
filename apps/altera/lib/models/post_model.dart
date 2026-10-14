enum AuthorType { human, ai, bot }

List<String> _parseMediaUrls(dynamic rawMediaUrls) {
  if (rawMediaUrls is List) {
    return rawMediaUrls
        .map((item) => item?.toString() ?? '')
        .where((item) => item.isNotEmpty)
        .toList();
  }

  return const [];
}

class Post {
  final String id;
  final String authorId;
  final String? authorUserId;
  final AuthorType authorType;
  final String authorUsername;
  final String authorDisplayName;
  final String? authorAvatar;
  final bool authorIsVerified;
  final String content;
  final List<String> mediaUrls;
  final String status;
  final bool isAutonomous;
  final int commentCount;
  final int reactionCount;
  final DateTime publishedAt;
  final List<String> hashtags;
  /// "Posted with <AI>": the AI (owned, rented or subscribed) that drafted this person's post.
  final String? assistedByName;
  final String? assistedByHandle;
  bool hasReacted;
  bool isFollowingAuthor;

  Post({
    required this.id,
    required this.authorId,
    this.authorUserId,
    required this.authorType,
    required this.authorUsername,
    required this.authorDisplayName,
    this.authorAvatar,
    this.authorIsVerified = false,
    required this.content,
    this.mediaUrls = const [],
    this.status = 'published',
    this.isAutonomous = false,
    this.commentCount = 0,
    this.reactionCount = 0,
    required this.publishedAt,
    this.hashtags = const [],
    this.assistedByName,
    this.assistedByHandle,
    this.hasReacted = false,
    this.isFollowingAuthor = false,
  });

  factory Post.fromJson(Map<String, dynamic> json) => Post(
        id: json['id']?.toString() ?? '',
        authorId: json['author_id']?.toString() ?? '',
        authorUserId: json['author_user_id']?.toString(),
        authorType: AuthorType.values.firstWhere(
          (t) => t.name == json['author_type'],
          orElse: () => AuthorType.human,
        ),
        authorUsername: json['author_username']?.toString() ?? '',
        authorDisplayName: json['author_display_name']?.toString() ?? '',
        authorAvatar: json['author_avatar']?.toString(),
        authorIsVerified: json['author_is_verified'] ?? false,
        content: json['content']?.toString() ?? '',
        mediaUrls: _parseMediaUrls(json['media_urls']),
        status: json['status']?.toString() ?? 'published',
        isAutonomous: json['is_autonomous'] ?? false,
        commentCount: json['comment_count'] ?? 0,
        reactionCount: json['reaction_count'] ?? 0,
        publishedAt: json['published_at'] != null 
            ? DateTime.tryParse(json['published_at'].toString()) ?? DateTime.now()
            : DateTime.now(),
        hashtags: List<String>.from(json['hashtags'] ?? []),
        assistedByName: json['assisted_by_name']?.toString(),
        assistedByHandle: json['assisted_by_handle']?.toString(),
        hasReacted: json['has_reacted'] ?? false,
        isFollowingAuthor: json['is_following_author'] ?? false,
      );

  Post copyWith({
    bool? hasReacted,
    int? reactionCount,
    int? commentCount,
    bool? isFollowingAuthor,
  }) => Post(
        id: id,
        authorId: authorId,
        authorUserId: authorUserId,
        authorType: authorType,
        authorUsername: authorUsername,
        authorDisplayName: authorDisplayName,
        authorAvatar: authorAvatar,
        authorIsVerified: authorIsVerified,
        content: content,
        mediaUrls: mediaUrls,
        status: status,
        isAutonomous: isAutonomous,
        commentCount: commentCount ?? this.commentCount,
        reactionCount: reactionCount ?? this.reactionCount,
        publishedAt: publishedAt,
        hashtags: hashtags,
        assistedByName: assistedByName,
        assistedByHandle: assistedByHandle,
        hasReacted: hasReacted ?? this.hasReacted,
        isFollowingAuthor: isFollowingAuthor ?? this.isFollowingAuthor,
      );
}

class Comment {
  final String id;
  final String postId;
  final String authorId;
  final AuthorType authorType;
  final String authorUsername;
  final String authorDisplayName;
  final String? authorAvatar;
  final String content;
  final int likeCount;
  final bool hasReacted;
  final DateTime createdAt;
  /// "Replied with <AI>": the AI (owned, rented or subscribed) that drafted this comment.
  final String? assistedByName;

  const Comment({
    required this.id,
    required this.postId,
    required this.authorId,
    required this.authorType,
    required this.authorUsername,
    required this.authorDisplayName,
    this.authorAvatar,
    required this.content,
    this.likeCount = 0,
    this.hasReacted = false,
    required this.createdAt,
    this.assistedByName,
  });

  Comment copyWith({
    int? likeCount,
    bool? hasReacted,
  }) => Comment(
    id: id,
    postId: postId,
    authorId: authorId,
    authorType: authorType,
    authorUsername: authorUsername,
    authorDisplayName: authorDisplayName,
    authorAvatar: authorAvatar,
    content: content,
    likeCount: likeCount ?? this.likeCount,
    hasReacted: hasReacted ?? this.hasReacted,
    createdAt: createdAt,
  );

  factory Comment.fromJson(Map<String, dynamic> json) => Comment(
        id: json['id']?.toString() ?? '',
        postId: json['post_id']?.toString() ?? '',
        authorId: json['author_id']?.toString() ?? '',
        authorType: AuthorType.values.firstWhere(
          (t) => t.name == json['author_type'],
          orElse: () => AuthorType.human,
        ),
        authorUsername: json['author_username']?.toString() ?? '',
        authorDisplayName: json['author_display_name']?.toString() ?? '',
        authorAvatar: json['author_avatar']?.toString(),
        content: json['content']?.toString() ?? '',
        likeCount: json['like_count'] ?? 0,
        hasReacted: json['has_reacted'] ?? false,
        assistedByName: json['assisted_by_name']?.toString(),
        createdAt: json['created_at'] != null 
            ? DateTime.tryParse(json['created_at'].toString()) ?? DateTime.now()
            : DateTime.now(),
      );
}
