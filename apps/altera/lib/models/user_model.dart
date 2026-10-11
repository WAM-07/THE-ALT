class UserModel {
  final String id;
  final String email;
  final String? walletAddress;
  final String? auth0Id;
  final DateTime createdAt;
  HumanProfile? humanProfile;
  List<AIProfile> aiProfiles;

  UserModel({
    required this.id,
    required this.email,
    this.walletAddress,
    this.auth0Id,
    required this.createdAt,
    this.humanProfile,
    this.aiProfiles = const [],
  });

  factory UserModel.fromJson(Map<String, dynamic> json) => UserModel(
        id: json['id'],
        email: json['email'],
        walletAddress: json['wallet_address'],
        auth0Id: json['auth0_id'],
        createdAt: json['created_at'] != null 
            ? DateTime.tryParse(json['created_at'].toString()) ?? DateTime.now()
            : DateTime.now(),
        humanProfile: json['human_profile'] != null
            ? HumanProfile.fromJson(json['human_profile'])
            : null,
        aiProfiles: (json['ai_profiles'] as List<dynamic>?)
                ?.map((p) => AIProfile.fromJson(p))
                .toList() ??
            [],
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'email': email,
        'wallet_address': walletAddress,
        'auth0_id': auth0Id,
        'created_at': createdAt.toIso8601String(),
      };

  UserModel copyWith({
    String? id,
    String? email,
    String? walletAddress,
    String? auth0Id,
    DateTime? createdAt,
    HumanProfile? humanProfile,
    List<AIProfile>? aiProfiles,
  }) =>
      UserModel(
        id: id ?? this.id,
        email: email ?? this.email,
        walletAddress: walletAddress ?? this.walletAddress,
        auth0Id: auth0Id ?? this.auth0Id,
        createdAt: createdAt ?? this.createdAt,
        humanProfile: humanProfile ?? this.humanProfile,
        aiProfiles: aiProfiles ?? this.aiProfiles,
      );
}

class HumanProfile {
  final String id;
  final String userId;
  final String username;
  final String displayName;
  final String? avatar;
  final String? bio;
  final int followerCount;
  final int followingCount;
  final int postCount;
  final double healthScore;

  const HumanProfile({
    required this.id,
    required this.userId,
    required this.username,
    required this.displayName,
    this.avatar,
    this.bio,
    this.followerCount = 0,
    this.followingCount = 0,
    this.postCount = 0,
    this.healthScore = 100.0,
  });

  factory HumanProfile.fromJson(Map<String, dynamic> json) => HumanProfile(
        id: json['id'],
        userId: json['user_id'],
        username: json['username'],
        displayName: json['display_name'],
        avatar: json['avatar'],
        bio: json['bio'],
        followerCount: json['follower_count'] ?? 0,
        followingCount: json['following_count'] ?? 0,
        postCount: json['post_count'] ?? 0,
        healthScore: json['health_score'] != null
            ? (json['health_score'] is num
                ? (json['health_score'] as num).toDouble()
                : double.tryParse(json['health_score'].toString()) ?? 100.0)
            : 100.0,
      );

  HumanProfile copyWith({
    String? displayName,
    String? avatar,
    String? bio,
    int? followerCount,
    int? followingCount,
    int? postCount,
    double? healthScore,
  }) =>
      HumanProfile(
        id: id,
        userId: userId,
        username: username,
        displayName: displayName ?? this.displayName,
        avatar: avatar ?? this.avatar,
        bio: bio ?? this.bio,
        followerCount: followerCount ?? this.followerCount,
        followingCount: followingCount ?? this.followingCount,
        postCount: postCount ?? this.postCount,
        healthScore: healthScore ?? this.healthScore,
      );
}

class AIProfile {
  final String id;
  final String userId;
  final String username;
  final String displayName;
  final String? avatar;
  final String? bio;
  final String? aitTokenId;
  final String? category;
  final String? modelIdentity;
  final List<String> personalityTraits;
  final bool isVerified;
  final double healthScore;
  final int followerCount;
  final int followingCount;
  final int postCount;
  final bool autonomyEnabled;
  final int dailyPostLimit;

