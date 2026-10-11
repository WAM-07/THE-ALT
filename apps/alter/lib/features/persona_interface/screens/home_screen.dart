import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/alt/alt_session.dart';
import '../../../core/providers/storage_providers.dart';
import '../../../core/theme/colors.dart';
import '../../../core/theme/gradients.dart';
import '../../../core/theme/typography.dart';
import '../../../shared/widgets/gradient_background.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  Future<void> _open(BuildContext context, AltPlatform app) async {
    try {
      if (!await altHandoff.open(app)) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${app.label} is not installed on this device.')));
        }
      }
    } on AltApiException catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final persona = ref.watch(currentPersonaProvider);
    final card = (isDark ? ALTColors.darkBgSurface01 : ALTColors.lightBgSurface01).withValues(alpha: 0.9);
    final muted = isDark ? ALTColors.darkTextSecondary : ALTColors.lightTextSecondary;

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: GradientBackground(
        baseColor: isDark ? ALTColors.darkBgPage : ALTColors.lightBgPage,
        layers: isDark ? ALTGradients.alterDark : ALTGradients.alterLight,
        animate: true,
        child: SafeArea(
          child: ValueListenableBuilder<AltUser?>(
            valueListenable: altAccount.currentUser,
            builder: (context, user, _) => ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Text('Hi, ${user?.displayName.split(' ').first ?? 'there'}', style: ALTTypography.headlineLarge),
                const SizedBox(height: 4),
                Text('@${user?.handle ?? ''}', style: ALTTypography.bodyMedium.copyWith(color: muted)),
                const SizedBox(height: 24),
                _Card(
                  color: card,
                  child: ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const CircleAvatar(
                      backgroundColor: ALTColors.irisViolet,
                      child: Icon(Icons.psychology_alt_rounded, color: Colors.white),
                    ),
                    title: Text(persona?.name ?? 'Your personal AI', style: ALTTypography.headlineSmall),
                    subtitle: Text(
                      persona == null ? 'Finish onboarding to create it.' : 'Draft · not yet trained or deployed',
                      style: ALTTypography.bodySmall.copyWith(color: muted),
                    ),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => context.go(persona == null ? '/onboarding' : '/training'),
                  ),
                ),
                const SizedBox(height: 16),
                _Card(
                  color: card,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Your ALT account', style: ALTTypography.labelLarge.copyWith(color: ALTColors.irisViolet)),
                      const SizedBox(height: 6),
                      Text(
                        'The same account works in ALTERA (social hub) and ALTAR (marketplace). '
                        'Once your AI is verified with its identity token, it can appear there too.',
                        style: ALTTypography.bodySmall.copyWith(color: muted),
                      ),
                      const SizedBox(height: 12),
                      Wrap(spacing: 8, runSpacing: 8, children: [
                        FilledButton.tonalIcon(
                          onPressed: () => _open(context, AltPlatform.altera),
                          icon: const Icon(Icons.forum_outlined),
                          label: const Text('Open ALTERA'),
                        ),
                        FilledButton.tonalIcon(
                          onPressed: () => _open(context, AltPlatform.altar),
                          icon: const Icon(Icons.storefront_outlined),
                          label: const Text('Open ALTAR'),
                        ),
                        OutlinedButton.icon(
                          onPressed: () => context.push('/account'),
                          icon: const Icon(Icons.manage_accounts_outlined),
                          label: const Text('Account'),
                        ),
                      ]),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.color, required this.child});
  final Color color;
  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(18)),
        child: child,
      );
}
