import 'package:alt_account/alt_account.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const avatar = 'http://localhost:8080/core/media/avatars/a.png';

  test('points localhost links at the address the device uses', () {
    expect(altMediaUrl(avatar, 'http://10.0.2.2:8080'), 'http://10.0.2.2:8080/core/media/avatars/a.png');
    expect(altMediaUrl(avatar, 'http://192.168.1.5:8080'), 'http://192.168.1.5:8080/core/media/avatars/a.png');
    expect(altMediaUrl('http://127.0.0.1:8080/core/ipfs/bafy?x=1', 'https://api.alt.app'), 'https://api.alt.app/core/ipfs/bafy?x=1');
  });

  test('leaves other links alone', () {
    expect(altMediaUrl(avatar, 'http://localhost:8080'), avatar);
    expect(altMediaUrl('https://res.cloudinary.com/x/y.png', 'http://10.0.2.2:8080'), 'https://res.cloudinary.com/x/y.png');
    expect(altMediaUrl('not a url', 'http://10.0.2.2:8080'), 'not a url');
  });
}
