enum NotificationType {
  follow,
  comment,
  reaction,
  message,
  aiDraftReady,
  aiPostPublished,
  mention,
}

class NotificationModel {
  final String id;
  final String recipientId;
  final NotificationType type;
  final String title;
  final String body;
  final Map<String, dynamic> payload;
  final DateTime createdAt;
  final bool isRead;

  const NotificationModel({
    required this.id,
    required this.recipientId,
    required this.type,
    required this.title,
    required this.body,
    this.payload = const {},
    required this.createdAt,
    this.isRead = false,
  });

  factory NotificationModel.fromJson(Map<String, dynamic> json) {
    final rawType = (json['type'] as String? ?? 'mention').toLowerCase();
    final typeStr = rawType == 'like' ? 'reaction' : rawType;
    final type = NotificationType.values.firstWhere(
      (t) => t.name == typeStr,
      orElse: () => NotificationType.mention,
    );

    final actorName = json['actor_name'] as String? ?? 'Someone';
    final message = json['message'] as String? ?? '';
    final postSnippet = json['post_snippet'] as String?;

    final body = _buildBody(
      type: type,
      message: message,
      postSnippet: postSnippet,
    );

    return NotificationModel(
      id: json['id'],
      recipientId: json['user_id'] ?? '',
      type: type,
      title: actorName,
      body: body,
      payload: {
        'post_id': json['post_id'],
        'comment_id': json['comment_id'],
        'actor_avatar': json['actor_avatar'],
        'actor_type': json['actor_type'],
        'actor_is_verified': json['actor_is_verified'],
      },
      createdAt: DateTime.parse(json['created_at']),
      isRead: json['is_read'] as bool? ?? false,
    );
  }

  NotificationModel copyWith({bool? isRead}) => NotificationModel(
        id: id,
        recipientId: recipientId,
        type: type,
        title: title,
        body: body,
        payload: payload,
        createdAt: createdAt,
        isRead: isRead ?? this.isRead,
      );

  static String _buildBody({
    required NotificationType type,
    required String message,
    String? postSnippet,
  }) {
    final cleanedSnippet = postSnippet?.trim();
    final hasSnippet = cleanedSnippet != null && cleanedSnippet.isNotEmpty;

    switch (type) {
      case NotificationType.follow:
        return message.isNotEmpty ? message : 'started following you.';
      case NotificationType.comment:
        if (hasSnippet) {
          return message.isNotEmpty
              ? '$message "$cleanedSnippet..."'
              : 'commented on your post: "$cleanedSnippet..."';
        }
        return message.isNotEmpty ? message : 'commented on your post.';
      case NotificationType.reaction:
        if (hasSnippet) {
          return message.isNotEmpty
              ? '$message "$cleanedSnippet..."'
              : 'liked your post: "$cleanedSnippet..."';
        }
        return message.isNotEmpty ? message : 'liked your post.';
      case NotificationType.message:
        return message.isNotEmpty ? message : 'sent you a message.';
      case NotificationType.aiDraftReady:
      case NotificationType.aiPostPublished:
      case NotificationType.mention:
        if (hasSnippet && message.isNotEmpty) {
          return '$message "$cleanedSnippet..."';
        }
        return message;
    }
  }
}

class Message {
  final String id;
  final String senderId;
  final String senderType;
  final String receiverId;
  final String receiverType;
  final String content;
  final DateTime createdAt;
  final bool isOwn;

  const Message({
    required this.id,
    required this.senderId,
    required this.senderType,
    required this.receiverId,
    required this.receiverType,
    required this.content,
    required this.createdAt,
    this.isOwn = false,
  });

  factory Message.fromJson(Map<String, dynamic> json, {String? currentUserId}) => Message(
        id: json['id'],
        senderId: json['sender_id'],
        senderType: json['sender_type'],
        receiverId: json['receiver_id'],
        receiverType: json['receiver_type'],
        content: json['content'],
        createdAt: DateTime.parse(json['created_at']),
        isOwn: json['sender_id'] == currentUserId,
      );
}
