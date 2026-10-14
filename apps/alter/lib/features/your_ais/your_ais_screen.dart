import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:go_router/go_router.dart';

import '../../core/alt/ai_api.dart';
import '../../core/alt/alt_session.dart';
import '../../core/theme/ds.dart';
import '../../shared/ui/ui.dart';

/// Every AI on the person's ALT account, the same list ALTERA and ALTAR show: the ones they own
/// (made or bought) and the ones they rent or subscribe to. An owned AI becomes the one ALTER works
/// on; the others open a conversation. Ended rentals and subscriptions stay, read-only.
class YourAisScreen extends StatefulWidget {
  const YourAisScreen({super.key});

  @override
  State<YourAisScreen> createState() => _YourAisScreenState();
}

class _YourAisScreenState extends State<YourAisScreen> {
  @override
  void initState() {
    super.initState();
    loadAccountAis();
  }

  Future<void> _open(AccountAi ai) async {
    if (!ai.owned) {
      context.push('/held/${ai.id}');
      return;
    }
    try {
      await switchAi(ai.id);
      if (mounted) context.go('/home');
    } on AltApiException catch (e) {
      if (mounted) toast(context, e.message);
    } catch (_) {
      if (mounted) toast(context, 'Could not reach ALT. Try again.');
    }
  }

  Future<void> _openAltar() async {
    try {
      if (!await altHandoff.open(AltPlatform.altar) && mounted) toast(context, 'ALTAR could not be opened on this device.');
    } on AltApiException catch (e) {
      if (mounted) toast(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    // Someone without an AI of their own lands here instead of on Home.
    final standalone = aiPhase.value == AiPhase.none;
    return AltPage(
      appBar: standalone ? null : topBar(context),
      onRefresh: loadAccountAis,
      children: [
        PageHeader(
          eyebrow: 'Your ALT account',
          title: 'Your AIs',
          subtitle: 'The same on ALTER, ALTERA and ALTAR: AIs you own, rent or subscribe to.',
          trailing: [
            if (standalone) RoundIconButton(icon: Icons.manage_accounts_outlined, tooltip: 'ALT Account', onTap: () => context.push('/account')),
          ],
        ),
        ValueListenableBuilder<List<AccountAi>?>(
          valueListenable: accountAis,
          builder: (context, list, _) {
            if (list == null) return const Loading();
            final owned = list.where((a) => a.owned).toList();
            final using = list.where((a) => !a.owned && a.active).toList();
            final ended = list.where((a) => !a.owned && !a.active).toList();
            final current = currentAi.value?.id;
            return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              if (list.isEmpty)
                const EmptyState(icon: Icons.auto_awesome_outlined, title: 'No AIs yet', body: 'Make your own, or rent and subscribe to AIs on ALTAR.'),
              if (owned.isNotEmpty) ...[
                const SectionLabel('Owned', top: 4),
                Group(children: [for (final a in owned) _AiRow(ai: a, selected: a.id == current, onTap: () => _open(a))]),
              ],
              if (using.isNotEmpty) ...[
                const SectionLabel('Rented and subscribed'),
                Group(children: [for (final a in using) _AiRow(ai: a, onTap: () => _open(a))]),
              ],
              if (ended.isNotEmpty) ...[
                const SectionLabel('Ended'),
                Group(children: [for (final a in ended) _AiRow(ai: a, onTap: () => _open(a))]),
                Padding(
                  padding: const EdgeInsets.fromLTRB(4, 10, 4, 0),
                  child: Text('Your conversations stay here to read. Rent or subscribe again to carry on where you left off.', style: Ds.caption),
                ),
              ],
            ]).animate().fadeIn(duration: Ds.calm);
          },
        ),
        if (standalone) ...[
          const SizedBox(height: 22),
          Glass(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Make your own AI', style: Ds.headline),
              const SizedBox(height: 4),
              Text('Teach a twin that talks like you, then verify it to bring it to ALTERA and ALTAR.', style: Ds.callout),
              const SizedBox(height: 14),
              Btn('Start', icon: Icons.auto_awesome_outlined, onTap: () => context.go('/onboarding'), compact: true),
            ]),
          ),
        ],
        const SectionLabel('Find more'),
        Group(children: [
          ListRow(icon: Icons.storefront_outlined, color: Ds.amber, title: 'ALTAR', subtitle: 'Buy, rent or subscribe to verified AIs', onTap: _openAltar),
        ]),
      ],
    );
  }
}

/// One AI in the list: picture, name, and how it is yours ("Rented · 2 days left").
class _AiRow extends StatelessWidget {
  const _AiRow({required this.ai, required this.onTap, this.selected = false});
  final AccountAi ai;
  final VoidCallback onTap;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final color = ai.owned ? Ds.iris : ai.active ? Ds.mint : Ds.textTertiary;
    return Pressable(
      onTap: onTap,
      scale: 0.985,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(children: [
          Opacity(opacity: ai.active ? 1 : 0.55, child: AiAvatar(ai: ai, size: 40)),
          const SizedBox(width: 14),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(ai.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: Ds.bodyStrong),
              const SizedBox(height: 2),
              Text(ai.label, maxLines: 1, overflow: TextOverflow.ellipsis, style: Ds.caption.copyWith(color: color)),
            ]),
          ),
          const SizedBox(width: 8),
          selected ? const Pill('In ALTER', color: Ds.iris) : const Icon(Icons.chevron_right_rounded, color: Ds.textTertiary),
        ]),
      ),
    );
  }
}
