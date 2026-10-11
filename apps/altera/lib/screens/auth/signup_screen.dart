import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../config/app_config.dart';
import '../../providers/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/custom_button.dart';
import '../../widgets/custom_text_field.dart';

/// Creates an ALT account: one account that also works in ALTER and ALTAR.
/// Steps: profile basics → password (creates the account and emails a code) → confirm the code.
class SignupScreen extends ConsumerStatefulWidget {
  const SignupScreen({super.key});

  @override
  ConsumerState<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends ConsumerState<SignupScreen> {
  final _nameCtrl = TextEditingController();
  final _usernameCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  final _confirmPassCtrl = TextEditingController();
  final _otpCtrl = TextEditingController();

  bool _isLoading = false;
  bool _agreeToTerms = false;

  /// Set once the ALT account exists and is waiting for the email code.
  String? _registeredEmail;
  int _currentStep = 0;

  String? _nameError;
  String? _usernameError;
  String? _emailError;
  String? _passError;
  String? _confirmPassError;
  String? _otpError;

  @override
  void dispose() {
    _nameCtrl.dispose();
    _usernameCtrl.dispose();
    _emailCtrl.dispose();
    _passCtrl.dispose();
    _confirmPassCtrl.dispose();
    _otpCtrl.dispose();
    super.dispose();
  }

  void _snack(String message, {bool success = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: success ? AppColors.success : null),
    );
  }

  bool _validateProfileStep() {
    final name = _validateName(_nameCtrl.text.trim());
    final username = _validateUsername(_usernameCtrl.text.trim());
    final email = _validateEmail(_emailCtrl.text.trim());
    setState(() {
      _nameError = name;
      _usernameError = username;
      _emailError = email;
    });
    return name == null && username == null && email == null;
  }

  bool _validateSecurityStep() {
    final pass = _validatePassword(_passCtrl.text);
    final confirmPass = _validateConfirmPassword(_passCtrl.text, _confirmPassCtrl.text);
    setState(() {
      _passError = pass;
      _confirmPassError = confirmPass;
    });
    if (pass != null || confirmPass != null) return false;
    if (!_agreeToTerms) {
      _snack('Please agree to Terms & Conditions');
      return false;
    }
    return true;
  }

  void _goToSecurityStep() {
    if (!_validateProfileStep()) return;
    setState(() => _currentStep = 1);
  }

  /// Creates the ALT account; ALT Core emails a 6-digit code to confirm the address.
  Future<void> _createAccount() async {
    if (_registeredEmail != null) {
      setState(() => _currentStep = 2);
      return;
    }
    if (!_validateProfileStep()) {
      setState(() => _currentStep = 0);
      return;
    }
    if (!_validateSecurityStep()) return;

    setState(() => _isLoading = true);
    final result = await ref.read(authStateProvider.notifier).register(
          _emailCtrl.text.trim(),
          _passCtrl.text,
          _usernameCtrl.text.trim(),
          _nameCtrl.text.trim(),
        );
    if (!mounted) return;
    setState(() => _isLoading = false);

    if (result.verifyEmail != null) {
      setState(() {
        _registeredEmail = result.verifyEmail;
        _currentStep = 2;
        _otpError = null;
      });
      _snack('We sent a verification code to ${result.verifyEmail}', success: true);
      return;
    }

    final error = result.error ?? 'Sign-up failed. Please try again.';
    if (result.code == 'HANDLE_TAKEN') {
      setState(() {
        _usernameError = 'That username is taken';
        _currentStep = 0;
      });
    } else if (result.code == 'EMAIL_TAKEN') {
      setState(() {
        _emailError = 'An ALT account already uses this email. Sign in instead.';
        _currentStep = 0;
      });
    }
    _snack(error);
  }

