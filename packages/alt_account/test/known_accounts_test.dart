import 'package:alt_account/alt_account.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

AltUser _user(String id, {String? email}) => AltUser.fromJson({
      'id': id,
      'handle': 'user_$id',
      'displayName': 'User $id',
      'email': email,
      'createdAt': '2026-10-15T00:00:00Z',
    });

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  test('remembers the accounts used here, newest first, at most five, never a secret', () async {
    final known = AltKnownAccounts();
    expect(await known.list(), isEmpty);
    for (var i = 1; i <= 6; i++) {
      await known.remember(_user('$i', email: i.isEven ? 'u$i@alt.test' : null));
    }
    await known.remember(_user('3'));
    final list = await known.list();
    expect(list.map((a) => a.id), ['3', '6', '5', '4', '2']);
    expect(list[1].identifier, 'u6@alt.test');
    expect(list[0].identifier, 'user_3');
    expect(list.first.toJson().keys, unorderedEquals(['id', 'handle', 'displayName', 'email', 'avatarUrl']));

    await known.forget('6');
    expect((await known.list()).map((a) => a.id), ['3', '5', '4', '2']);
  });

  test('reads sign-in requests between the ALT phone apps', () {
    expect(AltHandoff.signInRequestTarget(Uri.parse('alter://signin-request?for=altera')), AltPlatform.altera);
    expect(AltHandoff.signInRequestTarget(Uri.parse('altera://signin-request?for=alter')), AltPlatform.alter);
    // ALTAR is on the web; anything else is ignored.
    expect(AltHandoff.signInRequestTarget(Uri.parse('alter://signin-request?for=altar')), isNull);
    expect(AltHandoff.signInRequestTarget(Uri.parse('alter://handoff?code=x')), isNull);
    expect(AltHandoff.partnerOf(AltPlatform.alter), AltPlatform.altera);
    expect(AltHandoff.partnerOf(AltPlatform.altera), AltPlatform.alter);
    expect(AltHandoff.partnerOf(AltPlatform.altar), isNull);
  });
}
