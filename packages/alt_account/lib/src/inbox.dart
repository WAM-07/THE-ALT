import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'client.dart';
import 'errors.dart';

/// One item in the person's ALT inbox (Module 2), the same in every ALT app.
class AltNotification {
  AltNotification(this.j);
  final Map<String, dynamic> j;

  String get id => j['id'] as String;
  String get category => j['category'] as String;
  String get type => j['type'] as String;
  String get title => j['title'] as String;
  String? get body => j['body'] as String?;
  String get platform => j['platform'] as String;
  String? get link => j['link'] as String?;
  bool get read => j['read'] == true;
  DateTime get createdAt => DateTime.parse(j['createdAt'] as String);

  AltNotification markedRead() => AltNotification({...j, 'read': true});
}

/// Keeps the unread count live and delivers new notifications as they happen.
/// Uses ALT Core's Server-Sent Events stream on mobile and desktop, and polling on the web
/// (browsers' HTTP client buffers streamed responses).
class AltInbox {
  AltInbox(this.client, {http.Client? httpClient}) : _http = httpClient ?? http.Client() {
    client.currentUser.addListener(_onAccountChanged);
    if (client.isSignedIn) start();
  }

  final AltAccountClient client;
  final http.Client _http;

  /// Unread notifications, for badges.
  final ValueNotifier<int> unread = ValueNotifier<int>(0);
  final _incoming = StreamController<AltNotification>.broadcast();

  /// New notifications as they arrive (e.g. to show a snackbar).
  Stream<AltNotification> get incoming => _incoming.stream;

  bool _running = false;
  StreamSubscription<String>? _sub;
  Timer? _retry;
  Timer? _poll;

  void _onAccountChanged() {
    if (client.currentUser.value == null) {
      stop();
      unread.value = 0;
    } else {
      start();
    }
  }

  Future<dynamic> _call(String method, String path, {Object? payload}) async {
    final res = await client.authorizedSend(method, Uri.parse('${client.coreUrl}$path'), body: payload);
    final body = res.body.isEmpty ? null : jsonDecode(res.body);
    if (res.statusCode >= 400) throw AltApiException.fromBody(res.statusCode, body);
    return body;
  }

  Future<List<AltNotification>> list({bool unreadOnly = false, DateTime? before, int limit = 30}) async {
    final q = <String>['limit=$limit', if (unreadOnly) 'unread=true', if (before != null) 'before=${Uri.encodeComponent(before.toUtc().toIso8601String())}'];
    final body = Map<String, dynamic>.from(await _call('GET', '/notifications?${q.join('&')}') as Map);
    unread.value = (body['unreadCount'] as num).toInt();
    return (body['items'] as List).map((e) => AltNotification(Map<String, dynamic>.from(e as Map))).toList();
  }

  Future<void> markRead(String id) async {
    final body = await _call('POST', '/notifications/$id/read') as Map;
    unread.value = (body['unreadCount'] as num).toInt();
  }

  /// Module 2: which categories reach the inbox and the phone, and the e-mail digest (`off`, `daily`, `weekly`).
  Future<Map<String, dynamic>> settings() async => Map<String, dynamic>.from(await _call('GET', '/notifications/settings') as Map);

  Future<Map<String, dynamic>> saveSettings({required List<String> muted, required List<String> pushMuted, required String digest}) async =>
      Map<String, dynamic>.from(await _call('PUT', '/notifications/settings', payload: {'muted': muted, 'pushMuted': pushMuted, 'digest': digest}) as Map);

  Future<void> markAllRead() async {
    await _call('POST', '/notifications/read-all');
    unread.value = 0;
  }

  Future<void> refreshCount() async {
    try {
      final body = await _call('GET', '/notifications/unread-count') as Map;
      unread.value = (body['unreadCount'] as num).toInt();
    } catch (_) {}
  }

  /// Starts listening (called automatically when someone signs in).
  void start() {
    if (_running || !client.isSignedIn) return;
    _running = true;
    refreshCount();
    if (kIsWeb) {
      _poll = Timer.periodic(const Duration(seconds: 30), (_) => refreshCount());
    } else {
      _connect();
    }
  }

  void stop() {
    _running = false;
    _sub?.cancel();
    _sub = null;
    _retry?.cancel();
    _poll?.cancel();
  }

  Future<void> _connect() async {
    if (!_running) return;
    try {
      final token = await client.accessToken();
      if (token == null) return;
      final req = http.Request('GET', Uri.parse('${client.coreUrl}/notifications/stream'))
        ..headers['authorization'] = 'Bearer $token'
        ..headers['accept'] = 'text/event-stream';
      final res = await _http.send(req);
      if (res.statusCode != 200) throw Exception('stream HTTP ${res.statusCode}');
      String? event;
      final data = StringBuffer();
      _sub = res.stream.transform(utf8.decoder).transform(const LineSplitter()).listen(
        (line) {
          if (line.isEmpty) {
            _dispatch(event, data.toString());
            event = null;
            data.clear();
          } else if (line.startsWith('event:')) {
            event = line.substring(6).trim();
          } else if (line.startsWith('data:')) {
            data.write(line.substring(5).trim());
          }
        },
        onDone: _scheduleReconnect,
        onError: (_) => _scheduleReconnect(),
        cancelOnError: true,
      );
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _dispatch(String? event, String data) {
    if (event == 'ready') {
      try {
        unread.value = ((jsonDecode(data) as Map)['unreadCount'] as num).toInt();
      } catch (_) {}
    } else if (event == 'notification') {
      try {
        final n = AltNotification(Map<String, dynamic>.from(jsonDecode(data) as Map));
        unread.value = unread.value + 1;
        _incoming.add(n);
      } catch (_) {}
    }
  }

  void _scheduleReconnect() {
    _sub = null;
    if (!_running) return;
    _retry?.cancel();
    // Access tokens expire every 15 minutes; reconnecting picks up a fresh one.
    _retry = Timer(const Duration(seconds: 3), _connect);
  }

  void dispose() {
    stop();
    client.currentUser.removeListener(_onAccountChanged);
    unread.dispose();
    _incoming.close();
  }
}
