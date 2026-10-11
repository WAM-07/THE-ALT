import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import '../config/app_config.dart';
import 'auth_service.dart';

class ImageService {
  static final String _baseUrl = AppConfig.baseUrl;
  final AuthService _auth = AuthService();

  Future<Map<String, String>> _headers() async {
    final token = await _auth.getToken();
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  /// Upload an image file and return the base64 encoded string
  Future<String?> uploadImage(XFile imageFile) async {
    try {
      // Read the file and convert to bytes
      final bytes = await imageFile.readAsBytes();

      // Convert to base64
      final base64String = base64Encode(bytes);

      // Return with data URI scheme
      return 'data:image/jpeg;base64,$base64String';
    } catch (e) {
      if (kDebugMode) {
        debugPrint('Error uploading image: $e');
      }
      return null;
    }
  }

  /// Upload image and update profile, returning the stored avatar URL on success.
  Future<String?> updateProfilePicture(
      XFile imageFile, String profileId) async {
    try {
      final base64Image = await uploadImage(imageFile);
      if (base64Image == null) return null;

      final res = await http.put(
        Uri.parse('$_baseUrl/auth/profile'),
        headers: await _headers(),
        body: jsonEncode({
          'profile_id': profileId,
          'avatar': base64Image,
        }),
      );

      if (res.statusCode != 200) return null;

      final data = jsonDecode(res.body) as Map<String, dynamic>;
      return data['avatar_url'] as String?;
    } catch (e) {
      if (kDebugMode) {
        debugPrint('Error updating profile picture: $e');
      }
      return null;
    }
  }
}