  const AIProfile({
    required this.id,
    required this.userId,
    required this.username,
    required this.displayName,
    this.avatar,
    this.bio,
    this.aitTokenId,
    this.category,
    this.modelIdentity,
    this.personalityTraits = const [],
    this.isVerified = false,
    this.healthScore = 100.0,
    this.followerCount = 0,
    this.followingCount = 0,
    this.postCount = 0,
    this.autonomyEnabled = false,
    this.dailyPostLimit = 20,
  });

  factory AIProfile.fromJson(Map<String, dynamic> json) => AIProfile(
        id: json['id'],
        userId: json['user_id'],
        username: json['username'],
        displayName: json['display_name'],
        avatar: json['avatar'],
        bio: json['bio'],
        aitTokenId: json['ait_token_id'],
        category: json['category'],
        modelIdentity: json['model_identity'],
        personalityTraits:
            (json['personality_traits'] as List<dynamic>?)
                ?.map((trait) => trait.toString())
                .toList() ??
            const [],
        isVerified: json['is_verified'] ?? false,
        healthScore: json['health_score'] != null
            ? (json['health_score'] is num
                ? (json['health_score'] as num).toDouble()
                : double.tryParse(json['health_score'].toString()) ?? 100.0)
            : 100.0,
        followerCount: json['follower_count'] ?? 0,
        followingCount: json['following_count'] ?? 0,
        postCount: json['post_count'] ?? 0,
        autonomyEnabled: json['autonomy_enabled'] ?? false,
        dailyPostLimit: json['daily_post_limit'] ?? 20,
      );

  String get resolvedCategory {
    if (category != null && category!.trim().isNotEmpty) {
      return category!.trim().toLowerCase();
    }
    return 'general';
  }

  String get resolvedModelIdentity {
    if (modelIdentity != null && modelIdentity!.trim().isNotEmpty) {
      return modelIdentity!.trim();
    }

    switch (resolvedCategory) {
      case 'companion':
        return 'ALTERA Companion Core';
      case 'creative':
        return 'ALTERA Creative Core';
      case 'technical':
        return 'ALTERA Technical Core';
      default:
        return 'ALTERA Social Core';
    }
  }

  List<String> get resolvedPersonalityTraits {
    if (personalityTraits.isNotEmpty) {
      return personalityTraits;
    }

    final traits = <String>[];
    switch (resolvedCategory) {
      case 'companion':
        traits.addAll(['Empathetic', 'Conversational']);
        break;
      case 'creative':
        traits.addAll(['Creative', 'Expressive']);
        break;
      case 'technical':
        traits.addAll(['Analytical', 'Strategic']);
        break;
      default:
        traits.addAll(['Adaptive', 'Social']);
        break;
    }

    if (healthScore >= 95) {
      traits.add('High-Trust');
    }
    if (autonomyEnabled) {
      traits.add('Autonomous');
    } else {
      traits.add('Human-Guided');
    }
    if (isVerified) {
      traits.add('AIT-Verified');
    }

    return traits;
  }

  AIProfile copyWith({
    String? displayName,
    String? avatar,
    String? bio,
    String? category,
    String? modelIdentity,
    List<String>? personalityTraits,
    bool? isVerified,
    double? healthScore,
    int? followerCount,
    int? followingCount,
    int? postCount,
    bool? autonomyEnabled,
    int? dailyPostLimit,
  }) =>
      AIProfile(
        id: id,
        userId: userId,
        username: username,
        displayName: displayName ?? this.displayName,
        avatar: avatar ?? this.avatar,
        bio: bio ?? this.bio,
        aitTokenId: aitTokenId,
        category: category ?? this.category,
        modelIdentity: modelIdentity ?? this.modelIdentity,
        personalityTraits: personalityTraits ?? this.personalityTraits,
        isVerified: isVerified ?? this.isVerified,
        healthScore: healthScore ?? this.healthScore,
        followerCount: followerCount ?? this.followerCount,
        followingCount: followingCount ?? this.followingCount,
        postCount: postCount ?? this.postCount,
        autonomyEnabled: autonomyEnabled ?? this.autonomyEnabled,
        dailyPostLimit: dailyPostLimit ?? this.dailyPostLimit,
      );
}
