/// One ALT account for ALTER, ALTAR and ALTERA.
///
/// ```dart
/// final alt = AltAccountClient(apiUrl: 'http://10.0.2.2:8080', platform: AltPlatform.altera);
/// final user = await alt.restore(); // null => show sign-in
/// final result = await alt.signIn('me@example.com', 'password');
/// ```
library;

export 'src/client.dart';
export 'src/errors.dart';
export 'src/handoff.dart';
export 'src/inbox.dart';
export 'src/known_accounts.dart';
export 'src/media.dart';
export 'src/models.dart';
export 'src/token_store.dart';
export 'src/ui/account_center.dart';
export 'src/ui/code_dialog.dart';
export 'src/ui/continue_with_alt.dart';
export 'src/ui/inbox_screen.dart';
export 'src/ui/picture_picker.dart';
export 'src/ui/sign_in_sheet.dart';
