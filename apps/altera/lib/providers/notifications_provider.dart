import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import '../config/app_config.dart';
import '../models/notification_model.dart';
import 'auth_provider.dart';
import '../services/auth_service.dart';
import '../services/notifications_service.dart';

class NotificationsState {
  final List<NotificationModel> notifications;
  final int unreadCount;
  final bool isLoading;
  final String? error;

  NotificationsState({
    this.notifications = const [],
    this.unreadCount = 0,
    this.isLoading = false,
    this.error,
  });

  NotificationsState copyWith({
    List<NotificationModel>? notifications,
    int? unreadCount,
    bool? isLoading,
    String? error,
  }) {
    return NotificationsState(
      notifications: notifications ?? this.notifications,
      unreadCount: unreadCount ?? this.unreadCount,
      isLoading: isLoading ?? this.isLoading,
      error: error,
    );
  }
}

class NotificationsNotifier extends StateNotifier<NotificationsState> {
  final NotificationsService _service;
  final AuthService _authService;
  final Ref _ref;
  io.Socket? _socket;

  NotificationsNotifier(this._service, this._authService, this._ref)
      : super(NotificationsState()) {
    _initSocket();
    // No need to call loadNotifications here, we will do it via listener or in the UI
  }

  io.Socket? get socket => _socket;

  void subscribeToPost(String postId) {
    _socket?.emit('subscribe:post', postId);
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
    _socket?.on('connect', (_) {
      _socket?.emit('subscribe:notifications');
    });
    _socket?.on('notification:new', (data) {
      if (data is! Map) return;
      final notification =
          NotificationModel.fromJson(Map<String, dynamic>.from(data as Map));
      final exists = state.notifications.any((item) => item.id == notification.id);
      if (exists) return;

      state = state.copyWith(
        notifications: [notification, ...state.notifications],
        unreadCount: (state.unreadCount + 1).clamp(0, 999),
      );
    });
  }

  Future<void> loadNotifications({String? profileId}) async {
    state = state.copyWith(isLoading: true, error: null);
    try {
      final result = await _service.getNotifications(profileId: profileId);
      state = state.copyWith(
        notifications: result.notifications,
        unreadCount: result.unreadCount,
        isLoading: false,
      );
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
    }
  }

  Future<void> markRead(String id) async {
    final success = await _service.markRead(id);
    if (success) {
      final target = state.notifications.cast<NotificationModel?>().firstWhere(
            (n) => n?.id == id,
            orElse: () => null,
          );
      final shouldDecrease = target != null && !target.isRead;
      state = state.copyWith(
        notifications: state.notifications.map((n) {
          if (n.id == id) return n.copyWith(isRead: true);
          return n;
        }).toList(),
        unreadCount: shouldDecrease
            ? (state.unreadCount - 1).clamp(0, 999)
            : state.unreadCount,
      );
    }
  }

  Future<void> markAllRead() async {
    final success = await _service.markAllRead();
    if (success) {
      state = state.copyWith(
        notifications: state.notifications.map((n) => n.copyWith(isRead: true)).toList(),
        unreadCount: 0,
      );
    }
  }

  @override
  void dispose() {
    _socket?.disconnect();
    _socket?.dispose();
    super.dispose();
  }
}

final notificationsServiceProvider =
    Provider((ref) => NotificationsService());

final notificationsProvider =
    StateNotifierProvider<NotificationsNotifier, NotificationsState>((ref) {
  final notifier = NotificationsNotifier(
    ref.watch(notificationsServiceProvider),
    ref.watch(authServiceProvider),
    ref,
  );
  
  // Reload when active profile changes
  ref.listen(authStateProvider.select((s) => s.activeProfileId), (prev, next) {
    notifier.loadNotifications(profileId: next);
  });

  // Initial load
  final activeProfileId = ref.read(authStateProvider).activeProfileId;
  notifier.loadNotifications(profileId: activeProfileId);

  return notifier;
});
