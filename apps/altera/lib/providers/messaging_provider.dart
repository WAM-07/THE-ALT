import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import '../config/app_config.dart';
import '../models/message_model.dart';
import '../models/user_model.dart';
import '../services/auth_service.dart';
import '../services/messaging_service.dart';
import 'auth_provider.dart';

/// What ALT's safety check said about a message the person just tried to send (Module 16).
/// [blocked]: not sent. Otherwise a warning: "This may be hurtful. Send it anyway?".
class DmSafetyNotice {
  final bool blocked;
  final String message;
  final String draftId;

  const DmSafetyNotice({required this.blocked, required this.message, required this.draftId});
}

class _DmDraft {
  final Conversation conversation;
  final String content;
  final String? mediaUrl;
  final String? mediaType;
  final bool isForwarded;

  const _DmDraft(this.conversation, this.content, this.mediaUrl, this.mediaType, this.isForwarded);
}

class MessagingState {
  final List<Conversation> conversations;
  final Map<String, List<Message>> messagesByConversation;
  final List<Message> searchMessages;
  final List<Conversation> searchConversations;
  final String? activeConversationId;
  final bool isLoading;
  final bool isSearching;
  final String? error;
  final DmSafetyNotice? safetyNotice;

  const MessagingState({
    required this.conversations,
    required this.messagesByConversation,
    this.searchMessages = const [],
    this.searchConversations = const [],
    this.activeConversationId,
    this.isLoading = false,
    this.isSearching = false,
    this.error,
    this.safetyNotice,
  });

  MessagingState copyWith({
    List<Conversation>? conversations,
    Map<String, List<Message>>? messagesByConversation,
    List<Message>? searchMessages,
    List<Conversation>? searchConversations,
    String? activeConversationId,
    bool? isLoading,
    bool? isSearching,
    String? error,
    DmSafetyNotice? safetyNotice,
    bool clearSafetyNotice = false,
  }) {
    return MessagingState(
      conversations: conversations ?? this.conversations,
      messagesByConversation:
          messagesByConversation ?? this.messagesByConversation,
      searchMessages: searchMessages ?? this.searchMessages,
      searchConversations: searchConversations ?? this.searchConversations,
      activeConversationId: activeConversationId ?? this.activeConversationId,
      isLoading: isLoading ?? this.isLoading,
      isSearching: isSearching ?? this.isSearching,
      error: error,
      safetyNotice: clearSafetyNotice ? null : (safetyNotice ?? this.safetyNotice),
    );
  }

  int get totalUnreadCount {
    try {
      return conversations.where((c) => c.unreadCount > 0).length;
    } catch (_) {
      return 0;
    }
  }
}

class MessagingNotifier extends StateNotifier<MessagingState> {
  final Ref ref;
  final AuthService _authService;
  final MessagingService _messagingService;
  io.Socket? _socket;

  MessagingNotifier(this.ref, this._authService, this._messagingService)
      : super(const MessagingState(
          conversations: [],
          messagesByConversation: {},
        )) {
    _initSocket();
    loadConversations();
  }

  Future<void> _initSocket() async {
    final token = await _authService.getToken();
    if (token == null) return;

    _socket?.disconnect();
    _socket?.dispose();

    _socket = io.io(AppConfig.socketUrl, <String, dynamic>{
      'transports': ['websocket'],
      'path': AppConfig.socketPath,
      'autoConnect': false,
      'auth': {'token': token},
    });

    _socket?.connect();
    _socket?.on('dm:receive', _handleIncomingMessage);
    _socket?.on('dm:sent', _handleIncomingMessage);
    _socket?.on('dm:status', _handleMessageStatus);
    _socket?.on('dm:error', (data) {
      if (data is Map && data['code'] == 'CONTENT_BLOCKED') {
        final draftId = data['client_id']?.toString() ?? '';
        _dropPending(draftId);
        _drafts.remove(draftId);
        state = state.copyWith(
          safetyNotice: DmSafetyNotice(blocked: true, message: data['message']?.toString() ?? 'Not sent.', draftId: draftId),
        );
        return;
      }
      state = state.copyWith(error: data['message']?.toString() ?? 'Message failed');
    });
    // The message may be hurtful: it was not sent; the person decides (confirmSafetyNotice / dismissSafetyNotice).
    _socket?.on('dm:warn', (data) {
      if (data is! Map) return;
      final draftId = data['client_id']?.toString() ?? '';
      _dropPending(draftId);
      state = state.copyWith(
        safetyNotice: DmSafetyNotice(blocked: false, message: data['message']?.toString() ?? 'This message may be hurtful. Send it anyway?', draftId: draftId),
      );
    });
  }

