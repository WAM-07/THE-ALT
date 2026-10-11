import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/custom_button.dart';
import '../../widgets/custom_text_field.dart';

class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _emailCtrl = TextEditingController();
  final _otpCtrl = TextEditingController();
  final _newPassCtrl = TextEditingController();
  bool _isLoading = false;
  bool _otpRequested = false;
  String? _error;

  @override
  void dispose() {
    _emailCtrl.dispose();
    _otpCtrl.dispose();
    _newPassCtrl.dispose();
    super.dispose();
  }

  void _requestResetCode() async {
    final email = _emailCtrl.text.trim();
    if (email.isEmpty) {
      setState(() => _error = 'Email is required');
      return;
    }

    setState(() {
      _isLoading = true;
      _error = null;
    });

    final success = await ref.read(authStateProvider.notifier).forgotPassword(email);
    if (!mounted) return;

    if (success) {
      setState(() => _otpRequested = true);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('A password reset code has been sent to your email.'),
          backgroundColor: AppColors.success,
        ),
      );
    } else {
      setState(() => _error = ref.read(authStateProvider).error ?? 'Failed to send reset code');
    }
    setState(() => _isLoading = false);
  }

  void _resetPassword() async {
    final email = _emailCtrl.text.trim();
    final otp = _otpCtrl.text.trim();
    final newPass = _newPassCtrl.text;

    if (email.isEmpty) {
      setState(() => _error = 'Email is required');
      return;
    }
    if (otp.length != 6) {
      setState(() => _error = 'Enter the 6-digit OTP sent to your email');
      return;
    }
    if (newPass.length < 8) {
      setState(() => _error = 'Password must be at least 8 characters');
      return;
    }

    setState(() {
      _isLoading = true;
      _error = null;
    });

    final success = await ref.read(authStateProvider.notifier).resetPassword(email, otp, newPass);
    if (success) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Password reset successfully!'), backgroundColor: AppColors.success),
      );
      Navigator.of(context).pop();
    } else {
      setState(() => _error = ref.read(authStateProvider).error ?? 'Reset failed');
    }
    setState(() => _isLoading = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Recover Account')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Reset Password',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),
            Text(
              'Request a one-time code, then use it to set a new password.',
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            const SizedBox(height: 32),
            AlteraTextField(
              label: 'Email Address',
              hint: 'your@email.com',
              controller: _emailCtrl,
              keyboardType: TextInputType.emailAddress,
              prefixIcon: Icons.mail_outline,
              enabled: !_isLoading,
            ),
            const SizedBox(height: 16),
            AlteraButton(
              label: _otpRequested ? 'Resend Reset Code' : 'Send Reset Code',
              onPressed: _requestResetCode,
              isLoading: _isLoading,
              isEnabled: !_isLoading,
              fullWidth: true,
              variant: ButtonVariant.secondary,
            ),
            const SizedBox(height: 20),
            AlteraTextField(
              label: 'Reset Code',
              hint: 'Enter the 6-digit OTP',
              controller: _otpCtrl,
              keyboardType: TextInputType.number,
              maxLength: 6,
              prefixIcon: Icons.verified_user_outlined,
              enabled: !_isLoading,
            ),
            const SizedBox(height: 20),
            AlteraTextField(
              label: 'New Password',
              hint: 'At least 8 characters',
              controller: _newPassCtrl,
              obscureText: true,
              prefixIcon: Icons.lock_outline,
              errorText: _error,
              enabled: !_isLoading,
            ),
            const SizedBox(height: 24),
            AlteraButton(
              label: 'Update Password',
              onPressed: _resetPassword,
              isLoading: _isLoading,
              fullWidth: true,
            ),
          ],
        ),
      ),
    );
  }
}
