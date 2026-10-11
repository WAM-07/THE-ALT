import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/alt/ai_api.dart';
import '../../../core/alt/alt_session.dart';
import '../../../core/theme/colors.dart';
import '../../../core/theme/gradients.dart';
import '../../../core/theme/typography.dart';
import '../../../shared/widgets/gradient_background.dart';
import '../../ai_profile/screens/ai_profile_screen.dart';

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
                Row(children: [
                  Expanded(child: Text('Hi, ${user?.displayName.split(' ').first ?? 'there'}', style: ALTTypography.headlineLarge)),
                  AltInboxButton(inbox: altInbox, onPressed: () => context.push('/inbox')),
                ]),
                const SizedBox(height: 4),
                Text('@${user?.handle ?? ''}', style: ALTTypography.bodyMedium.copyWith(color: muted)),
                const SizedBox(height: 24),
                ValueListenableBuilder<AltAi?>(
                  valueListenable: currentAi,
                  builder: (context, ai, _) {
                    final (status, next, _) = switch (ai?.status) {
                      'verified' => ('Verified · identity token #${ai!.token?.tokenId}', 'It can now appear on ALTERA and ALTAR.', '/training'),
                      'minting' => ('Minting its identity token…', 'This takes a few seconds.', '/training'),
                      'ready' => ('Version v${ai!.latestVersion?['version']} built', 'Finish the checks and deploy it.', '/training'),
                      _ => ('Draft', 'Add data about you and chat with it.', '/dataset'),
                    };
                    return _Card(
                      color: card,
                      child: ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: ai == null
                            ? const CircleAvatar(backgroundColor: ALTColors.irisViolet, child: Icon(Icons.psychology_alt_rounded, color: Colors.white))
                            : AiAvatar(ai: ai),
                        title: Text(ai?.name ?? 'Your personal AI', style: ALTTypography.headlineSmall),
                        subtitle: Text('$status\n$next', style: ALTTypography.bodySmall.copyWith(color: muted)),
                        isThreeLine: true,
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => context.push('/ai'),
                      ),
                    );
                  },
                ),
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(child: FilledButton.tonalIcon(onPressed: () => context.go('/chat'), icon: const Icon(Icons.chat_bubble_outline), label: const Text('Chat'))),
                  const SizedBox(width: 8),
                  Expanded(child: FilledButton.tonalIcon(onPressed: () => context.go('/dataset'), icon: const Icon(Icons.add), label: const Text('Add data'))),
                ]),
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
