import 'dart:convert';

import 'package:alt_account/alt_account.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

Map<String, dynamic> _user() => {
      'id': 'u1',
      'handle': 'wamiq',
      'displayName': 'Wamiq',
      'email': 'w@alt.dev',
      'emailVerified': true,
      'roles': ['creator'],
      'twoFactorEnabled': false,
      'hasPassword': true,
      'createdAt': '2026-10-11T00:00:00.000Z',
      'wallets': [
        {'address': '0x2af2d6de6a8bb670fc1ae282af65720ea1062580', 'kind': 'custodial', 'isPrimary': true, 'label': 'ALT wallet'}
      ],
      'platforms': [
        {'platform': 'alter', 'joinedAt': '2026-10-11T00:00:00.000Z', 'lastSeenAt': '2026-10-11T00:00:00.000Z'}
      ],
    };

Map<String, dynamic> _tokens(String n) => {
      'tokenType': 'Bearer',
      'accessToken': 'access-$n',
      'accessTokenExpiresIn': 900,
      'refreshToken': 'refresh-$n',
      'refreshTokenExpiresAt': '2026-11-10T00:00:00.000Z',
      'sessionId': 's1',
      'user': _user(),
    };

http.Response _json(int status, Object body) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

void main() {
  test('signs in, keeps the refresh token in the store and exposes the user', () async {
    final store = MemoryTokenStore();
    late Map<String, dynamic> sent;
    final client = AltAccountClient(
      apiUrl: 'http://gw:8080/',
      platform: AltPlatform.altera,
      tokenStore: store,
      deviceName: 'Pixel',
      httpClient: MockClient((req) async {
        expect(req.url.toString(), 'http://gw:8080/core/auth/login');
        sent = jsonDecode(req.body) as Map<String, dynamic>;
        return _json(200, _tokens('1'));
      }),
    );
    final result = await client.signIn('wamiq', 'pw');
    expect(result, isA<SignedIn>());
    expect(sent, {'identifier': 'wamiq', 'password': 'pw', 'platform': 'altera', 'deviceName': 'Pixel', 'client': 'app'});
    expect(await store.readRefreshToken(), 'refresh-1');
    expect(client.currentUser.value?.primaryWallet?.short, '0x2af2…2580');
    expect(await client.accessToken(), 'access-1');
  });

  test('reports two-factor and unverified-email outcomes instead of throwing', () async {
    var call = 0;
    final client = AltAccountClient(
      apiUrl: 'http://gw',
      platform: AltPlatform.alter,
      tokenStore: MemoryTokenStore(),
      httpClient: MockClient((req) async {
        call++;
        return call == 1
            ? _json(200, {'mfaRequired': true, 'mfaToken': 'mfa'})
            : _json(403, {
                'error': {'code': 'EMAIL_NOT_VERIFIED', 'message': 'Verify', 'details': {'email': 'w@alt.dev'}}
              });
      }),
    );
    expect(await client.signIn('w', 'p'), isA<TwoFactorRequired>().having((r) => r.mfaToken, 'token', 'mfa'));
    expect(await client.signIn('w', 'p'), isA<EmailNotVerified>().having((r) => r.email, 'email', 'w@alt.dev'));
  });

  test('surfaces ALT Core errors with their code and message', () async {
    final client = AltAccountClient(
      apiUrl: 'http://gw',
      platform: AltPlatform.alter,
      tokenStore: MemoryTokenStore(),
      httpClient: MockClient((_) async => _json(423, {
            'error': {'code': 'ACCOUNT_LOCKED', 'message': 'Too many failed attempts.', 'details': {'lockedUntil': 'x'}}
          })),
    );
    await expectLater(
      client.signIn('w', 'p'),
      throwsA(isA<AltApiException>().having((e) => e.code, 'code', 'ACCOUNT_LOCKED').having((e) => e.status, 'status', 423)),
    );
  });

  test('concurrent callers share a single refresh (a reused refresh token would end the session)', () async {
    final store = MemoryTokenStore()..writeRefreshToken('refresh-0');
    var refreshes = 0;
    final client = AltAccountClient(
      apiUrl: 'http://gw',
      platform: AltPlatform.altera,
      tokenStore: store,
      httpClient: MockClient((req) async {
        if (req.url.path == '/core/auth/refresh') {
          refreshes++;
          expect(jsonDecode(req.body), {'refreshToken': 'refresh-0'});
          await Future<void>.delayed(const Duration(milliseconds: 20));
          return _json(200, _tokens('1'));
        }
        return _json(404, {});
      }),
    );
    final tokens = await Future.wait([client.accessToken(), client.accessToken(), client.accessToken()]);
    expect(tokens, ['access-1', 'access-1', 'access-1']);
    expect(refreshes, 1);
    expect(await store.readRefreshToken(), 'refresh-1');
  });

  test('authorizedSend refreshes once on 401 and retries with the new token', () async {
    final store = MemoryTokenStore();
    var phase = 0;
    final seen = <String?>[];
    final client = AltAccountClient(
      apiUrl: 'http://gw',
      platform: AltPlatform.altera,
      tokenStore: store,
      httpClient: MockClient((req) async {
        if (req.url.path == '/core/auth/login') return _json(200, _tokens('1'));
        if (req.url.path == '/core/auth/refresh') return _json(200, _tokens('2'));
        seen.add(req.headers['authorization']);
        return phase++ == 0 ? _json(401, {'message': 'expired'}) : _json(200, {'ok': true});
      }),
    );
    await client.signIn('w', 'p');
    final res = await client.authorizedSend('GET', Uri.parse('http://gw/altera/feed'));
    expect(res.statusCode, 200);
    expect(seen, ['Bearer access-1', 'Bearer access-2']);
  });

  test('a rejected refresh signs the person out; being offline does not', () async {
    final store = MemoryTokenStore()..writeRefreshToken('r');
    var offline = true;
    final client = AltAccountClient(
      apiUrl: 'http://gw',
      platform: AltPlatform.altera,
      tokenStore: store,
      httpClient: MockClient((req) async {
        if (offline) throw http.ClientException('no network');
        return _json(401, {
          'error': {'code': 'REFRESH_TOKEN_REUSED', 'message': 'Sign in again.'}
        });
      }),
    );
    expect(await client.restore(), isNull);
    expect(await store.readRefreshToken(), 'r');
    offline = false;
    expect(await client.restore(), isNull);
    expect(await store.readRefreshToken(), isNull);
  });

  test('sign-out clears local state even if the server is unreachable', () async {
    final store = MemoryTokenStore();
    var online = true;
    final client = AltAccountClient(
      apiUrl: 'http://gw',
      platform: AltPlatform.alter,
      tokenStore: store,
      httpClient: MockClient((req) async {
        if (!online) throw http.ClientException('down');
        return _json(200, _tokens('1'));
      }),
    );
    await client.signIn('w', 'p');
    online = false;
    await client.signOut();
    expect(client.currentUser.value, isNull);
    expect(await store.readRefreshToken(), isNull);
  });

  test('recognises handoff links from every ALT app', () {
    expect(AltHandoff.handoffCode(Uri.parse('altera://handoff?code=abc')), 'abc');
    expect(AltHandoff.handoffCode(Uri.parse('alter://handoff?code=xyz')), 'xyz');
    expect(AltHandoff.handoffCode(Uri.parse('http://localhost:8080/handoff?code=web')), 'web');
    expect(AltHandoff.handoffCode(Uri.parse('altera://other?code=abc')), isNull);
    expect(AltHandoff.handoffCode(Uri.parse('altera://handoff')), isNull);
  });
}
