import 'dart:async';
import 'dart:convert';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'client.dart';

/// Push notifications for an ALT app: the ALT inbox reaches the phone while the app is closed
/// (Firebase Cloud Messaging). It only switches on when the app was built with its Firebase
/// project's `google-services.json`; otherwise [start] returns false and the app works as before,
/// with the live inbox while it is open.
class AltPush {
  AltPush(this.client);

  final AltAccountClient client;
  String? _token;
  String? _registeredFor;
  bool _started = false;

  /// True once Firebase is set up and the phone can receive pushes.
  bool get active => _token != null;

  /// Starts push and keeps this phone registered with ALT Core for whoever is signed in.
  /// [onOpen] runs with the notification's link when someone taps a push.
  Future<bool> start({void Function(String? link)? onOpen}) async {
    if (_started || kIsWeb) return active;
    _started = true;
    try {
      await Firebase.initializeApp();
    } catch (e) {
      debugPrint('push off: no Firebase project in this build ($e)');
      return false;
    }
    final messaging = FirebaseMessaging.instance;
    try {
      // Android 13+ asks the person once; on older phones this is a no-op.
      await messaging.requestPermission();
      _token = await messaging.getToken();
    } catch (e) {
      debugPrint('push off: $e');
      return false;
    }
    messaging.onTokenRefresh.listen((t) {
      _token = t;
      _registeredFor = null;
      unawaited(_sync());
    });
    client.currentUser.addListener(() => unawaited(_sync()));
    FirebaseMessaging.onMessageOpenedApp.listen((m) => onOpen?.call(m.data['link'] as String?));
    final first = await messaging.getInitialMessage();
    if (first != null) onOpen?.call(first.data['link'] as String?);
    await _sync();
    return true;
  }

  /// Registers the phone for the signed-in person, or stops its pushes after sign-out.
  Future<void> _sync() async {
    final token = _token;
    if (token == null) return;
    final user = client.currentUser.value;
    try {
      if (user != null && _registeredFor != user.id) {
        final res = await client.authorizedSend('PUT', Uri.parse('${client.coreUrl}/me/push-devices'), body: {'token': token, 'platform': client.platform.name});
        if (res.statusCode < 300) _registeredFor = user.id;
      } else if (user == null && _registeredFor != null) {
        // Signed out: no session any more, so the phone's own token says "forget me".
        await http.post(Uri.parse('${client.coreUrl}/push-devices/forget'), headers: {'content-type': 'application/json'}, body: jsonEncode({'token': token}));
        _registeredFor = null;
      }
    } catch (e) {
      debugPrint('push registration failed: $e');
    }
  }
}
