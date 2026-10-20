import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../client.dart';
import '../errors.dart';
import '../handoff.dart';
import '../known_accounts.dart';
import '../media.dart';
import '../models.dart';
import 'alt_logo.dart';
import 'continue_with_alt.dart';

// ALT's own look, the same in every app (it belongs to ALT, not to the app it opens over).
const _bg = Color(0xFF141519);
const _raised = Color(0xFF1D1E24);
const _line = Color(0x1FFFFFFF);
const _ink = Color(0xFFF4F3EF);
const _muted = Color(0xFFA3A3AD);
const _faint = Color(0xFF6E6E78);
const _danger = Color(0xFFFF7A86);

/// "Continue with ALT" inside the app, like Google's account chooser: a card slides up over the
/// app with the ALT accounts used on this device, then asks for the password (and a 2FA or email
/// code when needed) in the card itself, checked by ALT Core. The password goes straight to Core
/// and is never stored; only the tokens are kept, as with any other sign-in.
///
/// [handoff] adds "Continue with ALTER/ALTERA": the other ALT app signs this one in after the
/// person confirms there, with no password. Creating an account and resetting a password open
/// the ALT Account window. Returns the signed-in person, or null if the card was closed (or the
/// sign-in will arrive through the other app's handoff link).
Future<AltUser?> showAltSignInSheet(BuildContext context, {required AltAccountClient client, AltHandoff? handoff}) {
  return showModalBottomSheet<AltUser>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    barrierColor: Colors.black.withValues(alpha: 0.55),
    builder: (_) => _SignInSheet(client: client, handoff: handoff),
  );
}

/// Asked by another ALT app to sign it in ([AltHandoff.listenForSignInRequests]): a small card
/// "Continue to ALTERA as Wamiq?". True if the person agreed.
Future<bool> showAltShareSignInSheet(BuildContext context, {required AltAccountClient client, required AltPlatform target}) async {
  final user = client.currentUser.value;
  if (user == null) return false;
  final ok = await showModalBottomSheet<bool>(
    context: context,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (ctx) => _Card(
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const _Brand(),
        const SizedBox(height: 18),
        Text('Sign in to ${target.label}?', style: _title),
        const SizedBox(height: 6),
        Text('${target.label} asked to use the ALT account signed in here. It gets its own session; your password is not shared.', style: _body),
        const SizedBox(height: 18),
        _AccountTile(name: user.displayName, detail: '@${user.handle}', avatar: _avatar(client, user.avatarUrl)),
        const SizedBox(height: 18),
        _Primary(label: 'Continue as ${user.displayName.split(' ').first}', onTap: () => Navigator.pop(ctx, true)),
        const SizedBox(height: 8),
        _Quiet(label: 'Cancel', onTap: () => Navigator.pop(ctx, false)),
      ]),
    ),
  );
  return ok == true;
}

/// A handoff link this app didn't ask for ("Open in ALTERA" from the other app, or a link from
/// somewhere else): "Sign in to ALTERA as Wamiq?". True if the person agreed.
Future<bool> showAltHandoffConfirmSheet(BuildContext context, {required AltAccountClient client, required AltHandoffPreview who}) async {
  final app = client.platform.label;
  final ok = await showModalBottomSheet<bool>(
    context: context,
    useSafeArea: true,
    isDismissible: false,
    backgroundColor: Colors.transparent,
    builder: (ctx) => _Card(
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const _Brand(),
        const SizedBox(height: 18),
        Text('Sign in to $app?', style: _title),
        const SizedBox(height: 6),
        Text(
          client.currentUser.value == null
              ? 'A link asked to sign $app in to this ALT account. Continue only if you opened it yourself.'
              : 'A link asked to switch $app to this ALT account, signing @${client.currentUser.value!.handle} out here. Continue only if you opened it yourself.',
          style: _body,
        ),
        const SizedBox(height: 18),
        _AccountTile(name: who.displayName, detail: '@${who.handle}', avatar: _avatar(client, who.avatarUrl)),
        const SizedBox(height: 18),
        _Primary(label: 'Continue as ${who.displayName.split(' ').first}', onTap: () => Navigator.pop(ctx, true)),
        const SizedBox(height: 8),
        _Quiet(label: 'Cancel', onTap: () => Navigator.pop(ctx, false)),
      ]),
    ),
  );
  return ok == true;
}