  Future<void> _verifyAndFinish() async {
    final email = _registeredEmail;
    final otp = _otpCtrl.text.trim();
    if (email == null) return;
    if (otp.length != 6) {
      setState(() => _otpError = 'Enter the 6-digit verification code');
      return;
    }
    setState(() => _isLoading = true);
    final result = await ref.read(authStateProvider.notifier).verifyEmail(email, otp);
    if (!mounted) return;
    setState(() => _isLoading = false);
    if (result.success) {
      context.go('/feed');
      _snack('Welcome to ALTERA! Your ALT account also works in ALTER and ALTAR.', success: true);
    } else {
      setState(() => _otpError = result.error ?? 'That code is wrong or has expired.');
    }
  }

  Future<void> _resendCode() async {
    final email = _registeredEmail;
    if (email == null) return;
    setState(() => _isLoading = true);
    final result = await ref.read(authStateProvider.notifier).resendVerificationCode(email);
    if (!mounted) return;
    setState(() => _isLoading = false);
    _snack(result.success ? 'A new code is on its way to $email' : (result.error ?? 'Could not send a new code'),
        success: result.success);
  }

  Future<void> _continueWithGoogle() async {
    setState(() => _isLoading = true);
    final result = await ref.read(authStateProvider.notifier).continueWithGoogle();
    if (!mounted) return;
    setState(() => _isLoading = false);
    if (result.success) {
      context.go('/feed');
    } else if (result.error != null) {
      _snack(result.error!);
    }
  }

  String? _validateName(String? value) {
    final name = value?.trim() ?? '';
    if (name.isEmpty) return 'Name is required';
    if (name.length < 2) return 'Name must be at least 2 characters';
    if (name.length > 80) return 'Name must be at most 80 characters';
    return null;
  }

  String? _validateEmail(String? value) {
    final email = value?.trim() ?? '';
    if (email.isEmpty) return 'Email is required';
    if (email.contains(' ')) return 'Email cannot contain spaces';

    final parts = email.split('@');
    final local = parts[0];
    final domain = parts.length > 1 ? parts[1] : '';

    if (!email.contains('@')) return 'Missing @ symbol';
    if (local.isEmpty) return 'Text before @ is missing';
    if (domain.isEmpty) return 'Text after @ is missing';
    if (!domain.contains('.')) return 'Domain part must contain a dot (.)';

    final dotIndex = domain.lastIndexOf('.');
    final extension = domain.substring(dotIndex + 1);
    if (extension.length < 2) return 'Domain extension (e.g. .com) is too short';

    return null;
  }

  String? _validateUsername(String? value) {
    final username = value?.trim() ?? '';
    if (username.isEmpty) return 'Username is required';
    if (username.length < 3) return 'Username must be at least 3 characters';
    if (username.length > 30) return 'Username must be at most 30 characters';
    if (!RegExp(r'^[a-zA-Z0-9_]+$').hasMatch(username)) {
      return 'Use only letters, numbers, and underscores';
    }
    return null;
  }

  String? _validatePassword(String? value) {
    if (value == null || value.isEmpty) return 'Password is required';

    final missing = <String>[];
    if (value.length < 8) missing.add('8+ characters');
    if (!RegExp(r'[A-Z]').hasMatch(value)) missing.add('uppercase');
    if (!RegExp(r'[a-z]').hasMatch(value)) missing.add('lowercase');
    if (!RegExp(r'[0-9]').hasMatch(value)) missing.add('number');
    if (!RegExp(r"""[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]""").hasMatch(value)) {
      missing.add('special char');
    }

    if (missing.isNotEmpty) {
      return 'Requires: ${missing.join(", ")}';
    }
    return null;
  }

  String? _validateConfirmPassword(String? pass, String? confirmPass) {
    if (confirmPass == null || confirmPass.isEmpty) {
      return 'Please confirm password';
    }
    if (pass != confirmPass) return 'Passwords do not match';
    return null;
  }

  void _handleBack() {
    if (_currentStep == 0) {
      Navigator.of(context).pop();
      return;
    }
    // Once the account exists, going back would only offer to create it again.
    if (_currentStep == 2 && _registeredEmail != null) {
      Navigator.of(context).pop();
      return;
    }
    setState(() {
      _currentStep -= 1;
      _passError = null;
      _confirmPassError = null;
      _otpError = null;
    });
  }