  Message _messageFromSocket(Map<String, dynamic> data) {
    return Message(
      id: data['id'] as String,
      conversationId: data['conversation_id'] as String,
      senderId: data['sender_id'] as String,
      senderName: data['sender_name'] as String? ?? 'User',
      senderAvatarUrl: data['sender_avatar_url'] as String?,
      senderIsVerified: data['sender_is_verified'] as bool? ?? false,
      senderIsAI: data['sender_is_ai'] as bool? ?? false,
      content: data['content'] as String? ?? '',
      mediaUrl: data['media_url'] as String?,
      mediaType: data['media_type'] as String?,
      isRead: data['is_read'] as bool? ?? false,
      status: data['status'] as String? ?? 'sent',
      createdAt: DateTime.parse(data['created_at'] as String),
    );
  }

  void _handleMessageStatus(dynamic data) {
    if (data is! Map) return;

    final raw = Map<String, dynamic>.from(data as Map);
    final conversationId = raw['conversation_id']?.toString();
    if (conversationId == null || conversationId.isEmpty) return;

    final messageIds = (raw['message_ids'] as List<dynamic>? ?? const [])
        .map((id) => id.toString())
        .where((id) => id.isNotEmpty)
        .toSet();
    if (messageIds.isEmpty) return;

    final nextStatus = raw['status']?.toString() ?? 'sent';
    final updatedMessages = state.messagesByConversation[conversationId]?.map((message) {
      if (!messageIds.contains(message.id)) return message;
      return message.copyWith(
        isRead: nextStatus == 'read' || nextStatus == 'played' ? true : message.isRead,
        status: nextStatus,
      );
    }).toList();

    if (updatedMessages == null) return;

    final updatedConversations = state.conversations.map((conversation) {
      if (conversation.id != conversationId || conversation.lastMessage == null) {
        return conversation;
      }

      final lastMessage = conversation.lastMessage!;
      if (!messageIds.contains(lastMessage.id)) {
        return conversation;
      }

      return Conversation(
        id: conversation.id,
        userId: conversation.userId,
        profileId: conversation.profileId,
        userName: conversation.userName,
        userAvatarUrl: conversation.userAvatarUrl,
        userIsVerified: conversation.userIsVerified,
        userIsAI: conversation.userIsAI,
        lastMessage: lastMessage.copyWith(
          isRead: nextStatus == 'read' || nextStatus == 'played' ? true : lastMessage.isRead,
          status: nextStatus,
        ),
        unreadCount: conversation.unreadCount,
        isPinned: conversation.isPinned,
        isArchived: conversation.isArchived,
        isMuted: conversation.isMuted,
        createdAt: conversation.createdAt,
      );
    }).toList();

    state = state.copyWith(
      conversations: updatedConversations,
      messagesByConversation: {
        ...state.messagesByConversation,
        conversationId: updatedMessages,
      },
    );
  }

