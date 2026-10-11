import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/app_config.dart';
import '../models/notification_model.dart';
import 'auth_service.dart';

class NotificationsResult {
  final List<NotificationModel> notifications;
  final int unreadCount;

  const NotificationsResult({
    required this.notifications,
    required this.unreadCount,
  });
}

class NotificationsService {
  static final String _baseUrl = AppConfig.baseUrl;
  final AuthService _authService = AuthService();

  Future<Map<String, String>> _headers() async {
    final token = await _authService.getToken();
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  Future<NotificationsResult> getNotifications({String? profileId}) async {
    final uri = Uri.parse('$_baseUrl/notifications').replace(
      queryParameters: {
        if (profileId != null) 'profile_id': profileId,
      },
    );
    final res = await http.get(
      uri,
      headers: await _headers(),
    );
    if (res.statusCode != 200) {
      throw Exception('Failed to load notifications');
    }

    final data = jsonDecode(res.body) as Map<String, dynamic>;
    final notifications = (data['notifications'] as List<dynamic>? ?? [])
        .map((item) => NotificationModel.fromJson(item as Map<String, dynamic>))
        .toList();

    return NotificationsResult(
      notifications: notifications,
      unreadCount: data['unread_count'] as int? ?? 0,
    );
  }

  Future<bool> markRead(String id) async {
    final res = await http.post(
      Uri.parse('$_baseUrl/notifications/$id/read'),
      headers: await _headers(),
    );
    return res.statusCode == 200;
  }

  Future<bool> markAllRead() async {
    final res = await http.post(
      Uri.parse('$_baseUrl/notifications/read-all'),
      headers: await _headers(),
    );
    return res.statusCode == 200;
  }
}
