import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:local_auth/local_auth.dart';

import '../client.dart';
import 'continue_with_alt.dart';

/// Biometric unlock for an ALT app on this phone: when it is on, the app asks for a fingerprint or
/// face (or the phone's PIN) when it opens and when you come back after a while away. It guards
/// the app on this device only; the ALT session itself is unchanged.
class AltAppLock {
  AltAppLock._();

  static const _storage = FlutterSecureStorage(aOptions: AndroidOptions(encryptedSharedPreferences: true));
  static final LocalAuthentication _auth = LocalAuthentication();
  static String _key(AltAccountClient client) => 'alt.app_lock.${client.platform.name}';

  /// Whether this phone can check a fingerprint, face or device PIN (never on the web).
  static Future<bool> available() async {
    if (kIsWeb) return false;
    try {
      return await _auth.isDeviceSupported();
    } catch (_) {
      return false;
    }
  }

  static Future<bool> isOn(AltAccountClient client) async {
    try {
      return await _storage.read(key: _key(client)) == 'on';
    } catch (_) {
      return false;
    }
  }

  /// Turning it on needs one successful check, so nobody locks themselves out by mistake.
  static Future<bool> setOn(AltAccountClient client, bool on) async {
    if (on && !await authenticate(client)) return false;
    await _storage.write(key: _key(client), value: on ? 'on' : 'off');
    return true;
  }

  static Future<bool> authenticate(AltAccountClient client) async {
    try {
      return await _auth.authenticate(
        localizedReason: 'Unlock ${client.platform.label}',
        options: const AuthenticationOptions(stickyAuth: true),
      );
    } catch (_) {
      return false;
    }
  }
}

/// Wraps the app (MaterialApp `builder`) and covers it with a lock screen while it is locked.
class AltAppLockGate extends StatefulWidget {
  const AltAppLockGate({super.key, required this.client, required this.child, this.relockAfter = const Duration(seconds: 30)});

  final AltAccountClient client;
  final Widget child;

  /// Coming back sooner than this does not ask again.
  final Duration relockAfter;

  @override
  State<AltAppLockGate> createState() => _AltAppLockGateState();
}

class _AltAppLockGateState extends State<AltAppLockGate> with WidgetsBindingObserver {
  bool _locked = false;
  bool _checking = false;
  DateTime? _leftAt;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _lockIfOn();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden) {
      // The fingerprint prompt itself pauses the app; don't count that as leaving.
      if (!_checking) _leftAt ??= DateTime.now();
    } else if (state == AppLifecycleState.resumed) {
      final away = _leftAt == null ? Duration.zero : DateTime.now().difference(_leftAt!);
      _leftAt = null;
      if (away >= widget.relockAfter) _lockIfOn();
    }
  }

  Future<void> _lockIfOn() async {
    if (!await AltAppLock.isOn(widget.client) || !mounted) return;
    setState(() => _locked = true);
    _unlock();
  }

  Future<void> _unlock() async {
    if (_checking) return;
    _checking = true;
    final ok = await AltAppLock.authenticate(widget.client);
    _checking = false;
    if (ok && mounted) setState(() => _locked = false);
  }

  @override
  Widget build(BuildContext context) {
    return Stack(children: [
      widget.child,
      if (_locked)
        Positioned.fill(
          child: Material(
            color: const Color(0xFF141519),
            child: SafeArea(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(32),
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    const AltMark(height: 26, ink: Color(0xFFF4F3EF)),
                    const SizedBox(height: 22),
                    Text('${widget.client.platform.label} is locked',
                        style: const TextStyle(color: Color(0xFFF4F3EF), fontSize: 22, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 8),
                    const Text('Use your fingerprint, face or phone PIN to continue.', textAlign: TextAlign.center, style: TextStyle(color: Color(0xFFA3A3AD))),
                    const SizedBox(height: 26),
                    FilledButton.icon(
                      onPressed: _unlock,
                      icon: const Icon(Icons.fingerprint_rounded),
                      label: const Text('Unlock'),
                      style: FilledButton.styleFrom(backgroundColor: const Color(0xFFF4F3EF), foregroundColor: const Color(0xFF141519), minimumSize: const Size(200, 50)),
                    ),
                  ]),
                ),
              ),
            ),
          ),
        ),
    ]);
  }
}
