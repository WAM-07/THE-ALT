import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import '../config/app_config.dart';
import '../theme/app_theme.dart';

class AvatarWidget extends StatelessWidget {
  final String? avatarUrl;
  final String displayName;
  final double radius;
  final bool isAI;
  final bool showGradient;
  final String? heroTag;

  const AvatarWidget({
    super.key,
    this.avatarUrl,
    required this.displayName,
    this.radius = 20,
    this.isAI = false,
    this.showGradient = true,
    this.heroTag,
  });

  static final Map<String, String> _aiLogos = {
    'chatgpt':
        'https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/ChatGPT_logo.svg/1024px-ChatGPT_logo.svg.png',
    'openai':
        'https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/ChatGPT_logo.svg/1024px-ChatGPT_logo.svg.png',
    'gemini':
        'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Google_Gemini_logo.svg/1200px-Google_Gemini_logo.svg.png',
    'google':
        'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Google_Gemini_logo.svg/1200px-Google_Gemini_logo.svg.png',
    'claude': 'https://avatars.githubusercontent.com/u/84102941?s=200&v=4',
    'anthropic': 'https://avatars.githubusercontent.com/u/84102941?s=200&v=4',
    'grok':
        'https://pbs.twimg.com/profile_images/1720610363539824640/6Yp2D-M3_400x400.jpg',
    'xai':
        'https://pbs.twimg.com/profile_images/1720610363539824640/6Yp2D-M3_400x400.jpg',
    'llama':
        'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Meta_Platforms_Inc._logo.svg/1024px-Meta_Platforms_Inc._logo.svg.png',
    'meta':
        'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Meta_Platforms_Inc._logo.svg/1024px-Meta_Platforms_Inc._logo.svg.png',
    'mistral': 'https://mistral.ai/images/logo_mistral_white.png',
  };

  String? _getLogoUrl() {
    if (avatarUrl != null && avatarUrl!.isNotEmpty) {
      return _resolveAvatarUrl(avatarUrl!);
    }
    if (!isAI) return null;

    final name = displayName.toLowerCase();
    for (var entry in _aiLogos.entries) {
      if (name.contains(entry.key)) return entry.value;
    }
    return null;
  }

  String _resolveAvatarUrl(String url) {
    if (url.startsWith('data:image') ||
        url.startsWith('http://') ||
        url.startsWith('https://')) {
      return url;
    }

    if (url.startsWith('/')) {
      return '${AppConfig.baseUrl}$url';
    }

    return '${AppConfig.baseUrl}/$url';
  }

  ImageProvider? _getImageProvider(String url) {
    // Check if it's a base64 encoded image
    if (url.startsWith('data:image')) {
      try {
        // Extract the base64 part
        final parts = url.split(',');
        if (parts.length == 2) {
          final base64String = parts[1];
          final bytes = base64Decode(base64String);
          return MemoryImage(bytes);
        }
      } catch (e) {
        if (kDebugMode) {
          debugPrint('Error decoding base64 image: $e');
        }
      }
    }
    // Otherwise, treat as a network image (links to ALT's own files are made reachable from this device)
    return NetworkImage(altMediaUrl(url, AppConfig.apiUrl));
  }

  @override
  Widget build(BuildContext context) {
    final effectiveUrl = _getLogoUrl();
    final imageProvider =
        effectiveUrl != null ? _getImageProvider(effectiveUrl) : null;

    final avatar = Container(
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: (isAI && showGradient)
            ? const LinearGradient(
                colors: AppColors.aiGradient,
                begin: Alignment.topRight,
                end: Alignment.bottomLeft,
              )
            : null,
      ),
      child: Padding(
        padding: EdgeInsets.all(isAI && showGradient ? 2.0 : 0.0),
        child: imageProvider != null
            ? CircleAvatar(
                radius: radius,
                backgroundColor: Colors.transparent,
                backgroundImage: imageProvider,
              )
            : isAI
                ? Container(
                    width: radius * 2,
                    height: radius * 2,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: LinearGradient(
                        colors: [
                          AppColors.badgeAI,
                          AppColors.primary,
                        ],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                    ),
                    child: Center(
                      child: Text(
                        displayName.isNotEmpty
                            ? displayName[0].toUpperCase()
                            : 'A',
                        style: TextStyle(
                          fontSize: radius * 0.85,
                          fontWeight: FontWeight.w800,
                          color: Colors.white,
                          letterSpacing: -0.5,
                        ),
                      ),
                    ),
                  )
                : CircleAvatar(
                    radius: radius,
                    backgroundColor: AppColors.primary.withOpacity(0.1),
                    child: Text(
                      displayName.isNotEmpty
                          ? displayName[0].toUpperCase()
                          : '?',
                      style: TextStyle(
                        fontSize: radius * 0.8,
                        fontWeight: FontWeight.bold,
                        color: AppColors.primary,
                      ),
                    ),
                  ),
      ),
    );

    if (heroTag != null) {
      return Hero(
        tag: heroTag!,
        child: Material(
          type: MaterialType.transparency,
          child: avatar,
        ),
      );
    }
    return avatar;
  }
}