String? _avatar(AltAccountClient client, String? url) => url == null ? null : altMediaUrl(url, client.apiUrl);

const _title = TextStyle(color: _ink, fontSize: 21, fontWeight: FontWeight.w700, letterSpacing: -0.3, height: 1.2);
const _body = TextStyle(color: _muted, fontSize: 14, height: 1.45);

enum _Step { choose, password, code }

class _SignInSheet extends StatefulWidget {
  const _SignInSheet({required this.client, this.handoff});
  final AltAccountClient client;
  final AltHandoff? handoff;

  @override
  State<_SignInSheet> createState() => _SignInSheetState();
}

class _SignInSheetState extends State<_SignInSheet> {
  final _identifier = TextEditingController();
  final _password = TextEditingController();
  final _code = TextEditingController();
  List<AltKnownAccount>? _known;
  AltKnownAccount? _picked;
  _Step _step = _Step.choose;
  bool _busy = false;
  bool _obscure = true;
  String? _error;
  // The code step: a 2FA code (with [_mfaToken]) or the email code (for [_verifyEmail]).
  String? _mfaToken;
  String? _verifyEmail;
  bool _recovery = false;

  AltPlatform? get _partner => widget.handoff == null ? null : AltHandoff.partnerOf(widget.client.platform);

  @override
  void initState() {
    super.initState();
    AltKnownAccounts.instance.list().then((list) {
      if (!mounted) return;
      setState(() {
        _known = list;
        // Nobody has signed in here before: go straight to the form.
        if (list.isEmpty && _partner == null) _step = _Step.password;
      });
    });
  }

  @override
  void dispose() {
    for (final c in [_identifier, _password, _code]) {
      c.dispose();
    }
    super.dispose();
  }

