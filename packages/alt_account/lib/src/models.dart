/// The ALT apps. Each sign-in session belongs to one of them.
enum AltPlatform {
  alter,
  altera,
  altar,
  admin;

  String get label => switch (this) {
        AltPlatform.alter => 'ALTER',
        AltPlatform.altera => 'ALTERA',
        AltPlatform.altar => 'ALTAR',
        AltPlatform.admin => 'Admin',
      };

  String get tagline => switch (this) {
        AltPlatform.alter => 'Create and train your personal AI',
        AltPlatform.altera => 'The social hub for people and verified AIs',
        AltPlatform.altar => 'Buy, rent and license AIs',
        AltPlatform.admin => 'Governance',
      };

  static AltPlatform parse(String value) =>
      AltPlatform.values.firstWhere((p) => p.name == value, orElse: () => AltPlatform.alter);
}

class AltWallet {
  const AltWallet({required this.address, required this.kind, required this.isPrimary, this.label});

  final String address;

  /// `custodial` (created and kept safe by ALT) or `external` (linked, e.g. MetaMask).
  final String kind;
  final bool isPrimary;
  final String? label;

  bool get isCustodial => kind == 'custodial';
  String get short => address.length > 12 ? '${address.substring(0, 6)}…${address.substring(address.length - 4)}' : address;

  factory AltWallet.fromJson(Map<String, dynamic> j) => AltWallet(
        address: j['address'] as String,
        kind: j['kind'] as String,
        isPrimary: j['isPrimary'] as bool? ?? false,
        label: j['label'] as String?,
      );
}

class AltPlatformMembership {
  const AltPlatformMembership({required this.platform, required this.joinedAt, required this.lastSeenAt});

  final AltPlatform platform;
  final DateTime joinedAt;
  final DateTime lastSeenAt;

  factory AltPlatformMembership.fromJson(Map<String, dynamic> j) => AltPlatformMembership(
        platform: AltPlatform.parse(j['platform'] as String),
        joinedAt: DateTime.parse(j['joinedAt'] as String),
        lastSeenAt: DateTime.parse(j['lastSeenAt'] as String),
      );
}

/// The signed-in person's ALT account, shared by every ALT app.
class AltUser {
  const AltUser({
    required this.id,
    required this.handle,
    required this.displayName,
    required this.roles,
    required this.emailVerified,
    required this.twoFactorEnabled,
    required this.hasPassword,
    required this.wallets,
    required this.platforms,
    required this.createdAt,
    this.email,
    this.bio,
    this.avatarUrl,
  });

  final String id;
  final String handle;
  final String displayName;
  final String? email;
  final String? bio;
  final String? avatarUrl;
  final List<String> roles;
  final bool emailVerified;
  final bool twoFactorEnabled;
  final bool hasPassword;
  final List<AltWallet> wallets;
  final List<AltPlatformMembership> platforms;
  final DateTime createdAt;

  AltWallet? get primaryWallet => wallets.where((w) => w.isPrimary).firstOrNull;
  bool get isAdmin => roles.contains('admin');
  bool hasUsed(AltPlatform p) => platforms.any((m) => m.platform == p);

  factory AltUser.fromJson(Map<String, dynamic> j) => AltUser(
        id: j['id'] as String,
        handle: j['handle'] as String,
        displayName: j['displayName'] as String,
        email: j['email'] as String?,
        bio: j['bio'] as String?,
        avatarUrl: j['avatarUrl'] as String?,
        roles: (j['roles'] as List? ?? const []).cast<String>(),
        emailVerified: j['emailVerified'] as bool? ?? false,
        twoFactorEnabled: j['twoFactorEnabled'] as bool? ?? false,
        hasPassword: j['hasPassword'] as bool? ?? true,
        wallets: (j['wallets'] as List? ?? const []).map((w) => AltWallet.fromJson(Map<String, dynamic>.from(w as Map))).toList(),
        platforms: (j['platforms'] as List? ?? const [])
            .map((p) => AltPlatformMembership.fromJson(Map<String, dynamic>.from(p as Map)))
            .toList(),
        createdAt: DateTime.parse(j['createdAt'] as String),
      );
}

/// A device or app signed in to the account.
class AltSession {
  const AltSession({
    required this.id,
    required this.platform,
    required this.createdAt,
    required this.lastUsedAt,
    required this.current,
    this.deviceName,
    this.userAgent,
    this.ip,
  });

  final String id;
  final AltPlatform platform;
  final String? deviceName;
  final String? userAgent;
  final String? ip;
  final DateTime createdAt;
  final DateTime lastUsedAt;
  final bool current;

  factory AltSession.fromJson(Map<String, dynamic> j) => AltSession(
        id: j['id'] as String,
        platform: AltPlatform.parse(j['platform'] as String),
        deviceName: j['deviceName'] as String?,
        userAgent: j['userAgent'] as String?,
        ip: j['ip'] as String?,
        createdAt: DateTime.parse(j['createdAt'] as String),
        lastUsedAt: DateTime.parse(j['lastUsedAt'] as String),
        current: j['current'] as bool? ?? false,
      );
}

/// What happened when someone tried to sign in.
sealed class SignInResult {
  const SignInResult();
}

class SignedIn extends SignInResult {
  const SignedIn(this.user);
  final AltUser user;
}

/// Password was right; now ask for the authenticator code (or a recovery code).
class TwoFactorRequired extends SignInResult {
  const TwoFactorRequired(this.mfaToken);
  final String mfaToken;
}

/// The account exists but the email was never confirmed. A fresh code has been sent.
class EmailNotVerified extends SignInResult {
  const EmailNotVerified(this.email);
  final String email;
}

class TwoFactorSetup {
  const TwoFactorSetup({required this.secret, required this.otpauthUrl});
  final String secret;
  final String otpauthUrl;
}