  void _handleIncomingMessage(dynamic data) {
    if (data is! Map) return;

    final raw = Map<String, dynamic>.from(data as Map);
    final auth = ref.read(authStateProvider);
    final activeId = auth.activeProfileId;
    if (activeId == null) return;

    final incoming = _messageFromSocket(raw);
    final conversationId = incoming.conversationId;
    final existingMessages = state.messagesByConversation[conversationId] ?? [];
    final alreadyExists = existingMessages.any((message) => message.id == incoming.id);

    List<Message> updatedMessages;
    if (alreadyExists) {
      updatedMessages = existingMessages;
    } else {
      final localPendingIndex = raw['sender_id'] == activeId
          ? existingMessages.lastIndexWhere(
              (message) =>
                  message.id.startsWith('local_') &&
                  message.senderId == incoming.senderId &&
                  message.content == incoming.content &&
                  message.mediaUrl == incoming.mediaUrl,
            )
          : -1;

      if (localPendingIndex != -1) {
        updatedMessages = [...existingMessages];
        updatedMessages[localPendingIndex] = incoming;
      } else {
        updatedMessages = [...existingMessages, incoming];
      }
      updatedMessages.sort((a, b) => a.createdAt.compareTo(b.createdAt));
    }

    final messagesMap = {
      ...state.messagesByConversation,
      conversationId: updatedMessages,
    };

    // Check if I am the sender (comparing against active profile ID)
    final isMe = incoming.senderId == activeId;

    final partnerName = isMe
        ? raw['receiver_name'] as String? ?? 'User'
        : incoming.senderName;
    final partnerAvatar = isMe
        ? raw['receiver_avatar_url'] as String?
        : incoming.senderAvatarUrl;
    final partnerIsVerified = isMe
        ? raw['receiver_is_verified'] as bool? ?? false
        : incoming.senderIsVerified;
    final partnerIsAI = isMe
        ? raw['receiver_is_ai'] as bool? ?? false
        : incoming.senderIsAI;
    final partnerProfileId = isMe
        ? raw['receiver_profile_id'] as String?
        : raw['sender_profile_id'] as String?;
    final partnerAccountId = isMe
        ? raw['receiver_user_id'] as String? ?? ''
        : raw['sender_user_id'] as String? ?? '';

    final conversations = [...state.conversations];
    final conversationIndex =
        conversations.indexWhere((conversation) => conversation.id == conversationId);
    final unreadCount = isMe ||
            state.activeConversationId == conversationId
        ? 0
        : ((conversationIndex >= 0 ? conversations[conversationIndex].unreadCount : 0) + 1);

    final updatedConversation = Conversation(
      id: conversationId,
      userId: partnerAccountId,
      profileId: partnerProfileId,
      userName: partnerName,
      userAvatarUrl: partnerAvatar,
      userIsVerified: partnerIsVerified,
      userIsAI: partnerIsAI,
      lastMessage: incoming,
      unreadCount: unreadCount,
      isPinned: conversationIndex >= 0 ? conversations[conversationIndex].isPinned : false,
      isArchived: conversationIndex >= 0 ? conversations[conversationIndex].isArchived : false,
      isMuted: conversationIndex >= 0 ? conversations[conversationIndex].isMuted : false,
      createdAt: incoming.createdAt,
    );

    if (conversationIndex >= 0) {
      conversations[conversationIndex] = updatedConversation;
    } else {
      conversations.add(updatedConversation);
    }

    conversations.sort((a, b) {
      final aDate = a.lastMessage?.createdAt ?? a.createdAt;
      final bDate = b.lastMessage?.createdAt ?? b.createdAt;
      return bDate.compareTo(aDate);
    });

    state = state.copyWith(
      conversations: conversations,
      messagesByConversation: messagesMap,
    );
  }

  @override
  void dispose() {
    _socket?.disconnect();
    _socket?.dispose();
    super.dispose();
  }

  Future<void> reconnectSocket() async {
    await _initSocket();
  }

  Future<void> loadConversations() async {
    final activeId = ref.read(authStateProvider).activeProfileId;
    if (activeId == null) return;

    state = state.copyWith(isLoading: true, error: null);
    try {
      final conversations = await _messagingService.getConversations(activeId);
      if (!mounted) return;
      state = state.copyWith(
        conversations: conversations,
        isLoading: false,
      );
    } catch (e) {
      if (!mounted) return;
      state = state.copyWith(
        isLoading: false,
        error: e.toString(),
      );
    }
  }

