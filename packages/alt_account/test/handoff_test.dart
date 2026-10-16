import 'dart:async';
import 'dart:convert';

import 'package:alt_account/alt_account.dart';
import 'package:app_links/app_links.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

http.Response _json(int status, Object body) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

class _Links extends Fake implements AppLinks {
  final controller = StreamController<Uri>.broadcast();
  @override
  Stream<Uri> get uriLinkStream => controller.stream;
}

Map<String, dynamic> _user(String handle) => {
      'id': 'id-$handle',
      'handle': handle,
      'displayName': handle,
      'emailVerified': true,
      'roles': ['participant'],
      'twoFactorEnabled': false,
      'hasPassword': true,
      'createdAt': '2026-10-11T00:00:00.000Z',
      'wallets': [],
      'platforms': [],
    };

void main() {
  late List<String> calls;
  late AltAccountClient client;
  late _Links links;
  late AltHandoff handoff;

  setUp(() {
    calls = [];
    links = _Links();
    client = AltAccountClient(
      apiUrl: 'http://gw:8080',
      platform: AltPlatform.altera,
      tokenStore: MemoryTokenStore(),
      httpClient: MockClient((req) async {
        calls.add(req.url.path);
        if (req.url.path == '/core/auth/handoff/peek') return _json(200, {'handle': 'mallory', 'displayName': 'Mallory', 'avatarUrl': null});
        if (req.url.path == '/core/auth/handoff/redeem') {
          return _json(200, {'accessToken': 'a', 'accessTokenExpiresIn': 900, 'refreshToken': 'r', 'sessionId': 's', 'user': _user('mallory')});
        }
        return _json(404, {});
      }),
    );
    handoff = AltHandoff(client, appLinks: links);
  });

  tearDown(() => handoff.dispose());

  Future<void> settle() => Future<void>.delayed(const Duration(milliseconds: 20));

  test('a link this app did not ask for waits for the person to confirm whose account it is', () async {
    final signedIn = <String>[];
    var answer = false;
    AltHandoffPreview? asked;
    handoff.listen(onSignedIn: (u) => signedIn.add(u.handle), confirm: (who) async => (asked = who, answer).$2);

    links.controller.add(Uri.parse('altera://handoff?code=crafted-code-0123456789'));
    await settle();
    expect(asked?.handle, 'mallory');
    expect(calls, ['/core/auth/handoff/peek']); // declined: the code is never used
    expect(signedIn, isEmpty);

    answer = true;
    links.controller.add(Uri.parse('altera://handoff?code=crafted-code-0123456789'));
    await settle();
    expect(calls.last, '/core/auth/handoff/redeem');
    expect(signedIn, ['mallory']);
  });

  test('a link answering this app\'s own request goes straight through, once', () async {
    final signedIn = <String>[];
    handoff.listen(onSignedIn: (u) => signedIn.add(u.handle), confirm: (_) async => false);
    final state = AltHandoff.expectHandoff();
    links.controller.add(Uri.parse('altera://handoff?code=window-code-0123456789&state=$state'));
    await settle();
    expect(calls, ['/core/auth/handoff/redeem']);
    expect(signedIn, ['mallory']);
    // The same state again is just another unsolicited link.
    links.controller.add(Uri.parse('altera://handoff?code=window-code-0123456789&state=$state'));
    await settle();
    expect(calls.last, '/core/auth/handoff/peek');
  });

  test('without a way to confirm, unsolicited links are refused', () async {
    final signedIn = <String>[];
    handoff.listen(onSignedIn: (u) => signedIn.add(u.handle));
    links.controller.add(Uri.parse('altera://handoff?code=crafted-code-0123456789'));
    await settle();
    expect(calls, ['/core/auth/handoff/peek']);
    expect(signedIn, isEmpty);
  });
}
