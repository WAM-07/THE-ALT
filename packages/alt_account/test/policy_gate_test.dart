import 'dart:convert';

import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

http.Response _json(int status, Object body) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

Map<String, dynamic> _terms({required bool accepted, int? before}) => {
      'slug': 'terms',
      'version': 2,
      'title': 'Terms of use',
      'summary': 'Rentals now last whole days.',
      'publishedAt': '2026-10-15T10:00:00.000Z',
      'publishedBy': '@alt_admin',
      'accepted': accepted,
      'acceptedVersion': before,
    };

void main() {
  testWidgets('asks a signed-in person to agree to an updated policy, then gets out of the way', (tester) async {
    var agreed = false;
    final sent = <Map<String, dynamic>>[];
    final client = AltAccountClient(
      apiUrl: 'http://gw:8080',
      platform: AltPlatform.alter,
      tokenStore: MemoryTokenStore(),
      httpClient: MockClient((req) async {
        switch ('${req.method} ${req.url.path}') {
          case 'POST /core/auth/login':
            return _json(200, {
              'accessToken': 'a1',
              'accessTokenExpiresIn': 900,
              'refreshToken': 'r1',
              'sessionId': 's1',
              'user': {'id': 'u1', 'handle': 'sara', 'displayName': 'Sara', 'emailVerified': true, 'roles': ['participant'], 'twoFactorEnabled': false, 'hasPassword': true, 'createdAt': '2026-10-11T00:00:00.000Z', 'wallets': [], 'platforms': []},
            });
          case 'GET /core/me/policies':
            final t = _terms(accepted: agreed, before: agreed ? 2 : 1);
            return _json(200, {'items': [t], 'pending': agreed ? [] : [t]});
          case 'POST /core/me/policies/accept':
            sent.add(jsonDecode(req.body) as Map<String, dynamic>);
            agreed = true;
            return _json(200, {'items': [_terms(accepted: true, before: 2)], 'pending': []});
        }
        return _json(404, {});
      }),
    );

    await tester.pumpWidget(MaterialApp(home: AltPolicyGate(client: client, child: const Scaffold(body: Text('the app')))));
    expect(find.text('ALT updated its policies'), findsNothing); // signed out: nothing to ask
    await client.signIn('sara', 'pw');
    await tester.pumpAndSettle();
    expect(find.text('ALT updated its policies'), findsOneWidget);
    expect(find.text('Terms of use · v2'), findsOneWidget);
    expect(find.text('Rentals now last whole days.'), findsOneWidget);

    await tester.tap(find.text('I agree'));
    await tester.pumpAndSettle();
    expect(sent, [
      {'slug': 'terms', 'version': 2},
    ]);
    expect(find.text('ALT updated its policies'), findsNothing);
    expect(find.text('the app'), findsOneWidget);
  });
}
