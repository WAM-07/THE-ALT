import 'package:flutter/foundation.dart';
import 'dart:convert';
import '../config/app_config.dart';
import '../models/message_model.dart';
import 'feed_service.dart';
import 'auth_service.dart';

class MessagingService {
  MessagingService(this._authService);

  final String _baseUrl = AppConfig.baseUrl;
  final AuthService _authService;

  Future<List<Conversation>> getConversations(String activeProfileId) async {
    try {
      final res = await _authService.authorizedRequest(
        method: 'GET',
        uri: Uri.parse('$_baseUrl/messages/conversations?profile_id=$activeProfileId'),
      );

      if (res.statusCode != 200) {
        return [];
      }

      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final raw = data['conversations'] as List<dynamic>? ?? [];
      return raw
          .map((item) => Conversation.fromJson(item as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }

  Future<List<FollowProfile>> getShareTargets(String activeProfileId) async {
    try {
      final res = await _authService.authorizedRequest(
        method: 'GET',
        uri: Uri.parse('$_baseUrl/messages/share-targets?profile_id=$activeProfileId'),
      );

      if (res.statusCode != 200) {
        debugPrint('[MessagingService] getShareTargets failed: ${res.statusCode}');
        return [];
      }

      final data = jsonDecode(res.body);
      final targets = (data['targets'] as List)
          .map((p) => FollowProfile.fromJson(p))
          .toList();
      debugPrint('[MessagingService] getShareTargets success: ${targets.length} targets');
      return targets;
    } catch (e) {
      debugPrint('[MessagingService] getShareTargets error: $e');
      return [];
    }
  }

  Future<List<Message>> getConversationMessages(String conversationId) async {
    try {
      final res = await _authService.authorizedRequest(
        method: 'GET',
        uri: Uri.parse('$_baseUrl/messages/conversations/$conversationId'),
      );

      if (res.statusCode != 200) {
        return [];
      }

      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final raw = data['messages'] as List<dynamic>? ?? [];
      return raw
          .map((item) => Message.fromJson(item as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }

  Future<bool> markConversationRead(String conversationId) async {
    try {
      final res = await _authService.authorizedRequest(
        method: 'POST',
        uri: Uri.parse('$_baseUrl/messages/conversations/$conversationId/read'),
      );
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  Future<Map<String, dynamic>> search(String query, String activeProfileId) async {
    final res = await _authService.authorizedRequest(
      method: 'GET',
      uri: Uri.parse('$_baseUrl/messages/search?q=${Uri.encodeComponent(query)}&profile_id=$activeProfileId'),
    );

    if (res.statusCode != 200) throw Exception('Search failed');

    final data = jsonDecode(res.body) as Map<String, dynamic>;
    final messagesRaw = data['messages'] as List<dynamic>? ?? [];
    final conversationsRaw = data['conversations'] as List<dynamic>? ?? [];

    return {
      'messages': messagesRaw.map((m) => Message.fromJson(m as Map<String, dynamic>)).toList(),
      'conversations': conversationsRaw.map((c) => Conversation.fromJson(c as Map<String, dynamic>)).toList(),
    };
  }

  Future<void> togglePin(String conversationId, bool pin) async {
    final res = await _authService.authorizedRequest(
      method: 'POST',
      uri: Uri.parse('$_baseUrl/messages/conversations/$conversationId/pin'),
      body: {'pin': pin},
    );
    if (res.statusCode != 200) throw Exception('Failed to pin');
  }

  Future<void> toggleArchive(String conversationId, bool archive) async {
    final res = await _authService.authorizedRequest(
      method: 'POST',
      uri: Uri.parse('$_baseUrl/messages/conversations/$conversationId/archive'),
      body: {'archive': archive},
    );
    if (res.statusCode != 200) throw Exception('Failed to archive');
  }

  Future<void> toggleMute(String conversationId, bool mute) async {
    final res = await _authService.authorizedRequest(
      method: 'POST',
      uri: Uri.parse('$_baseUrl/messages/conversations/$conversationId/mute'),
      body: {'mute': mute},
    );
    if (res.statusCode != 200) throw Exception('Failed to mute');
  }

  Future<void> unsendMessage(String messageId) async {
    final res = await _authService.authorizedRequest(
      method: 'POST',
      uri: Uri.parse('$_baseUrl/messages/$messageId/unsend'),
    );
    if (res.statusCode != 200) throw Exception('Failed to unsend');
  }

  Future<List<MessageReaction>> reactToMessage(String messageId, String emoji) async {
    final res = await _authService.authorizedRequest(
      method: 'POST',
      uri: Uri.parse('$_baseUrl/messages/$messageId/react'),
      body: {'emoji': emoji},
    );
    if (res.statusCode != 200) throw Exception('Failed to react');

    final data = jsonDecode(res.body) as Map<String, dynamic>;
    final reactionsRaw = data['reactions'] as List<dynamic>? ?? [];
    return reactionsRaw.map((r) => MessageReaction.fromJson(r as Map<String, dynamic>)).toList();
  }

  Future<void> deleteMessage(String messageId) async {
    final res = await _authService.authorizedRequest(
      method: 'DELETE',
      uri: Uri.parse('$_baseUrl/messages/$messageId'),
    );
    if (res.statusCode != 200) throw Exception('Failed to delete message');
  }

  Future<void> deleteConversation(String conversationId) async {
    final res = await _authService.authorizedRequest(
      method: 'DELETE',
      uri: Uri.parse('$_baseUrl/messages/conversations/$conversationId'),
    );
    if (res.statusCode != 200) throw Exception('Failed to delete conversation');
  }
}
