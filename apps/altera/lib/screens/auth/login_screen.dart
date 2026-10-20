import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../config/app_config.dart';
import '../../providers/auth_provider.dart';
import '../../services/auth_service.dart';
import '../../theme/app_theme.dart';
import '../../widgets/custom_button.dart';
import '../../widgets/custom_text_field.dart';
import 'forgot_password_screen.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  bool _isLoading = false;
  // On phones the ALT Account window is the main way in; this form is the fallback.
  bool _manual = !AltAccountWindow.supported;
  String? _emailError;
  String? _passError;

  @override
  void dispose() {
    _emailCtrl.dispose();
    _passCtrl.dispose();
    super.dispose();
  }

  void _login() async {
    final email = _emailCtrl.text.trim();
    final password = _passCtrl.text;
    final emailError = _validateEmail(email);
    final passwordError = _validatePassword(password);

    if (emailError != null || passwordError != null) {
      setState(() {
        _emailError = emailError;
        _passError = passwordError;
      });
      return;
    }

    setState(() {
      _emailError = null;
      _passError = null;
      _isLoading = true;
    });

    try {
      final notifier = ref.read(authStateProvider.notifier);
      var result = await notifier.login(email, password);
      if (!mounted) return;

      if (result.mfaToken != null) {
        // Two-factor authentication is on: ask for the authenticator (or recovery) code.
        final entered = await showAltCodeDialog(
          context,
          title: 'Two-factor authentication',
          message: 'Enter the 6-digit code from your authenticator app.',
          allowRecoveryCode: true,
        );
        if (entered == null || !mounted) return;
        result = await notifier.completeTwoFactor(
          result.mfaToken!,
          code: entered.recovery ? null : entered.code,
          recoveryCode: entered.recovery ? entered.code : null,
        );
      } else if (result.verifyEmail != null) {
        // The ALT account exists but its email was never confirmed; a fresh code was just sent.
        result = await _confirmEmail(result.verifyEmail!);
      }

      if (!mounted) return;
      if (result.success) {
        context.go('/feed');
      } else if (result.error != null) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(result.error!)));
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error: $e')),
      );
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  Future<AuthResult> _confirmEmail(String email) async {
    final notifier = ref.read(authStateProvider.notifier);
    final entered = await showAltCodeDialog(
      context,
      title: 'Verify your email',
      message: 'We sent a 6-digit code to $email.',
      onResend: () => notifier.resendVerificationCode(email),
    );
    if (entered == null) return AuthResult.failure('Verify your email to continue.');
    return notifier.verifyEmail(email, entered.code);
  }

  Future<void> _continueWithGoogle() async {
    setState(() => _isLoading = true);
    final result =
        await ref.read(authStateProvider.notifier).continueWithGoogle();
    if (!mounted) return;

    if (result.success) {
      if (result.isNewUser) {
        setState(() => _isLoading = false);
        _showSetPasswordDialog();
      } else {
        context.go('/feed');
      }
    } else {
      if (result.error != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(result.error!)),
        );
      }
      setState(() => _isLoading = false);
    }
  }

  void _showSetPasswordDialog() {
    final passCtrl = TextEditingController();
    bool isSettingPass = false;
    String? error;

    showDialog(
      context: context,
      barrierDismissible: false, // Force them to choose save or skip
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) {
          return AlertDialog(
            title: const Text('Set Password'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('Please set a password to complete your account setup. This will allow you to login with email and password in the future.'),
                const SizedBox(height: 16),
                AlteraTextField(
                  label: 'Password',
                  hint: 'At least 8 characters',
                  controller: passCtrl,
                  obscureText: true,
                  prefixIcon: Icons.lock_outline,
                  enabled: !isSettingPass,
                  errorText: error,
                ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: isSettingPass
                    ? null
                    : () {
                        Navigator.pop(ctx);
                        context.go('/feed');
                      },
                child: const Text('Skip'),
              ),
              ElevatedButton(
                onPressed: isSettingPass
                    ? null
                    : () async {
                        final pass = passCtrl.text;
                        if (pass.length < 8) {
                          setDialogState(() => error = 'Password must be at least 8 characters');
                          return;
                        }
                        setDialogState(() {
                          isSettingPass = true;
                          error = null;
                        });

                        final success = await ref.read(authStateProvider.notifier).setInitialPassword(pass);
                        if (!ctx.mounted) return;

                        if (success) {
                          Navigator.pop(ctx);
                          context.go('/feed');
                        } else {
                          setDialogState(() {
                            isSettingPass = false;
                            error = ref.read(authStateProvider).error ?? 'Failed to set password';
                          });
                        }
                      },
                child: isSettingPass
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Save'),
              ),
            ],
          );
        },
      ),
    );
  }


  String? _validateEmail(String? value) {
    // Either the email or the @handle of the ALT account.
    final identifier = value?.trim() ?? '';
    if (identifier.isEmpty) return 'Email or username is required';
    return null;
  }

  String? _validatePassword(String? value) {
    if (value == null || value.trim().isEmpty) return 'Password is required';
    return null;
  }

  /// "Continue with ALT": the ALT sign-in card slides up over ALTERA (accounts on this phone, the
  /// password and any code, or "Continue with ALTER"). Creating an account opens the ALT Account
  /// window, which comes back through altera://handoff (app.dart turns that into a session).
  Future<void> _openAltWindow({bool signUp = false}) async {
    final auth = ref.read(authServiceProvider);
    if (!signUp) {
      final user = await showAltSignInSheet(context, client: auth.alt, handoff: auth.handoff);
      if (user == null || !mounted) return;
      final result = await ref.read(authStateProvider.notifier).adoptSession();
      if (result.success && mounted) context.go('/feed');
      return;
    }
    final opened = await AltAccountWindow.open(auth.alt, signUp: signUp);
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Couldn’t open the ALT sign-in window. Use your email and password instead.')),
      );
      setState(() => _manual = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      body: Stack(
        children: [
          if (isDark)
            Positioned(
              top: -100,
              right: -100,
              child: Container(
                width: 300,
                height: 300,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppColors.primary.withOpacity(0.05),
                ),
              ),
            ),
          SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  SizedBox(height: MediaQuery.of(context).size.height * 0.08),

                  // Logo/Branding
                  AltLogo(AltLogoKind.altera, size: 84, brightness: isDark ? Brightness.dark : Brightness.light),
                  const SizedBox(height: 14),
                  ShaderMask(
                    shaderCallback: (bounds) => LinearGradient(
                      colors: AppColors.primaryGradient,
                    ).createShader(bounds),
                    child: const Text(
                      'Altera',
                      style: TextStyle(
                        fontSize: 44,
                        fontWeight: FontWeight.w700,
                        color: Colors.white,
                        letterSpacing: -1,
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'AI-Powered Social Hub',
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  SizedBox(height: MediaQuery.of(context).size.height * 0.06),

                  if (!_manual) ...[
                    ContinueWithAltButton(onPressed: _openAltWindow),
                    const SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      height: 52,
                      child: OutlinedButton(
                        onPressed: () => _openAltWindow(signUp: true),
                        style: OutlinedButton.styleFrom(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))),
                        child: const Text('Create an ALT account'),
                      ),
                    ),
                  ] else
                  // Form
                  Form(
                    key: _formKey,
                    child: Column(
                      children: [
                        // Email Field
                        AlteraTextField(
                          label: 'Email or username',
                          hint: 'Your ALT account email or @handle',
                          controller: _emailCtrl,
                          keyboardType: TextInputType.emailAddress,
                          prefixIcon: Icons.mail_outline,
                          validator: _validateEmail,
                          errorText: _emailError,
                          enabled: !_isLoading,
                        ),
                        const SizedBox(height: 20),

                        // Password Field
                        AlteraTextField(
                          label: 'Password',
                          hint: 'Enter your password',
                          controller: _passCtrl,
                          obscureText: true,
                          prefixIcon: Icons.lock_outline,
                          validator: _validatePassword,
                          errorText: _passError,
                          enabled: !_isLoading,
                        ),
                        const SizedBox(height: 16),

                        // Forgot Password
                        Align(
                          alignment: Alignment.centerRight,
                          child: TextButton(
                            onPressed: !_isLoading
                                ? () {
                                    Navigator.of(context).push(
                                      MaterialPageRoute(
                                        builder: (context) =>
                                            const ForgotPasswordScreen(),
                                      ),
                                    );
                                  }
                                : null,
                            child: const Text('Forgot Password?'),
                          ),
                        ),
                        const SizedBox(height: 24),

                        // Login Button
                        AlteraButton(
                          label: 'Sign In',
                          onPressed: _login,
                          isLoading: _isLoading,
                          isEnabled: !_isLoading,
                          fullWidth: true,
                          icon: Icons.login,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 32),

                  // Google sign-in appears only when a Google client is configured for ALT Core.
                  if (AppConfig.isGoogleSignInConfigured) ...[
                  Row(
                    children: [
                      Expanded(
                          child:
                              Divider(color: Theme.of(context).dividerColor)),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        child: Text(
                          'or',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ),
                      Expanded(
                          child:
                              Divider(color: Theme.of(context).dividerColor)),
                    ],
                  ),
                  const SizedBox(height: 24),

                  // Social Login
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      _buildSocialButton(Icons.g_translate, 'Google'),
                    ],
                  ),
                  ],
                  SizedBox(height: MediaQuery.of(context).size.height * 0.06),

                  // Signup Link
                  if (_manual)
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        "Don't have an account? ",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                      TextButton(
                        onPressed:
                            !_isLoading ? () => context.push('/signup') : null,
                        child: const Text('Sign Up'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSocialButton(IconData icon, String label) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final Widget iconWidget = label == 'Google'
        ? Image.asset(
            'assets/images/google_logo.png',
            width: 18,
            height: 18,
            fit: BoxFit.contain,
          )
        : Icon(icon, size: 18);

    return OutlinedButton.icon(
      onPressed: !_isLoading ? _continueWithGoogle : null,
      icon: iconWidget,
      label: Text('Continue with $label'),
      style: OutlinedButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        side:
            BorderSide(color: isDark ? AppColors.borderDark : AppColors.border),
        backgroundColor: isDark ? AppColors.surfaceDark : null,
      ),
    );
  }
}