  String get _stepTitle => 'Step ${_currentStep + 1} of 3';

  String get _headline {
    switch (_currentStep) {
      case 0:
        return 'Your profile basics';
      case 1:
        return 'Secure your account';
      default:
        return 'Verify your email';
    }
  }

  String get _subtitle {
    switch (_currentStep) {
      case 0:
        return 'This creates your ALT account. It works in ALTERA, ALTER and ALTAR.';
      case 1:
        return 'Choose a password. We will then email you a code to confirm your address.';
      default:
        return 'Enter the code we sent to ${_registeredEmail ?? 'your email'}.';
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, size: 20),
          onPressed: _isLoading ? null : _handleBack,
        ),
        title: const Text('Create Account'),
        centerTitle: true,
        elevation: 0,
      ),
      body: Stack(
        children: [
          if (isDark)
            Positioned(
              bottom: -50,
              left: -50,
              child: Container(
                width: 250,
                height: 250,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppColors.primary.withValues(alpha: 0.05),
                ),
              ),
            ),
          SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _stepTitle,
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          color: AppColors.primary,
                          fontWeight: FontWeight.w700,
                        ),
                  ),
                  const SizedBox(height: 12),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(999),
                    child: LinearProgressIndicator(
                      value: (_currentStep + 1) / 3,
                      minHeight: 8,
                      backgroundColor: isDark ? AppColors.surfaceDark : AppColors.border,
                      valueColor: const AlwaysStoppedAnimation<Color>(AppColors.primary),
                    ),
                  ),
                  const SizedBox(height: 24),
                  Text(_headline, style: Theme.of(context).textTheme.headlineMedium),
                  const SizedBox(height: 8),
                  Text(_subtitle, style: Theme.of(context).textTheme.bodyMedium),
                  const SizedBox(height: 28),
                  AnimatedSwitcher(
                    duration: const Duration(milliseconds: 250),
                    child: _buildStepContent(isDark),
                  ),
                  const SizedBox(height: 24),
                  if (_currentStep == 0 && AppConfig.isGoogleSignInConfigured) ...[
                    Row(
                      children: [
                        Expanded(child: Divider(color: Theme.of(context).dividerColor)),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          child: Text('or', style: Theme.of(context).textTheme.bodySmall),
                        ),
                        Expanded(child: Divider(color: Theme.of(context).dividerColor)),
                      ],
                    ),
                    const SizedBox(height: 20),
                    Center(child: _buildSocialButton(Icons.g_translate, 'Google')),
                    const SizedBox(height: 24),
                  ],
                  Center(
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text('Already have an ALT account? ', style: Theme.of(context).textTheme.bodyMedium),
                        TextButton(
                          onPressed: !_isLoading ? () => context.pop() : null,
                          child: const Text('Sign In'),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStepContent(bool isDark) {
    switch (_currentStep) {
      case 0:
        return _buildProfileStep();
      case 1:
        return _buildSecurityStep(isDark);
      default:
        return _buildVerificationStep();
    }
  }

  Widget _buildProfileStep() {
    return Column(
      key: const ValueKey('signup-step-profile'),
      children: [
        AlteraTextField(
          label: 'Full Name',
          hint: 'Enter your full name',
          controller: _nameCtrl,
          prefixIcon: Icons.person_outline,
          errorText: _nameError,
          enabled: !_isLoading,
        ),
        const SizedBox(height: 20),
        AlteraTextField(
          label: 'Username',
          hint: 'Choose a unique username',
          controller: _usernameCtrl,
          prefixIcon: Icons.alternate_email,
          errorText: _usernameError,
          enabled: !_isLoading,
        ),
        const SizedBox(height: 20),
        AlteraTextField(
          label: 'Email Address',
          hint: 'Enter your email',
          controller: _emailCtrl,
          keyboardType: TextInputType.emailAddress,
          prefixIcon: Icons.mail_outline,
          errorText: _emailError,
          enabled: !_isLoading,
        ),
        const SizedBox(height: 24),
        AlteraButton(
          label: 'Continue',
          onPressed: _goToSecurityStep,
          isLoading: _isLoading,
          isEnabled: !_isLoading,
          fullWidth: true,
          icon: Icons.arrow_forward,
        ),
      ],
    );
  }

  Widget _buildSecurityStep(bool isDark) {
    return Column(
      key: const ValueKey('signup-step-security'),
      children: [
        AlteraTextField(
          label: 'Password',
          hint: 'At least 8 characters',
          controller: _passCtrl,
          obscureText: true,
          prefixIcon: Icons.lock_outline,
          errorText: _passError,
          enabled: !_isLoading,
        ),
        const SizedBox(height: 20),
        AlteraTextField(
          label: 'Confirm Password',
          hint: 'Re-enter your password',
          controller: _confirmPassCtrl,
          obscureText: true,
          prefixIcon: Icons.lock_outline,
          errorText: _confirmPassError,
          enabled: !_isLoading,
        ),
        const SizedBox(height: 24),
        CheckboxListTile(
          value: _agreeToTerms,
          onChanged: !_isLoading ? (v) => setState(() => _agreeToTerms = v ?? false) : null,
          controlAffinity: ListTileControlAffinity.leading,
          contentPadding: EdgeInsets.zero,
          title: Text.rich(
            TextSpan(
              text: 'I agree to the ',
              style: Theme.of(context).textTheme.bodySmall,
              children: [
                TextSpan(
                  text: 'Terms & Conditions',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: AppColors.primary,
                        fontWeight: FontWeight.w600,
                      ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 24),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: !_isLoading ? () => setState(() => _currentStep = 0) : null,
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  side: BorderSide(color: isDark ? AppColors.borderDark : AppColors.border),
                ),
                child: const Text('Back'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: AlteraButton(
                label: 'Create Account',
                onPressed: _createAccount,
                isLoading: _isLoading,
                isEnabled: !_isLoading,
                fullWidth: true,
                icon: Icons.person_add,
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildVerificationStep() {
    return Column(
      key: const ValueKey('signup-step-verification'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.primary.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.primary.withValues(alpha: 0.15)),
          ),
          child: Row(
            children: [
              const Icon(Icons.mail_outline, color: AppColors.primary),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  _registeredEmail ?? _emailCtrl.text.trim(),
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        AlteraTextField(
          label: 'Email Verification Code',
          hint: 'Enter the 6-digit code',
          controller: _otpCtrl,
          keyboardType: TextInputType.number,
          maxLength: 6,
          prefixIcon: Icons.verified_user_outlined,
          errorText: _otpError,
          enabled: !_isLoading,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 16),
        AlteraButton(
          label: 'Verify & Finish',
          onPressed: _verifyAndFinish,
          isLoading: _isLoading,
          isEnabled: !_isLoading,
          fullWidth: true,
          icon: Icons.verified_outlined,
        ),
        const SizedBox(height: 8),
        Center(
          child: TextButton.icon(
            onPressed: _isLoading ? null : _resendCode,
            icon: const Icon(Icons.mark_email_unread_outlined, size: 18),
            label: const Text('Send a new code'),
          ),
        ),
      ],
    );
  }

  Widget _buildSocialButton(IconData icon, String label) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final Widget iconWidget = label == 'Google'
        ? Image.asset('assets/images/google_logo.png', width: 18, height: 18, fit: BoxFit.contain)
        : Icon(icon, size: 18);

    return OutlinedButton.icon(
      onPressed: !_isLoading ? _continueWithGoogle : null,
      icon: iconWidget,
      label: Text('Continue with $label'),
      style: OutlinedButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        side: BorderSide(color: isDark ? AppColors.borderDark : AppColors.border),
        backgroundColor: isDark ? AppColors.surfaceDark : null,
      ),
    );
  }
}