  Future<void> loadConversationMessages(String conversationId) async {
    final activeId = ref.read(authStateProvider).activeProfileId;
    state = state.copyWith(activeConversationId: conversationId, error: null);

    try {
      final messages = await _messagingService.getConversationMessages(conversationId);
      if (!mounted) return;
      final map = {
        ...state.messagesByConversation,
        conversationId: messages,
      };

      final conversations = state.conversations.map((conversation) {
        if (conversation.id == conversationId) {
          return Conversation(
            id: conversation.id,
            userId: conversation.userId,
            profileId: conversation.profileId,
            userName: conversation.userName,
            userAvatarUrl: conversation.userAvatarUrl,
            userIsVerified: conversation.userIsVerified,
            userIsAI: conversation.userIsAI,
            lastMessage: conversation.lastMessage,
            unreadCount: 0,
            isPinned: conversation.isPinned,
            isArchived: conversation.isArchived,
            isMuted: conversation.isMuted,
            createdAt: conversation.createdAt,
          );
        }
        return conversation;
      }).toList();

      state = state.copyWith(
        messagesByConversation: map,
        conversations: conversations,
      );
      await _messagingService.markConversationRead(conversationId);

      final unreadIncomingIds = messages
          .where((message) => !message.isRead && message.senderId != activeId)
          .map((message) => message.id)
          .toList();
      if (unreadIncomingIds.isNotEmpty) {
        _socket?.emit('dm:read', {
          'conversation_id': conversationId,
          'reader_profile_id': activeId,
          'message_ids': unreadIncomingIds,
        });
      }
    } catch (e) {
      if (!mounted) return;
      state = state.copyWith(error: e.toString());
    }
  }

  final Map<String, _DmDraft> _drafts = {};

  /// Removes a message shown while it was being sent (it was not delivered).
  void _dropPending(String draftId) {
    if (draftId.isEmpty) return;
    final byConversation = <String, List<Message>>{};
    state.messagesByConversation.forEach((id, messages) {
      byConversation[id] = messages.where((m) => m.id != draftId).toList();
    });
    state = state.copyWith(messagesByConversation: byConversation);
  }

  /// "Send anyway": sends the message the safety check warned about.
  Future<void> confirmSafetyNotice() async {
    final notice = state.safetyNotice;
    state = state.copyWith(clearSafetyNotice: true);
    final draft = notice == null ? null : _drafts.remove(notice.draftId);
    if (draft == null) return;
    await sendMessage(draft.conversation, draft.content,
        mediaUrl: draft.mediaUrl, mediaType: draft.mediaType, isForwarded: draft.isForwarded, confirmed: true);
  }

  void dismissSafetyNotice() {
    final notice = state.safetyNotice;
    if (notice != null) _drafts.remove(notice.draftId);
    state = state.copyWith(clearSafetyNotice: true);
  }

