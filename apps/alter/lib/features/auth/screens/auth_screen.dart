import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/alt/alt_session.dart';
import '../../../core/theme/colors.dart';
import '../../../core/theme/gradients.dart';
import '../../../core/theme/typography.dart';
import '../../../shared/widgets/gradient_background.dart';

/// Sign in to (or create) the ALT account. The same account works in ALTERA and ALTAR.
class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  bool _creating = false;
  bool _busy = false;
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

  void _toast(String message) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));

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

  String? _required(String? v) => (v == null || v.trim().isEmpty) ? 'Required' : null;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final surface = isDark ? ALTColors.darkBgSurface01 : ALTColors.lightBgPage;
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: GradientBackground(
        baseColor: isDark ? ALTColors.darkBgPage : ALTColors.lightBgPage,
        layers: isDark ? ALTGradients.alterDark : ALTGradients.alterLight,
        animate: true,
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Icon(Icons.psychology_alt_rounded, size: 56, color: ALTColors.irisViolet),
                    const SizedBox(height: 12),
                    const Text('ALTER', textAlign: TextAlign.center, style: ALTTypography.displayMedium),
                    const SizedBox(height: 6),
                    Text(
                      _creating ? 'Create your ALT account and your personal AI.' : 'Sign in with your ALT account.',
                      textAlign: TextAlign.center,
                      style: ALTTypography.bodyMedium,
                    ),
                    const SizedBox(height: 24),
                    Container(
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        color: surface.withValues(alpha: 0.85),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: isDark ? ALTColors.darkBorderSubtle : ALTColors.lightBorderSubtle),
                      ),
                      child: Form(
                        key: _form,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: _creating ? _createFields() : _signInFields(),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextButton(
                      onPressed: _busy ? null : () => setState(() => _creating = !_creating),
                      child: Text(_creating ? 'I already have an ALT account' : 'New here? Create an ALT account'),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'One ALT account works in ALTER, ALTERA and ALTAR.',
                      textAlign: TextAlign.center,
                      style: ALTTypography.bodySmall.copyWith(color: isDark ? ALTColors.darkTextMuted : ALTColors.lightTextMuted),
                    ),
                  ],
                ),
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
        enabled: !_busy,
        validator: (v) {
          if (v == null || v.isEmpty) return 'Required';
          if (_creating && (v.length < 8 || !RegExp(r'[A-Za-z]').hasMatch(v) || !RegExp(r'\d').hasMatch(v))) {
            return 'At least 8 characters, with a letter and a number';
          }
          return null;
        },
        decoration: InputDecoration(
          labelText: 'Password',
          prefixIcon: const Icon(Icons.lock_outline),
          suffixIcon: IconButton(
            icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
            onPressed: () => setState(() => _obscure = !_obscure),
          ),
        ),
      );

  Widget _submit(String label, VoidCallback onPressed) => Padding(
        padding: const EdgeInsets.only(top: 20),
        child: FilledButton(
          style: FilledButton.styleFrom(backgroundColor: ALTColors.irisViolet, padding: const EdgeInsets.symmetric(vertical: 16)),
          onPressed: _busy ? null : onPressed,
          child: _busy
              ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : Text(label),
        ),
      );

  List<Widget> _signInFields() => [
        TextFormField(
          controller: _identifier,
          enabled: !_busy,
          validator: _required,
          keyboardType: TextInputType.emailAddress,
          decoration: const InputDecoration(labelText: 'Email or @handle', prefixIcon: Icon(Icons.person_outline)),
        ),
        const SizedBox(height: 12),
        _passwordField(),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton(onPressed: _busy ? null : _forgotPassword, child: const Text('Forgot password?')),
        ),
        _submit('Sign in', _signIn),
      ];

  List<Widget> _createFields() => [
        TextFormField(
          controller: _name,
          enabled: !_busy,
          validator: _required,
          decoration: const InputDecoration(labelText: 'Your name', prefixIcon: Icon(Icons.badge_outlined)),
        ),
        const SizedBox(height: 12),
        TextFormField(
          controller: _handle,
          enabled: !_busy,
          validator: (v) =>
              RegExp(r'^[A-Za-z0-9_.]{3,30}$').hasMatch(v?.trim() ?? '') ? null : '3-30 letters, numbers, _ or .',
          decoration: const InputDecoration(labelText: 'Handle', prefixText: '@', prefixIcon: Icon(Icons.alternate_email)),
        ),
        const SizedBox(height: 12),
        TextFormField(
          controller: _email,
          enabled: !_busy,
          keyboardType: TextInputType.emailAddress,
          validator: (v) => RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(v?.trim() ?? '') ? null : 'Enter a valid email',
          decoration: const InputDecoration(labelText: 'Email', prefixIcon: Icon(Icons.mail_outline)),
        ),
        const SizedBox(height: 12),
        _passwordField(),
        _submit('Create account', _createAccount),
      ];
}
