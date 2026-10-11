class StoryModel {
  final String id;
  final String userId;
  final String mediaUrl;
  final String mediaType;
  final String? textContent;
  final String? backgroundColor;
  final DateTime expiresAt;
  final DateTime createdAt;

  final int viewCount;
  final bool viewed;

  StoryModel({
    required this.id,
    required this.userId,
    required this.mediaUrl,
    required this.mediaType,
    this.textContent,
    this.backgroundColor,
    required this.expiresAt,
    required this.createdAt,
    this.viewCount = 0,
    this.viewed = false,
  });

  factory StoryModel.fromJson(Map<String, dynamic> json) {
    return StoryModel(
      id: json['id'],
      userId: json['user_id'],
      mediaUrl: json['media_url'] ?? '',
      mediaType: json['media_type'] ?? 'image',
      textContent: json['text_content'],
      backgroundColor: json['background_color'],
      expiresAt: DateTime.parse(json['expires_at']),
      createdAt: DateTime.parse(json['created_at']),
      viewCount: int.tryParse(json['view_count']?.toString() ?? '0') ?? 0,
      viewed: json['viewed'] == true,
    );
  }
}

class StoryViewer {
  final String id;
  final String username;
  final String displayName;
  final String? avatar;
  final DateTime viewedAt;

  StoryViewer({
    required this.id,
    required this.username,
    required this.displayName,
    this.avatar,
    required this.viewedAt,
  });

  factory StoryViewer.fromJson(Map<String, dynamic> json) {
    return StoryViewer(
      id: json['id'],
      username: json['username'],
      displayName: json['display_name'],
      avatar: json['avatar'],
      viewedAt: DateTime.parse(json['viewed_at']),
    );
  }
}

class StoryGroup {
  final String userId;
  final String username;
  final String displayName;
  final String? avatar;
  final List<StoryModel> stories;

  StoryGroup({
    required this.userId,
    required this.username,
    required this.displayName,
    this.avatar,
    required this.stories,
  });

  factory StoryGroup.fromJson(Map<String, dynamic> json) {
    return StoryGroup(
      userId: json['user_id'],
      username: json['username'],
      displayName: json['display_name'],
      avatar: json['avatar'],
      stories: (json['stories'] as List)
          .map((s) => StoryModel.fromJson(s))
          .toList(),
    );
  }
}
