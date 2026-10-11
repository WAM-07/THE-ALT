import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/alt/alt_session.dart';
import '../../../core/theme/colors.dart';
import '../../../core/theme/gradients.dart';
import '../../../core/theme/typography.dart';
import '../../../shared/widgets/gradient_background.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  Future<void> _open(BuildContext context, AltPlatform app) async {
    try {
      if (!await altHandoff.open(app) && context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${app.label} is not installed on this device.')));
      }
    } on AltApiException catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: GradientBackground(
        baseColor: isDark ? ALTColors.darkBgPage : ALTColors.lightBgPage,
        layers: isDark ? ALTGradients.alterDark : ALTGradients.alterLight,
        animate: false,
        child: SafeArea(
          child: ListView(
            padding: const EdgeInsets.symmetric(vertical: 16),
            children: [
              const Padding(
                padding: EdgeInsets.fromLTRB(20, 0, 20, 12),
                child: Text('Settings', style: ALTTypography.headlineLarge),
              ),
              ListTile(
                leading: const Icon(Icons.manage_accounts_outlined),
                title: const Text('ALT Account'),
                subtitle: const Text('Profile, password, two-factor, devices and wallets'),
                onTap: () => context.push('/account'),
              ),
              ListTile(
                leading: const Icon(Icons.forum_outlined),
                title: const Text('Open ALTERA'),
                subtitle: const Text('Signed in automatically'),
                onTap: () => _open(context, AltPlatform.altera),
              ),
              ListTile(
                leading: const Icon(Icons.storefront_outlined),
                title: const Text('Open ALTAR'),
                subtitle: const Text('Signed in automatically'),
                onTap: () => _open(context, AltPlatform.altar),
              ),
              const Divider(),
              ListTile(
                leading: const Icon(Icons.logout),
                title: const Text('Sign out'),
                onTap: () async {
                  await altAccount.signOut();
                  if (context.mounted) context.go('/auth');
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}
