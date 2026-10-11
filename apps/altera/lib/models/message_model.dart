import 'dart:convert';

class Message {
  final String id;
  final String conversationId;
  final String senderId;
  final String senderName;
  final String? senderAvatarUrl;
  final bool senderIsVerified;
  final bool senderIsAI;
  final String content;
  final String? mediaUrl;
  final String? mediaType;
  final bool isRead;
  final String status; // sent, delivered, read
  final DateTime? deliveredAt;
  final bool isUnsended;
  final bool isForwarded;
  final List<MessageReaction> reactions;
  final DateTime createdAt;

  Message({
    required this.id,
    required this.conversationId,
    required this.senderId,
    required this.senderName,
    this.senderAvatarUrl,
    required this.senderIsVerified,
    this.senderIsAI = false,
    required this.content,
    this.mediaUrl,
    this.mediaType,
    required this.isRead,
    this.status = 'sent',
    this.deliveredAt,
    this.isUnsended = false,
    this.isForwarded = false,
    this.reactions = const [],
    required this.createdAt,
  });

  factory Message.fromJson(Map<String, dynamic> json) {
    return Message(
      id: json['id'] as String,
      conversationId: json['conversation_id'] as String,
      senderId: json['sender_id'] as String,
      senderName: json['sender_name'] as String,
      senderAvatarUrl: json['sender_avatar_url'] as String?,
      senderIsVerified: json['sender_is_verified'] as bool? ?? false,
      senderIsAI: json['sender_is_ai'] as bool? ?? false,
      content: json['content']?.toString() ?? '',
      mediaUrl: json['media_url'] as String?,
      mediaType: json['media_type'] as String?,
      isRead: json['is_read'] as bool? ?? false,
      status: json['status'] as String? ?? 'sent',
      deliveredAt: json['delivered_at'] != null ? DateTime.parse(json['delivered_at'] as String) : null,
      isUnsended: json['is_unsended'] as bool? ?? false,
      isForwarded: json['is_forwarded'] as bool? ?? false,
      reactions: (json['reactions'] is List)
          ? (json['reactions'] as List)
              .map((r) => MessageReaction.fromJson(r as Map<String, dynamic>))
              .toList()
          : [],
      createdAt: DateTime.parse(json['created_at'] as String),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'conversation_id': conversationId,
      'sender_id': senderId,
      'sender_name': senderName,
      'sender_avatar_url': senderAvatarUrl,
      'sender_is_verified': senderIsVerified,
      'sender_is_ai': senderIsAI,
      'content': content,
      'media_url': mediaUrl,
      'media_type': mediaType,
      'is_read': isRead,
      'status': status,
      'delivered_at': deliveredAt?.toIso8601String(),
      'is_unsended': isUnsended,
      'is_forwarded': isForwarded,
      'reactions': reactions.map((r) => r.toJson()).toList(),
      'created_at': createdAt.toIso8601String(),
    };
  }

  Message copyWith({
    bool? isRead,
    String? status,
    List<MessageReaction>? reactions,
    bool? isUnsended,
    bool? isForwarded,
  }) {
    return Message(
      id: id,
      conversationId: conversationId,
      senderId: senderId,
      senderName: senderName,
      senderAvatarUrl: senderAvatarUrl,
      senderIsVerified: senderIsVerified,
      senderIsAI: senderIsAI,
      content: content,
      mediaUrl: mediaUrl,
      mediaType: mediaType,
      isRead: isRead ?? this.isRead,
      status: status ?? this.status,
      deliveredAt: deliveredAt,
      isUnsended: isUnsended ?? this.isUnsended,
      isForwarded: isForwarded ?? this.isForwarded,
      reactions: reactions ?? this.reactions,
      createdAt: createdAt,
    );
  }
}

class MessageReaction {
  final String userId;
  final String emoji;

  MessageReaction({required this.userId, required this.emoji});

  factory MessageReaction.fromJson(Map<String, dynamic> json) {
    return MessageReaction(
      userId: json['user_id'] as String,
      emoji: json['emoji'] as String,
    );
  }

  Map<String, dynamic> toJson() => {'user_id': userId, 'emoji': emoji};
}

const String kSharedPostMarker = '[[POST_SHARE]]';

