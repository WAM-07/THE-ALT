import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/custom_button.dart';
import '../../widgets/custom_text_field.dart';

class ChangePasswordScreen extends ConsumerStatefulWidget {
  const ChangePasswordScreen({super.key});

  @override
  ConsumerState<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends ConsumerState<ChangePasswordScreen> {
  final _oldPassCtrl = TextEditingController();
  final _newPassCtrl = TextEditingController();
  final _confirmPassCtrl = TextEditingController();
  bool _isLoading = false;
  String? _error;

  @override
  void dispose() {
    _oldPassCtrl.dispose();
    _newPassCtrl.dispose();
    _confirmPassCtrl.dispose();
    super.dispose();
  }

  void _changePassword() async {
    final oldPass = _oldPassCtrl.text;
    final newPass = _newPassCtrl.text;
    final confirmPass = _confirmPassCtrl.text;

    if (oldPass.isEmpty || newPass.isEmpty) {
      setState(() => _error = 'All fields required');
      return;
    }
    if (newPass.length < 8) {
      setState(() => _error = 'New password must be 8+ characters');
      return;
    }
    if (newPass != confirmPass) {
      setState(() => _error = 'Passwords do not match');
      return;
    }

    setState(() {
      _isLoading = true;
      _error = null;
    });

    final success = await ref.read(authStateProvider.notifier).changePassword(oldPass, newPass);
    if (success) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Password changed successfully!'), backgroundColor: AppColors.success),
      );
      Navigator.of(context).pop();
    } else {
      setState(() => _error = ref.read(authStateProvider).error ?? 'Failed to change password');
    }
    setState(() => _isLoading = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Change Password')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          children: [
            AlteraTextField(
              label: 'Current Password',
              hint: 'Enter old password',
              controller: _oldPassCtrl,
              obscureText: true,
              prefixIcon: Icons.lock_open,
              enabled: !_isLoading,
            ),
            const SizedBox(height: 20),
            AlteraTextField(
              label: 'New Password',
              hint: 'Min 8 characters',
              controller: _newPassCtrl,
              obscureText: true,
              prefixIcon: Icons.lock_outline,
              enabled: !_isLoading,
            ),
            const SizedBox(height: 20),
            AlteraTextField(
              label: 'Confirm New Password',
              hint: 'Re-enter new password',
              controller: _confirmPassCtrl,
              obscureText: true,
              prefixIcon: Icons.lock_outline,
              errorText: _error,
              enabled: !_isLoading,
            ),
            const SizedBox(height: 32),
            AlteraButton(
              label: 'Update Password',
              onPressed: _changePassword,
              isLoading: _isLoading,
              fullWidth: true,
            ),
          ],
        ),
      ),
    );
  }
}
