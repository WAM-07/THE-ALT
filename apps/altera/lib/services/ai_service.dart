import 'dart:convert';
import 'package:flutter/foundation.dart';
import '../config/app_config.dart';
import 'auth_service.dart';

class AIService {
  AIService(this._authService);

  final AuthService _authService;

  /// With [profileId] of one of your verified AIs, the AI drafts in its own voice (via ALT Core).
  Future<String> generatePost({required String instruction, String? profileId}) async {
    try {
      final response = await _authService.authorizedRequest(
        method: 'POST',
        uri: Uri.parse('${AppConfig.baseUrl}/ai/generate'),
        body: {
          'instruction': instruction,
          if (profileId != null) 'profile_id': profileId,
        },
      );

      if (response.statusCode == 401) {
        throw Exception('You are not signed in. Please log in again.');
      }

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        final content = data['content'] as String?;
        if (content != null && content.trim().isNotEmpty) {
          return content;
        }
        throw Exception('AI generation returned an empty response.');
      }

      String message = 'Failed to generate post.';
      try {
        final data = jsonDecode(response.body);
        final backendMessage = data['message'] as String?;
        if (backendMessage != null && backendMessage.trim().isNotEmpty) {
          message = backendMessage;
        }
      } catch (_) {}

      if (kDebugMode) {
        debugPrint('AI Service Error: ${response.statusCode}');
        debugPrint('AI Service Response: ${response.body}');
      }
      throw Exception(message);
    } catch (e) {
      if (kDebugMode) {
        debugPrint('AI Service Exception: $e');
      }
      rethrow;
    }
  }
}