class SharedPostPreview {
  final String postId;
  final String authorName;
  final String authorUsername;
  final String content;
  final String? mediaUrl;
  final String? note;

  const SharedPostPreview({
    required this.postId,
    required this.authorName,
    required this.authorUsername,
    required this.content,
    this.mediaUrl,
    this.note,
  });

  static SharedPostPreview? fromMessageContent(String rawContent) {
    if (!rawContent.startsWith(kSharedPostMarker)) return null;

    try {
      final payload = jsonDecode(
        rawContent.substring(kSharedPostMarker.length),
      ) as Map<String, dynamic>;

      return SharedPostPreview(
        postId: payload['post_id'] as String? ?? '',
        authorName: payload['author_name'] as String? ?? 'User',
        authorUsername: payload['author_username'] as String? ?? '',
        content: payload['content'] as String? ?? '',
        mediaUrl: payload['media_url'] as String?,
        note: payload['note'] as String?,
      );
    } catch (_) {
      return null;
    }
  }

  static String buildMessageContent({
    required String postId,
    required String authorName,
    required String authorUsername,
    required String content,
    String? mediaUrl,
    String? note,
  }) {
    return '$kSharedPostMarker${jsonEncode({
          'post_id': postId,
          'author_name': authorName,
          'author_username': authorUsername,
          'content': content,
          'media_url': mediaUrl,
          'note': note,
        })}';
  }
}

class Conversation {
  final String id;
  final String userId;
  final String? profileId;
  final String userName;
  final String? userAvatarUrl;
  final bool userIsVerified;
  final bool userIsAI;
  final Message? lastMessage;
  final int unreadCount;
  final bool isPinned;
  final bool isArchived;
  final bool isMuted;
  final DateTime createdAt;

  Conversation({
    required this.id,
    required this.userId,
    this.profileId,
    required this.userName,
    this.userAvatarUrl,
    required this.userIsVerified,
    required this.userIsAI,
    this.lastMessage,
    required this.unreadCount,
    this.isPinned = false,
    this.isArchived = false,
    this.isMuted = false,
    required this.createdAt,
  });

  factory Conversation.fromJson(Map<String, dynamic> json) {
    return Conversation(
      id: json['id'] as String,
      userId: json['user_id']?.toString() ?? '',
      profileId: json['profile_id']?.toString(),
      userName: json['user_name']?.toString() ?? 'User',
      userAvatarUrl: json['user_avatar_url']?.toString(),
      userIsVerified: json['user_is_verified'] as bool? ?? false,
      userIsAI: json['user_is_ai'] as bool? ?? false,
      lastMessage: json['last_message'] != null
          ? Message.fromJson(json['last_message'] as Map<String, dynamic>)
          : null,
      unreadCount: json['unread_count'] as int? ?? 0,
      isPinned: json['is_pinned'] as bool? ?? false,
      isArchived: json['is_archived'] as bool? ?? false,
      isMuted: json['is_muted'] as bool? ?? false,
      createdAt: DateTime.parse(json['created_at'] as String),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'user_id': userId,
      'profile_id': profileId,
      'user_name': userName,
      'user_avatar_url': userAvatarUrl,
      'user_is_verified': userIsVerified,
      'user_is_ai': userIsAI,
      'last_message': lastMessage?.toJson(),
      'unread_count': unreadCount,
      'is_pinned': isPinned,
      'is_archived': isArchived,
      'is_muted': isMuted,
      'created_at': createdAt.toIso8601String(),
    };
  }

  Conversation copyWith({
    bool? isPinned,
    bool? isArchived,
    bool? isMuted,
    int? unreadCount,
  }) {
    return Conversation(
      id: id,
      userId: userId,
      profileId: profileId,
      userName: userName,
      userAvatarUrl: userAvatarUrl,
      userIsVerified: userIsVerified,
      userIsAI: userIsAI,
      lastMessage: lastMessage,
      unreadCount: unreadCount ?? this.unreadCount,
      isPinned: isPinned ?? this.isPinned,
      isArchived: isArchived ?? this.isArchived,
      isMuted: isMuted ?? this.isMuted,
      createdAt: createdAt,
    );
  }
}
