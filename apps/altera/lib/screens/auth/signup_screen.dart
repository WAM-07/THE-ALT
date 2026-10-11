import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/custom_button.dart';
import '../../widgets/custom_text_field.dart';

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
  bool _otpRequested = false;
  bool _emailVerified = false;
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

  bool _validateProfileStep() {
    final trimmedName = _nameCtrl.text.trim();
    final trimmedUsername = _usernameCtrl.text.trim();
    final trimmedEmail = _emailCtrl.text.trim();

    final name = _validateName(trimmedName);
    final username = _validateUsername(trimmedUsername);
    final email = _validateEmail(trimmedEmail);

    setState(() {
      _nameError = name;
      _usernameError = username;
      _emailError = email;
      _otpError = null;
    });

    return name == null && username == null && email == null;
  }

  bool _validateEmailOnly() {
    final trimmedEmail = _emailCtrl.text.trim();
    final email = _validateEmail(trimmedEmail);
    setState(() {
      _emailError = email;
      _otpError = null;
    });
    return email == null;
  }

  bool _validateSecurityStep() {
    final password = _passCtrl.text;
    final confirmPassword = _confirmPassCtrl.text;

    final pass = _validatePassword(password);
    final confirmPass = _validateConfirmPassword(password, confirmPassword);

    setState(() {
      _passError = pass;
      _confirmPassError = confirmPass;
    });

    if (pass != null || confirmPass != null) return false;

    if (!_agreeToTerms) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please agree to Terms & Conditions')),
      );
      return false;
    }

    return true;
  }

  Future<void> _goToVerificationStep() async {
    if (!_validateProfileStep()) return;
    setState(() => _currentStep = 1);
    if (!_otpRequested) {
      await _requestOtp();
    }
  }

  void _goToSecurityStep() {
    if (!_emailVerified) {
      setState(() => _otpError = 'Please verify your email first');
      return;
    }
    setState(() => _currentStep = 2);
  }

  Future<void> _requestOtp() async {
    final trimmedEmail = _emailCtrl.text.trim();
    final trimmedUsername = _usernameCtrl.text.trim();
    if (!_validateEmailOnly()) return;

    setState(() => _isLoading = true);

    try {
      final result = await ref.read(authServiceProvider).requestOtp(
            trimmedEmail,
            username: trimmedUsername,
          );
      if (!mounted) return;

      if (!result.success) {
        final error = result.error ?? 'Failed to send verification code.';
        if (error.toLowerCase().contains('username')) {
          setState(() {
            _usernameError = error;
            _currentStep = 0;
          });
        }
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(error),
          ),
        );
        return;
      }

      setState(() {
        _otpRequested = true;
        _emailVerified = false;
        _otpError = null;
      });

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Verification code sent to $trimmedEmail'),
          backgroundColor: AppColors.success,
        ),
      );
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

  Future<void> _verifyEmail() async {
    final trimmedEmail = _emailCtrl.text.trim();
    final otp = _otpCtrl.text.trim();

    if (!_validateEmailOnly()) return;
    if (otp.length != 6) {
      setState(() => _otpError = 'Enter the 6-digit verification code');
      return;
    }

    setState(() => _isLoading = true);
    try {
      final result =
          await ref.read(authServiceProvider).verifyOtp(trimmedEmail, otp);
      if (!mounted) return;

      if (!result.success) {
        setState(() => _otpError = result.error ?? 'Invalid OTP');
        return;
      }

      setState(() {
        _emailVerified = true;
        _otpError = null;
        _currentStep = 2;
      });

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Email verified successfully'),
          backgroundColor: AppColors.success,
        ),
      );
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

  Future<void> _signup() async {
    final trimmedName = _nameCtrl.text.trim();
    final trimmedUsername = _usernameCtrl.text.trim();
    final trimmedEmail = _emailCtrl.text.trim();
    final password = _passCtrl.text;

    if (!_validateProfileStep()) {
      setState(() => _currentStep = 0);
      return;
    }

    if (!_emailVerified) {
      setState(() {
        _currentStep = 1;
        _otpError = 'Please verify your email first';
      });
      return;
    }

    if (!_validateSecurityStep()) return;

    setState(() => _isLoading = true);

    try {
      final success = await ref.read(authStateProvider.notifier).register(
            trimmedEmail,
            password,
            trimmedUsername,
            trimmedName,
          );

      if (!mounted) return;

      if (success) {
        context.go('/feed');
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Account created successfully!'),
            backgroundColor: AppColors.success,
          ),
        );
      } else {
        final error =
            ref.read(authStateProvider).error ?? 'Signup failed. Please try again.';
        if (error.toLowerCase().contains('username')) {
          setState(() {
            _usernameError = error;
            _currentStep = 0;
          });
        }
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(error),
          ),
        );
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
      barrierDismissible: false,
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

  String? _validateName(String? value) {
    final name = value?.trim() ?? '';
    if (name.isEmpty) return 'Name is required';
    if (name.length < 2) return 'Name must be at least 2 characters';
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
    if (extension.length < 2)
      return 'Domain extension (e.g. .com) is too short';

    return null;
  }

  String? _validateUsername(String? value) {
    final username = value?.trim() ?? '';
    if (username.isEmpty) return 'Username is required';
    if (username.length < 3) return 'Username must be at least 3 characters';
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

    setState(() {
      _currentStep -= 1;
      _nameError = null;
      _usernameError = null;
      _emailError = null;
      _passError = null;
      _confirmPassError = null;
      _otpError = null;
    });
  }

  String get _stepTitle {
    switch (_currentStep) {
      case 0:
        return 'Step 1 of 3';
      case 1:
        return 'Step 2 of 3';
      default:
        return 'Step 3 of 3';
    }
  }

  String get _headline {
    switch (_currentStep) {
      case 0:
        return 'Your profile basics';
      case 1:
        return 'Verify your email';
      default:
        return 'Secure your account';
    }
  }

  String get _subtitle {
    switch (_currentStep) {
      case 0:
        return 'Tell us who you are before we move to verification.';
      case 1:
        return 'Enter the code we sent to ${_emailCtrl.text.trim().isEmpty ? 'your email' : _emailCtrl.text.trim()}.';
      default:
        return 'Create your password and finish account setup.';
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
                      backgroundColor:
                          isDark ? AppColors.surfaceDark : AppColors.border,
                      valueColor: const AlwaysStoppedAnimation<Color>(
                          AppColors.primary),
                    ),
                  ),
                  const SizedBox(height: 24),
                  Text(
                    _headline,
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _subtitle,
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  const SizedBox(height: 28),
                  AnimatedSwitcher(
                    duration: const Duration(milliseconds: 250),
                    child: _buildStepContent(isDark),
                  ),
                  const SizedBox(height: 24),
                  if (_currentStep == 0) ...[
                    Row(
                      children: [
                        Expanded(
                          child: Divider(color: Theme.of(context).dividerColor),
                        ),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          child: Text(
                            'or',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                        Expanded(
                          child: Divider(color: Theme.of(context).dividerColor),
                        ),
                      ],
                    ),
                    const SizedBox(height: 20),
                    Center(
                      child: _buildSocialButton(Icons.g_translate, 'Google'),
                    ),
                    const SizedBox(height: 24),
                  ],
                  Center(
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          'Already have an account? ',
                          style: Theme.of(context).textTheme.bodyMedium,
                        ),
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
        return _buildVerificationStep();
      default:
        return _buildSecurityStep(isDark);
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
          label: 'Continue to Verification',
          onPressed: _goToVerificationStep,
          isLoading: _isLoading,
          isEnabled: !_isLoading,
          fullWidth: true,
          icon: Icons.arrow_forward,
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
            border:
                Border.all(color: AppColors.primary.withValues(alpha: 0.15)),
          ),
          child: Row(
            children: [
              const Icon(Icons.mail_outline, color: AppColors.primary),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  _emailCtrl.text.trim(),
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        if (_emailVerified) ...[
          const Row(
            children: [
              Icon(Icons.check_circle, color: AppColors.success, size: 18),
              SizedBox(width: 8),
              Text(
                'Email verified',
                style: TextStyle(
                  color: AppColors.success,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
        ],
        AlteraButton(
          label: _otpRequested
              ? 'Resend Verification Code'
              : 'Send Verification Code',
          onPressed: _requestOtp,
          isLoading: _isLoading,
          isEnabled: !_isLoading,
          fullWidth: true,
          icon: Icons.mark_email_unread_outlined,
        ),
        const SizedBox(height: 16),
        AlteraTextField(
          label: 'Email Verification Code',
          hint: 'Enter the 6-digit OTP',
          controller: _otpCtrl,
          keyboardType: TextInputType.number,
          maxLength: 6,
          prefixIcon: Icons.verified_user_outlined,
          errorText: _otpError,
          enabled: !_isLoading,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed:
                    !_isLoading ? () => setState(() => _currentStep = 0) : null,
                child: const Text('Back'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: AlteraButton(
                label: _emailVerified ? 'Continue' : 'Verify Email',
                onPressed: _emailVerified ? _goToSecurityStep : _verifyEmail,
                isLoading: _isLoading,
                isEnabled: !_isLoading && _otpRequested,
                fullWidth: true,
                icon: _emailVerified
                    ? Icons.arrow_forward
                    : Icons.verified_outlined,
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildSecurityStep(bool isDark) {
    return Column(
      key: const ValueKey('signup-step-security'),
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppColors.success.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(14),
            border:
                Border.all(color: AppColors.success.withValues(alpha: 0.18)),
          ),
          child: Row(
            children: [
              const Icon(Icons.verified, color: AppColors.success),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Email verified for ${_emailCtrl.text.trim()}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
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
          onChanged: !_isLoading
              ? (v) => setState(() => _agreeToTerms = v ?? false)
              : null,
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
                onPressed:
                    !_isLoading ? () => setState(() => _currentStep = 1) : null,
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  side: BorderSide(
                    color: isDark ? AppColors.borderDark : AppColors.border,
                  ),
                ),
                child: const Text('Back'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: AlteraButton(
                label: 'Create Account',
                onPressed: _signup,
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