  Future<bool> sendMessage(
    Conversation conversation,
    String content, {
    String? mediaUrl,
    String? mediaType,
    bool isForwarded = false,
    bool confirmed = false,
  }) async {
    final auth = ref.read(authStateProvider);
    final activeId = auth.activeProfileId;
    if (activeId == null) {
      state = state.copyWith(error: 'No active profile selected');
      return false;
    }

    if (_socket == null || !_socket!.connected) {
      await _initSocket();
      if (_socket == null || !_socket!.connected) {
        await Future<void>.delayed(const Duration(milliseconds: 300));
      }
    }

    if (_socket == null || !_socket!.connected) {
      state = state.copyWith(error: 'Unable to connect to messaging');
      return false;
    }

    final isAI = activeId != auth.user?.humanProfile?.id;
    final HumanProfile? activeHumanProfile = isAI ? null : auth.user?.humanProfile;
    final AIProfile? activeAiProfile = isAI
        ? auth.user?.aiProfiles.where((profile) => profile.id == activeId).firstOrNull
        : null;
    final now = DateTime.now();
    final pendingMessage = Message(
      id: 'local_${now.microsecondsSinceEpoch}',
      conversationId: conversation.id,
      senderId: activeId,
      senderName:
          activeAiProfile?.displayName ?? activeHumanProfile?.displayName ?? 'You',
      senderAvatarUrl: activeAiProfile?.avatar ?? activeHumanProfile?.avatar,
      senderIsVerified: activeAiProfile?.isVerified ?? false,
      senderIsAI: isAI,
      content: content,
      mediaUrl: mediaUrl,
      mediaType: mediaType,
      isRead: true,
      isForwarded: isForwarded,
      createdAt: now,
    );

    final existingMessages = state.messagesByConversation[conversation.id] ?? [];
    final updatedMessages = [...existingMessages, pendingMessage]
      ..sort((a, b) => a.createdAt.compareTo(b.createdAt));
    final updatedConversation = Conversation(
      id: conversation.id,
      userId: conversation.userId,
      profileId: conversation.profileId,
      userName: conversation.userName,
      userAvatarUrl: conversation.userAvatarUrl,
      userIsVerified: conversation.userIsVerified,
      userIsAI: conversation.userIsAI,
      lastMessage: pendingMessage,
      unreadCount: 0,
      isPinned: conversation.isPinned,
      isArchived: conversation.isArchived,
      createdAt: conversation.createdAt,
    );
    final conversations = [...state.conversations];
    final existingConversationIndex =
        conversations.indexWhere((item) => item.id == conversation.id);
    if (existingConversationIndex >= 0) {
      conversations[existingConversationIndex] = updatedConversation;
    } else {
      conversations.add(updatedConversation);
    }
    conversations.sort((a, b) {
      final aDate = a.lastMessage?.createdAt ?? a.createdAt;
      final bDate = b.lastMessage?.createdAt ?? b.createdAt;
      return bDate.compareTo(aDate);
    });

    state = state.copyWith(
      conversations: conversations,
      messagesByConversation: {
        ...state.messagesByConversation,
        conversation.id: updatedMessages,
      },
      error: null,
    );

    _socket?.emit('dm:send', {
      'sender_profile_id': activeId,
      'sender_type': isAI ? 'ai' : 'human',
      'receiver_id': conversation.profileId ?? conversation.userId,
      'receiver_type': conversation.userIsAI ? 'ai' : 'human',
      'content': content,
      if (mediaUrl != null) 'media_url': mediaUrl,
      if (mediaType != null) 'media_type': mediaType,
      'is_forwarded': isForwarded,
      'client_id': pendingMessage.id,
      if (confirmed) 'confirmed': true,
    });
    // Kept briefly, in case the safety check asks the person to confirm it.
    _drafts[pendingMessage.id] = _DmDraft(conversation, content, mediaUrl, mediaType, isForwarded);
    while (_drafts.length > 20) {
      _drafts.remove(_drafts.keys.first);
    }
    return true;
  }

  void setActiveConversation(String? conversationId) {
    state = state.copyWith(activeConversationId: conversationId);
  }

  Future<void> search(String query) async {
    if (query.isEmpty) {
      state = state.copyWith(searchMessages: [], searchConversations: [], isSearching: false);
      return;
    }

    final activeId = ref.read(authStateProvider).activeProfileId;
    if (activeId == null) return;

    state = state.copyWith(isSearching: true, error: null);
    try {
      final results = await _messagingService.search(query, activeId);
      if (!mounted) return;
      state = state.copyWith(
        searchMessages: results['messages'] as List<Message>,
        searchConversations: results['conversations'] as List<Conversation>,
        isSearching: false,
      );
    } catch (e) {
      if (!mounted) return;
      state = state.copyWith(isSearching: false, error: e.toString());
    }
  }

  Future<void> togglePin(String conversationId, bool pin) async {
    try {
      await _messagingService.togglePin(conversationId, pin);
      if (!mounted) return;
      state = state.copyWith(
        conversations: state.conversations.map((c) {
          if (c.id == conversationId) return c.copyWith(isPinned: pin);
          return c;
        }).toList()
          ..sort((a, b) => b.isPinned ? 1 : (a.isPinned ? -1 : 0)), // Simple re-sort
      );
    } catch (e) {
      state = state.copyWith(error: e.toString());
    }
  }

  Future<void> toggleArchive(String conversationId, bool archive) async {
    try {
      await _messagingService.toggleArchive(conversationId, archive);
      if (!mounted) return;
      if (archive) {
        state = state.copyWith(
          conversations: state.conversations.where((c) => c.id != conversationId).toList(),
        );
      } else {
        // Reload conversations if unarchiving (or handle locally if we have the data)
        loadConversations();
      }
    } catch (e) {
      state = state.copyWith(error: e.toString());
    }
  }