  void _go(_Step step) => setState(() {
        _step = step;
        _error = null;
      });

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } on AltApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not reach ALT. Check your connection and try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _outcome(SignInResult result) async {
    switch (result) {
      case SignedIn(:final user):
        await _done(user);
      case TwoFactorRequired(:final mfaToken):
        _code.clear();
        setState(() {
          _mfaToken = mfaToken;
          _verifyEmail = null;
          _recovery = false;
        });
        _go(_Step.code);
      case EmailNotVerified(:final email):
        _code.clear();
        setState(() {
          _verifyEmail = email;
          _mfaToken = null;
        });
        _go(_Step.code);
    }
  }

  Future<void> _done(AltUser user) async {
    await AltKnownAccounts.instance.remember(user);
    if (mounted) _close(user);
  }

  /// Closes the card, but only while it is still on top: signing in can make the app navigate on
  /// its own (taking the card away), and popping then would remove the app's new screen instead.
  void _close([AltUser? user]) {
    final route = ModalRoute.of(context);
    if (route != null && route.isCurrent) Navigator.of(context).pop(user);
  }

  Future<void> _signIn() => _run(() async {
        final id = _picked?.identifier ?? _identifier.text.trim();
        if (id.isEmpty || _password.text.isEmpty) {
          setState(() => _error = 'Enter your email or handle and your password.');
          return;
        }
        await _outcome(await widget.client.signIn(id, _password.text));
      });

  Future<void> _submitCode() => _run(() async {
        final code = _code.text.trim();
        if (code.isEmpty) return;
        if (_mfaToken != null) {
          await _done(await widget.client.completeTwoFactor(_mfaToken!, code: _recovery ? null : code, recoveryCode: _recovery ? code : null));
        } else if (_verifyEmail != null) {
          await _outcome(await widget.client.verifyEmail(_verifyEmail!, code));
        }
      });

  Future<void> _resend() => _run(() async {
        await widget.client.resendEmailCode(_verifyEmail!);
        if (mounted) setState(() => _error = null);
        if (mounted) ScaffoldMessenger.maybeOf(context)?.showSnackBar(const SnackBar(content: Text('A new code is on its way.')));
      });

  Future<void> _viaPartner() async {
    final partner = _partner!;
    final opened = await widget.handoff!.requestFrom(partner);
    if (!mounted) return;
    if (opened) {
      _close();
    } else {
      setState(() => _error = '${partner.label} isn’t installed on this phone.');
    }
  }

  Future<void> _window({bool signUp = false}) async {
    _close();
    await AltAccountWindow.open(widget.client, signUp: signUp);
  }

  Future<void> _forget(AltKnownAccount a) async {
    await AltKnownAccounts.instance.forget(a.id);
    final list = await AltKnownAccounts.instance.list();
    if (mounted) setState(() => _known = list);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: _Card(
        child: AnimatedSize(
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOutCubic,
          alignment: Alignment.topCenter,
          child: switch (_step) {
            _Step.choose => _choose(),
            _Step.password => _passwordStep(),
            _Step.code => _codeStep(),
          },
        ),
      ),
    );
  }

  Widget _header(String title, String subtitle, {bool back = false}) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          if (back) ...[
            _IconButton(icon: Icons.arrow_back_rounded, tooltip: 'Back', onTap: () => _go(_known?.isNotEmpty == true || _partner != null ? _Step.choose : _Step.password)),
            const SizedBox(width: 10),
          ],
          const _Brand(),
          const Spacer(),
          _IconButton(icon: Icons.close_rounded, tooltip: 'Close', onTap: _close),
        ]),
        const SizedBox(height: 18),
        Text(title, style: _title),
        const SizedBox(height: 6),
        Text(subtitle, style: _body),
        const SizedBox(height: 18),
      ]);

  Widget _errorLine() => _error == null
      ? const SizedBox.shrink()
      : Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Icon(Icons.error_outline_rounded, size: 18, color: _danger),
            const SizedBox(width: 8),
            Expanded(child: Text(_error!, style: const TextStyle(color: _danger, fontSize: 13.5, height: 1.4))),
          ]),
        );

  Widget _choose() {
    final known = _known;
    final app = widget.client.platform.label;
    return Column(key: const ValueKey('choose'), mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _header('Choose an account', 'to continue to $app. One ALT account works in ALTER, ALTERA and ALTAR.'),
      _errorLine(),
      if (known == null)
        const Padding(padding: EdgeInsets.all(20), child: Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: _muted))))
      else ...[
        for (final a in known) ...[
          _AccountTile(
            name: a.displayName,
            detail: a.email ?? '@${a.handle}',
            avatar: _avatar(widget.client, a.avatarUrl),
            onTap: () {
              _password.clear();
              setState(() => _picked = a);
              _go(_Step.password);
            },
            onLongPress: () => _forget(a),
          ),
          const SizedBox(height: 8),
        ],
        if (_partner != null) ...[
          _ActionTile(icon: Icons.swap_horiz_rounded, label: 'Continue with ${_partner!.label}', detail: 'Use the account signed in there, no password', onTap: _viaPartner),
          const SizedBox(height: 8),
        ],
        _ActionTile(
          icon: Icons.person_add_alt_1_outlined,
          label: 'Use another account',
          onTap: () {
            _password.clear();
            setState(() => _picked = null);
            _go(_Step.password);
          },
        ),
      ],
      const SizedBox(height: 14),
      _Quiet(label: 'Create an ALT account', onTap: () => _window(signUp: true)),
      if (known?.isNotEmpty == true) const Padding(padding: EdgeInsets.only(top: 6), child: Text('Long-press an account to remove it from this phone.', textAlign: TextAlign.center, style: TextStyle(color: _faint, fontSize: 12))),
    ]);
  }

  Widget _passwordStep() {
    final picked = _picked;
    return AutofillGroup(
      child: Column(key: const ValueKey('password'), mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        _header(picked == null ? 'Sign in' : 'Welcome back', picked == null ? 'with your ALT account.' : 'Enter your password to continue.', back: _known?.isNotEmpty == true || _partner != null),
        if (picked != null) ...[
          _AccountTile(name: picked.displayName, detail: picked.email ?? '@${picked.handle}', avatar: _avatar(widget.client, picked.avatarUrl)),
          const SizedBox(height: 12),
        ] else ...[
          _Field(controller: _identifier, hint: 'Email or handle', keyboard: TextInputType.emailAddress, autofill: const [AutofillHints.email, AutofillHints.username], autofocus: true),
          const SizedBox(height: 10),
        ],
        _Field(
          controller: _password,
          hint: 'Password',
          obscure: _obscure,
          autofill: const [AutofillHints.password],
          autofocus: picked != null,
          onSubmitted: (_) => _signIn(),
          suffix: IconButton(
            tooltip: _obscure ? 'Show password' : 'Hide password',
            icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined, color: _muted, size: 20),
            onPressed: () => setState(() => _obscure = !_obscure),
          ),
        ),
        const SizedBox(height: 12),
        _errorLine(),
        _Primary(label: 'Continue', busy: _busy, onTap: _signIn),
        const SizedBox(height: 6),
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          _Quiet(label: 'Forgot password?', onTap: () => _window()),
          if (picked == null) _Quiet(label: 'Create account', onTap: () => _window(signUp: true)),
        ]),
      ]),
    );
  }

  Widget _codeStep() {
    final twoFactor = _mfaToken != null;
    return Column(key: const ValueKey('code'), mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _header(
        twoFactor ? 'Two-step check' : 'Check your email',
        twoFactor
            ? (_recovery ? 'Enter one of your recovery codes.' : 'Enter the 6-digit code from your authenticator app.')
            : 'Enter the 6-digit code we sent to $_verifyEmail.',
        back: true,
      ),
      _Field(
        controller: _code,
        hint: _recovery ? 'Recovery code' : '000000',
        keyboard: _recovery ? TextInputType.text : TextInputType.number,
        autofill: const [AutofillHints.oneTimeCode],
        autofocus: true,
        center: !_recovery,
        formatters: _recovery ? const [] : [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
        onSubmitted: (_) => _submitCode(),
      ),
      const SizedBox(height: 12),
      _errorLine(),
      _Primary(label: 'Verify', busy: _busy, onTap: _submitCode),
      const SizedBox(height: 6),
      if (twoFactor)
        _Quiet(
          label: _recovery ? 'Use the authenticator code' : 'Use a recovery code',
          onTap: () {
            _code.clear();
            setState(() => _recovery = !_recovery);
          },
        )
      else
        _Quiet(label: 'Send a new code', onTap: _resend),
    ]);
  }
}

