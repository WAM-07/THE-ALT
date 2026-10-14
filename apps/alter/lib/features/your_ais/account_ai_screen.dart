import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:go_router/go_router.dart';

import '../../core/alt/ai_api.dart';
import '../../core/alt/alt_session.dart';
import '../../core/theme/ds.dart';
import '../../shared/ui/ui.dart';

/// An AI the person rents or subscribes to: its identity card, how long it is theirs, who made and
/// owns it, and what it is like, with Chat and Open in ALTAR. (Owned AIs open in ALTER itself.)
class AccountAiScreen extends StatefulWidget {
  const AccountAiScreen({super.key, required this.aiId});
  final String aiId;

  @override
  State<AccountAiScreen> createState() => _AccountAiScreenState();
}

class _AccountAiScreenState extends State<AccountAiScreen> {
  Map<String, dynamic>? _profile;

  AccountAi? get _ai => accountAis.value?.where((a) => a.id == widget.aiId).firstOrNull;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (_ai == null) await loadAccountAis();
    final ai = _ai;
    if (ai == null) {
      if (mounted) setState(() {});
      return;
    }
    try {
      final profile = await aiApi.publicProfile(ai.handle);
      if (mounted) setState(() => _profile = profile);
    } catch (_) {
      // The card and the chat still work without the public profile.
      if (mounted) setState(() => _profile = const {});
    }
  }

  Future<void> _openAltar() async {
    try {
      if (!await altHandoff.open(AltPlatform.altar) && mounted) toast(context, 'ALTAR could not be opened on this device.');
    } on AltApiException catch (e) {
      if (mounted) toast(context, e.message);
    }
  }

  static String _when(DateTime t) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    final l = t.toLocal();
    return '${l.day} ${months[l.month - 1]} ${l.year}, ${l.hour.toString().padLeft(2, '0')}:${l.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final ai = _ai;
    return AltPage(
      appBar: topBar(context),
      onRefresh: () async {
        await loadAccountAis();
        await _load();
      },
      children: [
        if (ai == null)
          (accountAis.value == null ? const Loading() : const EmptyState(icon: Icons.help_outline_rounded, title: 'Not on your account', body: 'This AI is not one you own, rent or subscribe to.'))
        else ...[
          AiIdentityCard(ai: ai).animate().fadeIn(duration: Ds.calm).slideY(begin: 0.04, curve: Ds.ease),
          const SizedBox(height: 14),
          Glass(
            child: Row(children: [
              IconBadge(ai.role == 'subscriber' ? Icons.event_repeat_rounded : Icons.schedule_rounded, color: ai.active ? Ds.mint : Ds.textTertiary, size: 44),
              const SizedBox(width: 14),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(ai.label, style: Ds.headline),
                  const SizedBox(height: 3),
                  Text(
                    ai.active && ai.until != null
                        ? 'Yours to talk to until ${_when(ai.until!)}, in ALTER, ALTERA and ALTAR.'
                        : ai.soldByMe
                            ? 'You sold it. Your chats from when you owned it stay readable.'
                            : 'Your conversations stay readable. Rent or subscribe again on ALTAR to carry on.',
                    style: Ds.caption,
                  ),
                ]),
              ),
            ]),
          ).animate().fadeIn(delay: 60.ms, duration: Ds.calm),
          const SizedBox(height: 14),
          Row(children: [
            Expanded(child: Btn(ai.active ? 'Chat' : 'Read chats', icon: Icons.chat_bubble_outline_rounded, onTap: () => context.push('/talk/${ai.id}'), expand: true)),
            const SizedBox(width: 10),
            Expanded(child: Btn('ALTAR', icon: Icons.storefront_outlined, onTap: _openAltar, kind: BtnKind.secondary, expand: true)),
          ]),
          if (ai.description != null || (_profile?['about'] as String?) != null) ...[
            const SectionLabel('About'),
            Glass(child: Text((_profile?['about'] as String?) ?? ai.description!, style: Ds.body)),
          ],
          if (((_profile?['traits'] as List?) ?? const []).isNotEmpty) ...[
            const SizedBox(height: 12),
            Wrap(spacing: 8, runSpacing: 8, children: [for (final t in _profile!['traits'] as List) Pill('$t', color: Ds.sky)]),
          ],
          if (_profile?['owner'] != null || _profile?['creator'] != null) ...[
            const SectionLabel('People'),
            Group(children: [
              if (_profile?['creator'] != null)
                ListRow(icon: Icons.brush_outlined, color: Ds.amber, title: '${(_profile!['creator'] as Map)['displayName']}', subtitle: 'Made it'),
              if (_profile?['owner'] != null && (_profile!['owner'] as Map)['id'] != (_profile!['creator'] as Map?)?['id'])
                ListRow(icon: Icons.verified_user_outlined, color: Ds.iris, title: '${(_profile!['owner'] as Map)['displayName']}', subtitle: 'Owns it now'),
            ]),
          ],
          if (ai.token != null) ...[
            const SectionLabel('Identity token'),
            Group(children: [
              ListRow(icon: Icons.fingerprint_rounded, color: Ds.mint, title: 'AIT #${ai.token!.tokenId}', subtitle: 'Proves who owns it and who may use it, on-chain'),
            ]),
          ],
        ],
      ],
    );
  }
}
