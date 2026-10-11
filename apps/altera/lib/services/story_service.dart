import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/app_config.dart';
import '../models/story_model.dart';
import 'auth_service.dart';

class StoryService {
  static final String _baseUrl = AppConfig.baseUrl;
  final AuthService _authService = AuthService();

  Future<Map<String, String>> _authHeaders() async {
    final token = await _authService.getToken();
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  Future<List<StoryGroup>> getStories() async {
    try {
      final res = await http.get(
        Uri.parse('$_baseUrl/stories'),
        headers: await _authHeaders(),
      );
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        return (data['story_groups'] as List)
            .map((g) => StoryGroup.fromJson(g))
            .toList();
      }
      return [];
    } catch (e) {
      print('Error fetching stories: $e');
      return [];
    }
  }

  Future<bool> uploadStory({
    String? mediaUrl,
    String mediaType = 'image',
    String? textContent,
    String? backgroundColor,
  }) async {
    try {
      final res = await http.post(
        Uri.parse('$_baseUrl/stories'),
        headers: await _authHeaders(),
        body: jsonEncode({
          'media_url': mediaUrl,
          'media_type': mediaType,
          'text_content': textContent,
          'background_color': backgroundColor,
        }),
      );
      return res.statusCode == 201;
    } catch (e) {
      print('Error uploading story: $e');
      return false;
    }
  }

  Future<void> markStoryViewed(String storyId) async {
    try {
      await http.post(
        Uri.parse('$_baseUrl/stories/$storyId/view'),
        headers: await _authHeaders(),
      );
    } catch (e) {
      print('Error marking story viewed: $e');
    }
  }

  Future<List<StoryViewer>> getStoryViewers(String storyId) async {
    try {
      final res = await http.get(
        Uri.parse('$_baseUrl/stories/$storyId/viewers'),
        headers: await _authHeaders(),
      );
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        return (data['viewers'] as List)
            .map((v) => StoryViewer.fromJson(v))
            .toList();
      }
      return [];
    } catch (e) {
      print('Error fetching story viewers: $e');
      return [];
    }
  }
}
