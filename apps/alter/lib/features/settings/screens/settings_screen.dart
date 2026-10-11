import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/alt/ai_api.dart';
import '../../../core/alt/alt_session.dart';
import '../../../core/theme/ds.dart';
import '../../../shared/ui/ui.dart';
import '../../consent_engine/screens/consent_screen.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  Future<void> _open(BuildContext context, AltPlatform app) async {
    try {
      if (!await altHandoff.open(app) && context.mounted) toast(context, '${app.label} is not installed on this device.');
    } on AltApiException catch (e) {
      if (context.mounted) toast(context, e.message);
    }
  }

  Future<void> _signOut(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sign out of ALTER?'),
        content: const Text('Your AI and its data stay safe in your ALT account.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: Text('Sign out', style: Ds.button.copyWith(color: Ds.rose, fontSize: 14))),
        ],
      ),
    );
    if (ok != true) return;
    await altAccount.signOut();
    if (context.mounted) context.go('/auth');
  }

  @override
  Widget build(BuildContext context) {
    return AltPage(children: [
      const PageHeader(eyebrow: 'Settings', title: 'You and your AI'),
      ValueListenableBuilder<AltUser?>(
        valueListenable: altAccount.currentUser,
        builder: (context, user, _) {
          final url = user?.avatarUrl == null ? null : media(user!.avatarUrl!);
          return Glass(
            onTap: () => context.push('/account'),
            child: Row(children: [
              Container(
                width: 56,
                height: 56,
                clipBehavior: Clip.antiAlias,
                decoration: BoxDecoration(shape: BoxShape.circle, color: Ds.glassStrong, border: Border.all(color: Ds.hairlineStrong)),
                child: url != null
                    ? Image.network(url, fit: BoxFit.cover)
                    : Center(child: Text((user?.displayName.isNotEmpty ?? false) ? user!.displayName[0].toUpperCase() : '·', style: Ds.title2)),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(user?.displayName ?? '', style: Ds.headline),
                  const SizedBox(height: 2),
                  Text('@${user?.handle ?? ''}${user?.email != null ? ' · ${user!.email}' : ''}', maxLines: 1, overflow: TextOverflow.ellipsis, style: Ds.caption),
                  const SizedBox(height: 8),
                  Wrap(spacing: 6, runSpacing: 6, children: [
                    if (user?.twoFactorEnabled ?? false) const Pill('2FA on', color: Ds.mint, icon: Icons.lock_rounded) else const Pill('2FA off', color: Ds.amber, icon: Icons.lock_open_rounded),
                    if (user?.primaryWallet != null) Pill(user!.primaryWallet!.short, color: Ds.sky, icon: Icons.account_balance_wallet_outlined),
                  ]),
                ]),
              ),
              const Icon(Icons.chevron_right_rounded, color: Ds.textTertiary),
            ]),
          );
        },
      ),
      const SectionLabel('Account'),
      Group(children: [
        ListRow(icon: Icons.shield_outlined, title: 'Security', subtitle: 'Password, two-factor, devices and wallets', onTap: () => context.push('/account')),
        ListRow(
          icon: Icons.privacy_tip_outlined,
          color: Ds.mint,
          title: 'Privacy & consent',
          subtitle: 'What your AI may do with your data',
          onTap: () => Navigator.of(context, rootNavigator: true).push(MaterialPageRoute(builder: (_) => const ConsentScreen())),
        ),
        ListRow(
          icon: Icons.notifications_none_rounded,
          color: Ds.amber,
          title: 'ALT inbox',
          subtitle: 'Alerts from every ALT app',
          trailing: ValueListenableBuilder<int>(
            valueListenable: altInbox.unread,
            builder: (context, n, _) => Row(mainAxisSize: MainAxisSize.min, children: [
              if (n > 0) Pill('$n new', color: Ds.rose),
              const Icon(Icons.chevron_right_rounded, color: Ds.textTertiary),
            ]),
          ),
          onTap: () => context.push('/inbox'),
        ),
      ]),
      const SectionLabel('Your AI'),
      Group(children: [
        ListRow(icon: Icons.face_retouching_natural_rounded, title: 'Profile & personality', subtitle: 'Picture, bio, traits and boundaries', onTap: () => context.push('/ai')),
        ListRow(icon: Icons.psychology_alt_outlined, color: Ds.mint, title: 'Memories', subtitle: 'What it remembers about you', onTap: () => context.push('/ai/memories')),
        ListRow(icon: Icons.layers_outlined, color: Ds.amber, title: 'Version history', subtitle: 'Every version, its manifest and transaction', onTap: () => context.push('/ai/versions')),
      ]),
      const SectionLabel('Across ALT'),
      Group(children: [
        ListRow(icon: Icons.forum_outlined, color: Ds.sky, title: 'Open ALTERA', subtitle: 'Signed in automatically', onTap: () => _open(context, AltPlatform.altera)),
        ListRow(icon: Icons.storefront_outlined, color: Ds.amber, title: 'Open ALTAR', subtitle: 'Signed in automatically', onTap: () => _open(context, AltPlatform.altar)),
      ]),
      const SizedBox(height: 24),
      Group(children: [ListRow(icon: Icons.logout_rounded, title: 'Sign out', danger: true, onTap: () => _signOut(context))]),
      const SizedBox(height: 22),
      Center(child: Text('ALTER · part of THE ALT ecosystem', style: Ds.caption.copyWith(color: Ds.textTertiary))),
    ]);
  }
}