  Future<void> toggleMute(String conversationId, bool mute) async {
    try {
      await _messagingService.toggleMute(conversationId, mute);
      if (!mounted) return;
      state = state.copyWith(
        conversations: state.conversations.map((c) {
          if (c.id == conversationId) return c.copyWith(isMuted: mute);
          return c;
        }).toList(),
      );
    } catch (e) {
      state = state.copyWith(error: e.toString());
    }
  }

  Future<void> unsendMessage(String conversationId, String messageId) async {
    try {
      await _messagingService.unsendMessage(messageId);
      if (!mounted) return;
      
      final updatedMessages = state.messagesByConversation[conversationId]?.map((m) {
        if (m.id == messageId) return m.copyWith(isUnsended: true);
        return m;
      }).toList();

      if (updatedMessages != null) {
        state = state.copyWith(
          messagesByConversation: {
            ...state.messagesByConversation,
            conversationId: updatedMessages,
          },
        );
      }
    } catch (e) {
      state = state.copyWith(error: e.toString());
    }
  }

  Future<void> reactToMessage(String conversationId, String messageId, String emoji) async {
    try {
      final reactions = await _messagingService.reactToMessage(messageId, emoji);
      if (!mounted) return;

      final updatedMessages = state.messagesByConversation[conversationId]?.map((m) {
        if (m.id == messageId) return m.copyWith(reactions: reactions);
        return m;
      }).toList();

      if (updatedMessages != null) {
        state = state.copyWith(
          messagesByConversation: {
            ...state.messagesByConversation,
            conversationId: updatedMessages,
          },
        );
      }
    } catch (e) {
      state = state.copyWith(error: e.toString());
    }
  }

  void markVoiceMessagePlayed(String conversationId, String messageId) {
    final auth = ref.read(authStateProvider);
    final activeId = auth.activeProfileId;
    if (activeId == null) return;

    final updatedMessages = state.messagesByConversation[conversationId]?.map((message) {
      if (message.id != messageId) return message;
      return message.copyWith(isRead: true, status: 'played');
    }).toList();

    if (updatedMessages != null) {
      state = state.copyWith(
        messagesByConversation: {
          ...state.messagesByConversation,
          conversationId: updatedMessages,
        },
      );
    }

    _socket?.emit('dm:played', {
      'message_id': messageId,
      'player_profile_id': activeId,
    });
  }

  void clearError() {
    state = state.copyWith(error: null);
  }

  Future<void> deleteMessage(String conversationId, String messageId) async {
    try {
      await _messagingService.deleteMessage(messageId);
      if (!mounted) return;
      
      final updatedMessages = state.messagesByConversation[conversationId]
          ?.where((m) => m.id != messageId)
          .toList();

      if (updatedMessages != null) {
        state = state.copyWith(
          messagesByConversation: {
            ...state.messagesByConversation,
            conversationId: updatedMessages,
          },
        );
      }
    } catch (e) {
      state = state.copyWith(error: e.toString());
    }
  }

  Future<void> deleteConversation(String conversationId) async {
    try {
      await _messagingService.deleteConversation(conversationId);
      if (!mounted) return;
      
      state = state.copyWith(
        conversations: state.conversations.where((c) => c.id != conversationId).toList(),
        messagesByConversation: {
          ...state.messagesByConversation,
        }..remove(conversationId),
      );
    } catch (e) {
      state = state.copyWith(error: e.toString());
    }
  }

  Future<void> forwardMessages(List<Message> messages, List<Conversation> targets) async {
    for (final target in targets) {
      for (final msg in messages) {
        await sendMessage(
          target,
          msg.content,
          mediaUrl: msg.mediaUrl,
          mediaType: msg.mediaType,
          isForwarded: true,
        );
      }
    }
  }

}

final messagingServiceProvider =
    Provider<MessagingService>((ref) => MessagingService(ref.watch(authServiceProvider)));

final messagingProvider =
    StateNotifierProvider<MessagingNotifier, MessagingState>((ref) {
  final notifier = MessagingNotifier(
    ref,
    ref.watch(authServiceProvider),
    ref.watch(messagingServiceProvider),
  );
  
  // Listen for profile changes and reload conversations
  ref.listen(authStateProvider.select((s) => s.activeProfileId), (prev, next) {
    if (next != null) {
      notifier.loadConversations();
    }
  });

  return notifier;
});