// ---------------------------------------------------------------- pieces

class _Card extends StatelessWidget {
  const _Card({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.fromLTRB(10, 0, 10, 10),
        decoration: BoxDecoration(
          color: _bg,
          borderRadius: BorderRadius.circular(28),
          border: Border.all(color: _line),
          boxShadow: const [BoxShadow(color: Color(0x66000000), blurRadius: 40, offset: Offset(0, 12))],
        ),
        child: SafeArea(
          top: false,
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 10, 20, 18),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Container(width: 38, height: 4, margin: const EdgeInsets.only(bottom: 14), decoration: BoxDecoration(color: _line, borderRadius: BorderRadius.circular(2))),
              child,
            ]),
          ),
        ),
      );
}

class _Brand extends StatelessWidget {
  const _Brand();

  @override
  Widget build(BuildContext context) => const Row(mainAxisSize: MainAxisSize.min, children: [
        AltMark(height: 16, ink: _ink),
        SizedBox(width: 9),
        Text('ALT Account', style: TextStyle(color: _ink, fontSize: 14, fontWeight: FontWeight.w700, letterSpacing: 0.2)),
      ]);
}

class _AccountTile extends StatelessWidget {
  const _AccountTile({required this.name, required this.detail, this.avatar, this.onTap, this.onLongPress});
  final String name;
  final String detail;
  final String? avatar;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    final initial = Center(child: Text(name.isEmpty ? '?' : name.characters.first.toUpperCase(), style: const TextStyle(color: _ink, fontWeight: FontWeight.w700, fontSize: 17)));
    return Material(
      color: _raised,
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        onLongPress: onLongPress,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(children: [
            Container(
              width: 42,
              height: 42,
              clipBehavior: Clip.antiAlias,
              decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xFF2A2B33)),
              child: avatar == null ? initial : Image.network(avatar!, fit: BoxFit.cover, errorBuilder: (_, __, ___) => initial),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: _ink, fontSize: 15.5, fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Text(detail, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: _muted, fontSize: 13)),
              ]),
            ),
            if (onTap != null) const Icon(Icons.chevron_right_rounded, color: _faint),
          ]),
        ),
      ),
    );
  }
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({required this.icon, required this.label, required this.onTap, this.detail});
  final IconData icon;
  final String label;
  final String? detail;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
        color: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: const BorderSide(color: _line)),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(children: [
              Container(width: 42, height: 42, decoration: const BoxDecoration(shape: BoxShape.circle, color: _raised), child: Icon(icon, color: _ink, size: 20)),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(label, style: const TextStyle(color: _ink, fontSize: 15, fontWeight: FontWeight.w600)),
                  if (detail != null) ...[const SizedBox(height: 2), Text(detail!, style: const TextStyle(color: _muted, fontSize: 12.5))],
                ]),
              ),
            ]),
          ),
        ),
      );
}

