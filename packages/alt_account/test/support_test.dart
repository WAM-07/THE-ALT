import 'dart:convert';

import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

http.Response _json(int status, Object body) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

Map<String, dynamic> _case(String status) => {
      'id': 'c1',
      'number': 7,
      'kind': 'support',
      'status': status,
      'platform': 'altera',
      'category': 'billing',
      'title': 'Charged twice',
      'subject': null,
      'resolution': null,
      'createdAt': '2026-10-15T10:00:00.000Z',
      'updatedAt': '2026-10-15T10:05:00.000Z',
      'closedAt': null,
    };

/// A signed-in client whose ALT Core answers from [routes] (method + path → response).
Future<AltAccountClient> _client(Map<String, http.Response Function(http.Request)> routes, List<http.Request> seen) async {
  final client = AltAccountClient(
    apiUrl: 'http://gw:8080',
    platform: AltPlatform.altera,
    tokenStore: MemoryTokenStore(),
    httpClient: MockClient((req) async {
      seen.add(req);
      if (req.url.path == '/core/auth/login') {
        return _json(200, {
          'accessToken': 'a1',
          'accessTokenExpiresIn': 900,
          'refreshToken': 'r1',
          'sessionId': 's1',
          'user': {
            'id': 'u1',
            'handle': 'hamza',
            'displayName': 'Hamza',
            'emailVerified': true,
            'roles': ['participant'],
            'twoFactorEnabled': false,
            'hasPassword': true,
            'createdAt': '2026-10-11T00:00:00.000Z',
            'wallets': [],
            'platforms': [],
          },
        });
      }
      final handler = routes['${req.method} ${req.url.path}'];
      return handler != null ? handler(req) : _json(404, {'error': {'code': 'NOT_FOUND', 'message': 'nope'}});
    }),
  );
  await client.signIn('hamza', 'pw');
  return client;
}

void main() {
  test('lists, opens and answers cases through ALT Core with the person\'s token', () async {
    final seen = <http.Request>[];
    final client = await _client({
      'GET /core/me/cases': (_) => _json(200, {'items': [_case('waiting')]}),
      'GET /core/me/cases/c1': (_) => _json(200, {
            'case': _case('waiting'),
            'events': [
              {'id': '1', 'at': '2026-10-15T10:00:00.000Z', 'kind': 'opened', 'from': 'you', 'body': 'It charged me twice.'},
              {'id': '2', 'at': '2026-10-15T10:05:00.000Z', 'kind': 'reply', 'from': 'alt', 'body': 'Which AI?'},
            ],
          }),
      'POST /core/me/cases/c1/messages': (_) => _json(200, {'ok': true}),
    }, seen);
    final support = AltSupport(client);

    final cases = await support.mine();
    expect(cases.single.label, '#0007');
    expect(cases.single.waitingForYou, isTrue);
    final (c, messages) = await support.get('c1');
    expect(c.statusLabel, 'Waiting for you');
    expect([for (final m in messages) (m.fromYou, m.body)], [(true, 'It charged me twice.'), (false, 'Which AI?')]);
    await support.reply('c1', 'Urdu Ustad');
    expect(jsonDecode(seen.last.body), {'body': 'Urdu Ustad'});
    expect(seen.last.headers['authorization'], 'Bearer a1');
  });

  test('appeals name the decision, disputes name the payment', () async {
    final seen = <http.Request>[];
    final client = await _client({
      'GET /core/me/decisions': (_) => _json(200, {
            'items': [
              {'caseNumber': 3, 'action': 'suspend_ai', 'label': 'Your AI was suspended', 'reason': 'Harmful advice.', 'at': '2026-10-15T10:00:00.000Z', 'appealed': false},
            ],
          }),
      'GET /altar/me/activity': (_) => _json(200, [
            {'id': '1', 'kind': 'rental', 'role': 'rented', 'ai': {'name': 'Urdu Ustad'}, 'amount': {'pol': '2.5'}, 'txHash': '0xabc', 'occurredAt': '2026-10-15T09:00:00.000Z'},
          ]),
      'POST /core/me/cases': (_) => _json(201, {'case': _case('open'), 'merged': false}),
    }, seen);
    final support = AltSupport(client);
    final d = (await support.decisions()).single;
    expect((d.caseNumber, d.label), (3, 'Your AI was suspended'));
    final p = (await support.payments()).single;
    expect(p.summary, 'You rented Urdu Ustad · 2.5 POL');
    await support.open(kind: 'appeal', category: 'moderation', title: 'Appeal of #0003', body: 'It was a quote.', appealOf: d.caseNumber);
    expect(jsonDecode(seen.last.body)['appealOf'], 3);
    await support.open(kind: 'dispute', category: 'marketplace', title: 'Rental', body: 'Never worked.', subject: {'type': 'transaction', 'id': p.txHash});
    expect(jsonDecode(seen.last.body)['subject'], {'type': 'transaction', 'id': '0xabc'});
  });

  testWidgets('Help & support shows the cases and opens a new request', (tester) async {
    final client = await _client({
      'GET /core/me/cases': (_) => _json(200, {'items': [_case('resolved')]}),
    }, []);
    await tester.pumpWidget(MaterialApp(home: AltSupportScreen(client: client)));
    await tester.pumpAndSettle();
    expect(find.text('Charged twice'), findsOneWidget);
    expect(find.text('Resolved'), findsOneWidget);
    await tester.tap(find.text('Ask for help'));
    await tester.pumpAndSettle();
    expect(find.text('What is it about?'), findsOneWidget);
    await tester.tap(find.text('Send to ALT'));
    await tester.pump();
    expect(find.text('Give it a short title and tell us what happened.'), findsOneWidget);
  });
}
