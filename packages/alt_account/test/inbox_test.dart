import 'dart:async';
import 'dart:convert';

import 'package:alt_account/alt_account.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

Map<String, dynamic> _note(String id, {bool read = false}) => {
      'id': id,
      'category': 'security',
      'type': 'security.new_sign_in',
      'title': 'New sign-in to ALTERA',
      'body': 'Pixel signed in',
      'data': {},
      'platform': 'core',
      'link': null,
      'read': read,
      'createdAt': '2026-10-11T10:00:00.000Z',
    };

Map<String, dynamic> _session() => {
      'tokenType': 'Bearer',
      'accessToken': 'access-1',
      'accessTokenExpiresIn': 900,
      'refreshToken': 'refresh-1',
      'refreshTokenExpiresAt': '2026-11-10T00:00:00.000Z',
      'sessionId': 's1',
      'user': {
        'id': 'u1',
        'handle': 'wamiq',
        'displayName': 'Wamiq',
        'email': 'w@alt.dev',
        'emailVerified': true,
        'roles': ['creator'],
        'twoFactorEnabled': false,
        'hasPassword': true,
        'createdAt': '2026-10-11T00:00:00.000Z',
        'wallets': [],
        'platforms': [],
      },
    };

http.Response _json(Object body) => http.Response(jsonEncode(body), 200, headers: {'content-type': 'application/json'});

void main() {
  test('lists the inbox, keeps the unread count and marks items read', () async {
    final calls = <String>[];
    final client = AltAccountClient(
      apiUrl: 'http://gw:8080',
      platform: AltPlatform.alter,
      tokenStore: MemoryTokenStore(),
      httpClient: MockClient((req) async {
        calls.add('${req.method} ${req.url.path}${req.url.hasQuery ? '?${req.url.query}' : ''}');
        expect(req.url.path == '/core/auth/login' || req.headers['authorization'] == 'Bearer access-1', isTrue);
        return switch (req.url.path) {
          '/core/auth/login' => _json(_session()),
          '/core/notifications' => _json({'items': [_note('n1'), _note('n2', read: true)], 'unreadCount': 1}),
          '/core/notifications/n1/read' => _json({'unreadCount': 0}),
          _ => _json({'unreadCount': 1}),
        };
      }),
    );
    final inbox = AltInbox(client, httpClient: MockClient((_) async => http.Response('', 503)));
    await client.signIn('wamiq', 'pw');
    final items = await inbox.list();
    expect(items.map((n) => n.id), ['n1', 'n2']);
    expect(items.first.read, isFalse);
    expect(inbox.unread.value, 1);
    await inbox.markRead('n1');
    expect(inbox.unread.value, 0);
    expect(calls, contains('GET /core/notifications?limit=30'));
    inbox.dispose();
  });

  test('delivers notifications from the live stream as they arrive', () async {
    final stream = StreamController<List<int>>();
    final client = AltAccountClient(
      apiUrl: 'http://gw:8080',
      platform: AltPlatform.alter,
      tokenStore: MemoryTokenStore(),
      httpClient: MockClient((req) async => req.url.path == '/core/auth/login' ? _json(_session()) : _json({'unreadCount': 2})),
    );
    late http.BaseRequest streamRequest;
    final inbox = AltInbox(client, httpClient: MockClient.streaming((req, _) async {
      streamRequest = req;
      return http.StreamedResponse(stream.stream, 200, headers: {'content-type': 'text/event-stream'});
    }));
    final got = inbox.incoming.first;
    await client.signIn('wamiq', 'pw'); // signing in starts the inbox

    stream.add(utf8.encode('event: ready\ndata: {"unreadCount":2}\n\n: keep-alive\n\n'));
    stream.add(utf8.encode('event: notification\ndata: ${jsonEncode(_note('n3'))}\n'));
    stream.add(utf8.encode('\n'));
    final n = await got.timeout(const Duration(seconds: 2));
    expect(n.title, 'New sign-in to ALTERA');
    expect(inbox.unread.value, 3);
    expect(streamRequest.url.toString(), 'http://gw:8080/core/notifications/stream');
    expect(streamRequest.headers['authorization'], 'Bearer access-1');
    inbox.dispose();
    await stream.close();
  });
}
