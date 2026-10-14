import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/alt/alt_session.dart';
import '../../../core/theme/ds.dart';
import '../../../shared/ui/ui.dart';

/// Sign in to (or create) the ALT account. The same account works in ALTERA and ALTAR.
class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  bool _creating = false;
  bool _busy = false;
  // On phones the ALT Account window is the main way in; the form here is the fallback.
  bool _manual = !AltAccountWindow.supported;
  bool _obscure = true;
  final _form = GlobalKey<FormState>();
  final _identifier = TextEditingController();
  final _name = TextEditingController();
  final _handle = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();

  @override
  void dispose() {
    for (final c in [_identifier, _name, _handle, _email, _password]) {
      c.dispose();
    }
    super.dispose();
  }

  void _toast(String message) => toast(context, message);

  Future<void> _run(Future<void> Function() action) async {
    if (!(_form.currentState?.validate() ?? false)) return;
    setState(() => _busy = true);
    try {
      await action();
    } on AltApiException catch (e) {
      _toast(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Handles every sign-in outcome: done, needs a 2FA code, or needs the email code.
  Future<void> _finish(SignInResult result) async {
    switch (result) {
      case SignedIn():
        if (mounted) context.go('/');
      case TwoFactorRequired(:final mfaToken):
        final entered = await showAltCodeDialog(
          context,
          title: 'Two-factor authentication',
          message: 'Enter the 6-digit code from your authenticator app.',
          allowRecoveryCode: true,
        );
        if (entered == null) return;
        await altAccount.completeTwoFactor(
          mfaToken,
          code: entered.recovery ? null : entered.code,
          recoveryCode: entered.recovery ? entered.code : null,
        );
        if (mounted) context.go('/');
      case EmailNotVerified(:final email):
        await _confirmEmail(email);
    }
  }

  Future<void> _confirmEmail(String email) async {
    final entered = await showAltCodeDialog(
      context,
      title: 'Verify your email',
      message: 'We sent a 6-digit code to $email.',
      onResend: () => altAccount.resendEmailCode(email),
    );
    if (entered == null) return;
    await _finish(await altAccount.verifyEmail(email, entered.code));
  }

  Future<void> _signIn() => _run(() async => _finish(await altAccount.signIn(_identifier.text, _password.text)));

  Future<void> _createAccount() => _run(() async {
        await altAccount.register(
          email: _email.text,
          password: _password.text,
          handle: _handle.text,
          displayName: _name.text,
          roles: const ['creator'],
        );
        await _confirmEmail(_email.text.trim());
      });

  Future<void> _forgotPassword() async {
    final email = TextEditingController(text: _identifier.text.contains('@') ? _identifier.text.trim() : '');
    final send = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Reset your password'),
        content: TextField(controller: email, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'Account email')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Send code')),
        ],
      ),
    );
    if (send != true || !mounted) return;
    try {
      await altAccount.forgotPassword(email.text);
      if (!mounted) return;
      final code = await showAltCodeDialog(context, title: 'Check your email', message: 'If an ALT account uses ${email.text.trim()}, we sent it a code.');
      if (code == null || !mounted) return;
      final next = TextEditingController();
      final save = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('New password'),
          content: TextField(
            controller: next,
            obscureText: true,
            decoration: const InputDecoration(labelText: 'New password', helperText: 'At least 8 characters, a letter and a number'),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save')),
          ],
        ),
      );
      if (save != true) return;
      await altAccount.resetPassword(email: email.text, code: code.code, newPassword: next.text);
      _toast('Password changed. Sign in with your new password.');
    } on AltApiException catch (e) {
      _toast(e.message);
    }
  }

  /// "Continue with ALT": the ALT sign-in card slides up over ALTER (accounts on this phone, the
  /// password and any code, or "Continue with ALTERA"). Creating an account opens the ALT Account
  /// window, which comes back through alter://handoff (main.dart turns that into a session).
  Future<void> _openAltWindow({bool signUp = false}) async {
    if (!signUp) {
      final user = await showAltSignInSheet(context, client: altAccount, handoff: altHandoff);
      if (user != null && mounted) context.go('/');
      return;
    }
    if (!await AltAccountWindow.open(altAccount, signUp: signUp) && mounted) {
      _toast('Couldn’t open the ALT sign-in window. Use your email and password here instead.');
      setState(() => _manual = true);
    }
  }

  String? _required(String? v) => (v == null || v.trim().isEmpty) ? 'Required' : null;

  @override
  Widget build(BuildContext context) {
    return Backdrop(
      animate: true,
      intensity: 1,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(24, 24, 24, 24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  const Center(child: AlterMark(size: 64)),
                  const SizedBox(height: 18),
                  Center(child: Text('ALTER', style: Ds.overline.copyWith(fontSize: 13, letterSpacing: 7, color: Ds.textSecondary))),
                  const SizedBox(height: 28),
                  Text(_creating ? 'Create your\ndigital twin.' : 'Your digital twin,\nverified.', textAlign: TextAlign.center, style: Ds.display),
                  const SizedBox(height: 12),
                  Text(
                    _creating ? 'One ALT account for ALTER, ALTERA and ALTAR.' : 'Sign in with your ALT account.',
                    textAlign: TextAlign.center,
                    style: Ds.callout,
                  ),
                  const SizedBox(height: 32),
                  if (!_manual) ...[
                    ContinueWithAltButton(onPressed: _openAltWindow),
                    const SizedBox(height: 12),
                    Btn('Create an ALT account', kind: BtnKind.secondary, expand: true, onTap: () => _openAltWindow(signUp: true)),
                  ] else ...[
                    AnimatedSize(
                      duration: Ds.calm,
                      curve: Ds.ease,
                      child: Glass(
                        padding: const EdgeInsets.all(18),
                        radius: Ds.r4 - 4,
                        child: Form(
                          key: _form,
                          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: _creating ? _createFields() : _signInFields()),
                        ),
                      ),
                    ),
                    const SizedBox(height: 18),
                    Center(
                      child: Pressable(
                        onTap: _busy ? null : () => setState(() => _creating = !_creating),
                        child: Padding(
                          padding: const EdgeInsets.all(8),
                          child: Text.rich(
                            TextSpan(children: [
                              TextSpan(text: _creating ? 'Already have an ALT account?  ' : 'New to ALT?  ', style: Ds.callout),
                              TextSpan(text: _creating ? 'Sign in' : 'Create an account', style: Ds.callout.copyWith(color: Ds.text, fontWeight: FontWeight.w600)),
                            ]),
                          ),
                        ),
                      ),
                    ),
                  ],
                  const SizedBox(height: 28),
                  Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                    const Icon(Icons.lock_outline_rounded, size: 13, color: Ds.textTertiary),
                    const SizedBox(width: 6),
                    Flexible(child: Text('One account · ALTER · ALTERA · ALTAR', textAlign: TextAlign.center, style: Ds.caption.copyWith(color: Ds.textTertiary))),
                  ]),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _passwordField() => TextFormField(
        controller: _password,
        obscureText: _obscure,
        textInputAction: TextInputAction.done,
        onFieldSubmitted: (_) => _busy ? null : (_creating ? _createAccount() : _signIn()),
        enabled: !_busy,
        style: Ds.body,
        validator: (v) {
          if (v == null || v.isEmpty) return 'Required';
          if (_creating && (v.length < 8 || !RegExp(r'[A-Za-z]').hasMatch(v) || !RegExp(r'\d').hasMatch(v))) {
            return 'At least 8 characters, with a letter and a number';
          }
          return null;
        },
        decoration: InputDecoration(
          hintText: 'Password',
          prefixIcon: const Icon(Icons.lock_outline_rounded, size: 20),
          suffixIcon: IconButton(
            icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined, size: 20),
            onPressed: () => setState(() => _obscure = !_obscure),
          ),
        ),
      );

  Widget _submit(String label, VoidCallback onPressed) => Padding(
        padding: const EdgeInsets.only(top: 18),
        child: Btn(label, expand: true, loading: _busy, onTap: _busy ? null : onPressed),
      );

  List<Widget> _signInFields() => [
        TextFormField(
          controller: _identifier,
          enabled: !_busy,
          validator: _required,
          style: Ds.body,
          keyboardType: TextInputType.emailAddress,
          textInputAction: TextInputAction.next,
          decoration: const InputDecoration(hintText: 'Email or @handle', prefixIcon: Icon(Icons.person_outline_rounded, size: 20)),
        ),
        const SizedBox(height: 12),
        _passwordField(),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton(onPressed: _busy ? null : _forgotPassword, child: Text('Forgot password?', style: Ds.caption.copyWith(color: Ds.textSecondary))),
        ),
        _submit('Sign in', _signIn),
      ];

  List<Widget> _createFields() => [
        TextFormField(
          controller: _name,
          enabled: !_busy,
          validator: _required,
          style: Ds.body,
          decoration: const InputDecoration(hintText: 'Your name', prefixIcon: Icon(Icons.badge_outlined, size: 20)),
        ),
        const SizedBox(height: 12),
        TextFormField(
          controller: _handle,
          enabled: !_busy,
          style: Ds.body,
          validator: (v) => RegExp(r'^[A-Za-z0-9_.]{3,30}$').hasMatch(v?.trim() ?? '') ? null : '3-30 letters, numbers, _ or .',
          decoration: const InputDecoration(hintText: 'Handle', prefixIcon: Icon(Icons.alternate_email_rounded, size: 20)),
        ),
        const SizedBox(height: 12),
        TextFormField(
          controller: _email,
          enabled: !_busy,
          style: Ds.body,
          keyboardType: TextInputType.emailAddress,
          validator: (v) => RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(v?.trim() ?? '') ? null : 'Enter a valid email',
          decoration: const InputDecoration(hintText: 'Email', prefixIcon: Icon(Icons.mail_outline_rounded, size: 20)),
        ),
        const SizedBox(height: 12),
        _passwordField(),
        _submit('Create account', _createAccount),
      ];
}