class _Field extends StatelessWidget {
  const _Field({
    required this.controller,
    required this.hint,
    this.obscure = false,
    this.keyboard,
    this.autofill = const [],
    this.autofocus = false,
    this.suffix,
    this.onSubmitted,
    this.center = false,
    this.formatters = const [],
  });
  final TextEditingController controller;
  final String hint;
  final bool obscure;
  final TextInputType? keyboard;
  final List<String> autofill;
  final bool autofocus;
  final Widget? suffix;
  final ValueChanged<String>? onSubmitted;
  final bool center;
  final List<TextInputFormatter> formatters;

  @override
  Widget build(BuildContext context) => TextField(
        controller: controller,
        obscureText: obscure,
        keyboardType: keyboard,
        autofillHints: autofill,
        autofocus: autofocus,
        autocorrect: false,
        enableSuggestions: !obscure,
        onSubmitted: onSubmitted,
        inputFormatters: formatters,
        textAlign: center ? TextAlign.center : TextAlign.start,
        cursorColor: _ink,
        style: TextStyle(color: _ink, fontSize: center ? 24 : 15.5, letterSpacing: center ? 8 : 0, fontWeight: center ? FontWeight.w600 : FontWeight.w400),
        decoration: InputDecoration(
          hintText: hint,
          hintStyle: TextStyle(color: _faint, letterSpacing: center ? 8 : 0),
          filled: true,
          fillColor: _raised,
          suffixIcon: suffix,
          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none),
          enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: _line)),
          focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: _muted)),
        ),
      );
}

class _Primary extends StatelessWidget {
  const _Primary({required this.label, required this.onTap, this.busy = false});
  final String label;
  final VoidCallback onTap;
  final bool busy;

  @override
  Widget build(BuildContext context) => SizedBox(
        height: 52,
        child: FilledButton(
          onPressed: busy ? null : onTap,
          style: FilledButton.styleFrom(
            backgroundColor: _ink,
            foregroundColor: _bg,
            disabledBackgroundColor: _ink.withValues(alpha: 0.5),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            textStyle: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700),
          ),
          child: busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.2, color: _bg)) : Text(label),
        ),
      );
}

class _Quiet extends StatelessWidget {
  const _Quiet({required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => TextButton(
        onPressed: onTap,
        style: TextButton.styleFrom(foregroundColor: _muted, textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
        child: Text(label),
      );
}

class _IconButton extends StatelessWidget {
  const _IconButton({required this.icon, required this.tooltip, required this.onTap});
  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => IconButton(
        tooltip: tooltip,
        onPressed: onTap,
        icon: Icon(icon, color: _muted, size: 20),
        style: IconButton.styleFrom(backgroundColor: _raised, minimumSize: const Size(36, 36), fixedSize: const Size(36, 36), padding: EdgeInsets.zero),
      );
}

/// Lets the other ALT app on this phone sign in with this app's account ("Continue with ALTER"):
/// on each request, waits for the saved session to be restored (the request may have started the
/// app), asks the person with [showAltShareSignInSheet], and only then sends the handoff link.
/// [context] gives a context under the app's navigator; [onMessage] shows a short note.
void answerAltSignInRequests(AltHandoff handoff, {required BuildContext? Function() context, required void Function(String message) onMessage}) {
  final client = handoff.client;
  handoff.listenForSignInRequests((target, state) async {
    for (var i = 0; i < 40 && client.currentUser.value == null; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 250));
    }
    // Let the app settle on its first screen, so the card isn't swept away by a redirect.
    await Future<void>.delayed(const Duration(milliseconds: 600));
    final ctx = context();
    if (client.currentUser.value == null) {
      onMessage('Sign in to ${client.platform.label} first, then try again from ${target.label}.');
      return;
    }
    if (ctx == null || !ctx.mounted) return;
    if (!await showAltShareSignInSheet(ctx, client: client, target: target)) return;
    try {
      if (!await handoff.open(target, state: state)) onMessage('${target.label} could not be opened.');
    } on AltApiException catch (e) {
      onMessage(e.message);
    }
  });
}
