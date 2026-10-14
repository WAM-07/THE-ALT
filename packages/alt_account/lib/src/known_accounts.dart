import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'client.dart';
import 'models.dart';

/// An ALT account used on this device before, shown in the sign-in card like Google's account
/// chooser. Only what the card displays is kept: never a password or a token.
class AltKnownAccount {
  const AltKnownAccount({required this.id, required this.handle, required this.displayName, this.email, this.avatarUrl});

  factory AltKnownAccount.fromJson(Map<String, dynamic> j) => AltKnownAccount(
        id: j['id'] as String,
        handle: j['handle'] as String,
        displayName: j['displayName'] as String,
        email: j['email'] as String?,
        avatarUrl: j['avatarUrl'] as String?,
      );

  final String id;
  final String handle;
  final String displayName;
  final String? email;
  final String? avatarUrl;

  /// What to sign in with: the email when known, otherwise the handle.
  String get identifier => email ?? handle;

  Map<String, dynamic> toJson() => {'id': id, 'handle': handle, 'displayName': displayName, 'email': email, 'avatarUrl': avatarUrl};
}

/// The accounts used in this app on this device (most recent first, at most five).
class AltKnownAccounts {
  AltKnownAccounts({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage(aOptions: AndroidOptions(encryptedSharedPreferences: true));

  static final AltKnownAccounts instance = AltKnownAccounts();
  static const _key = 'alt.known_accounts';
  static const _max = 5;

  final FlutterSecureStorage _storage;

  Future<List<AltKnownAccount>> list() async {
    try {
      final raw = await _storage.read(key: _key);
      if (raw == null) return [];
      return (jsonDecode(raw) as List).map((e) => AltKnownAccount.fromJson(Map<String, dynamic>.from(e as Map))).toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> remember(AltUser user) async {
    final entry = AltKnownAccount(id: user.id, handle: user.handle, displayName: user.displayName, email: user.email, avatarUrl: user.avatarUrl);
    final rest = (await list()).where((a) => a.id != user.id);
    await _write([entry, ...rest].take(_max).toList());
  }

  Future<void> forget(String id) async => _write((await list()).where((a) => a.id != id).toList());

  Future<void> _write(List<AltKnownAccount> accounts) async {
    try {
      await _storage.write(key: _key, value: jsonEncode(accounts.map((a) => a.toJson()).toList()));
    } catch (_) {
      // Remembering accounts is a convenience; signing in works without it.
    }
  }

  /// Remembers whoever signs in to [client], whichever way they did (the card, a handoff link…).
  void track(AltAccountClient client) {
    client.currentUser.addListener(() {
      final user = client.currentUser.value;
      if (user != null) remember(user);
    });
  }
}
