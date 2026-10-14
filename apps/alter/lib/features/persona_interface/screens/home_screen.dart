import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:go_router/go_router.dart';

import '../../../core/alt/ai_api.dart';
import '../../../core/alt/alt_session.dart';
import '../../../core/theme/ds.dart';
import '../../../shared/ui/ui.dart';

/// Home: your AI at a glance, the one thing to do next, and what happened recently.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  List<AltNotification>? _recent;

  @override
  void initState() {
    super.initState();
    _loadRecent();
    altInbox.incoming.listen((_) => _loadRecent());
  }

  Future<void> _loadRecent() async {
    try {
      final items = await altInbox.list(limit: 3);
      if (mounted) setState(() => _recent = items);
    } catch (_) {
      if (mounted) setState(() => _recent ??= []);
    }
  }

  Future<void> _refresh() async {
    await Future.wait([refreshCurrentAi().catchError((_) => null), loadAccountAis(), _loadRecent()]);
  }

  Future<void> _open(AltPlatform app) async {
    try {
      if (!await altHandoff.open(app) && mounted) toast(context, '${app.label} is not installed on this device.');
    } on AltApiException catch (e) {
      if (mounted) toast(context, e.message);
    }
  }

  static String _greeting() {
    final h = DateTime.now().hour;
    return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }

  /// The single most useful next step for where the AI is in its life.
  ({String title, String body, String cta, IconData icon, VoidCallback onTap, bool hero})? _next(AltAi ai) {
    final latest = ai.latestVersion;
    if (ai.status == 'minting') {
      return (title: 'Minting its identity', body: 'Writing your AI’s identity token to the blockchain. This takes a few seconds.', cta: 'View', icon: Icons.hourglass_top_rounded, onTap: () => context.go('/training'), hero: false);
    }
    if (ai.verified && latest != null && latest['published'] == false) {
      return (title: 'Version ${latest['version']} is ready', body: 'Publish it so ALTERA and ALTAR use what your AI learned since.', cta: 'Publish', icon: Icons.rocket_launch_outlined, onTap: () => context.go('/training'), hero: true);
    }
    if (ai.verified) {
      return (title: 'Your twin is live', body: 'It can post, comment and reply on ALTERA under its identity token.', cta: 'Open ALTERA', icon: Icons.public_rounded, onTap: () => _open(AltPlatform.altera), hero: false);
    }
    if (ai.status == 'ready') {
      return (title: 'Ready for its identity', body: 'Finish the checks and mint the token that proves it is yours.', cta: 'Deploy', icon: Icons.fingerprint_rounded, onTap: () => context.go('/training'), hero: true);
    }
    if (ai.count('datasets') == 0) {
      return (title: 'Teach it who you are', body: 'Write a few lines about yourself: how you talk, what you know, what you love.', cta: 'Start', icon: Icons.edit_note_rounded, onTap: () => context.go('/dataset'), hero: true);
    }
    return (title: 'Talk to it', body: 'Chat a little, then build its first version from what it knows.', cta: 'Chat', icon: Icons.chat_bubble_outline_rounded, onTap: () => context.go('/chat'), hero: true);
  }

  @override
  Widget build(BuildContext context) {
    return AltPage(
      onRefresh: _refresh,
      children: [
        ValueListenableBuilder<AltUser?>(
          valueListenable: altAccount.currentUser,
          builder: (context, user, _) => Padding(
            padding: const EdgeInsets.only(top: 12, bottom: 22),
            child: Row(children: [
              _UserAvatar(user: user),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(_greeting(), style: Ds.caption),
                  Text(user?.displayName.split(' ').first ?? '', style: Ds.title2),
                ]),
              ),
              ValueListenableBuilder<int>(
                valueListenable: altInbox.unread,
                builder: (context, n, _) => RoundIconButton(
                  icon: Icons.notifications_none_rounded,
                  tooltip: 'ALT inbox',
                  size: 44,
                  onTap: () => context.push('/inbox'),
                  badge: n == 0
                      ? null
                      : Container(
                          padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                          constraints: const BoxConstraints(minWidth: 18),
                          decoration: BoxDecoration(color: Ds.rose, borderRadius: BorderRadius.circular(9), border: Border.all(color: Ds.bg, width: 2)),
                          child: Text(n > 9 ? '9+' : '$n', textAlign: TextAlign.center, style: Ds.caption.copyWith(color: Colors.white, fontSize: 10.5, fontWeight: FontWeight.w700)),
                        ),
                ),
              ),
            ]),
          ),
        ),
        ValueListenableBuilder<AltAi?>(
          valueListenable: currentAi,
          builder: (context, ai, _) {
            if (ai == null) return const Loading();
            final next = _next(ai);
            return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              AiIdentityCard(ai: ai, onTap: () => context.push('/ai')).animate().fadeIn(duration: Ds.calm).slideY(begin: 0.04, curve: Ds.ease),
              if (next != null) ...[
                const SizedBox(height: 14),
                Glass(
                  onTap: next.onTap,
                  padding: const EdgeInsets.fromLTRB(16, 16, 14, 16),
                  child: Row(children: [
                    IconBadge(next.icon, color: next.hero ? Ds.iris : Ds.mint, size: 44),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(next.title, style: Ds.headline),
                        const SizedBox(height: 3),
                        Text(next.body, style: Ds.caption),
                        const SizedBox(height: 8),
                        Text('${next.cta}  →', style: Ds.caption.copyWith(color: next.hero ? Ds.iris : Ds.mint, fontWeight: FontWeight.w700)),
                      ]),
                    ),
                  ]),
                ).animate().fadeIn(delay: 80.ms, duration: Ds.calm),
              ],
              const _AccountStrip(),
              const SectionLabel('Your AI'),
              GridView(
                shrinkWrap: true,
                padding: EdgeInsets.zero,
                physics: const NeverScrollableScrollPhysics(),
                // A fixed height (not a ratio) keeps the text inside the tiles on narrow phones.
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 2, mainAxisSpacing: 12, crossAxisSpacing: 12, mainAxisExtent: 122),
                children: [
                  _Action(icon: Icons.chat_bubble_outline_rounded, color: Ds.iris, title: 'Chat', subtitle: 'Talk to your twin', onTap: () => context.go('/chat')),
                  _Action(icon: Icons.auto_awesome_outlined, color: Ds.sky, title: 'Teach', subtitle: '${ai.count('datasets')} things it knows', onTap: () => context.go('/dataset')),
                  _Action(
                    icon: Icons.psychology_alt_outlined,
                    color: Ds.mint,
                    title: 'Memories',
                    subtitle: ai.count('proposedMemories') > 0 ? '${ai.count('proposedMemories')} waiting for you' : '${ai.count('memories')} remembered',
                    highlight: ai.count('proposedMemories') > 0,
                    onTap: () => context.push('/ai/memories'),
                  ),
                  _Action(icon: Icons.layers_outlined, color: Ds.amber, title: 'Versions', subtitle: ai.currentVersion != null ? 'v${ai.currentVersion} live' : 'None live yet', onTap: () => context.push('/ai/versions')),
                ],
              ).animate().fadeIn(delay: 140.ms, duration: Ds.calm),
            ]);
          },
        ),
        SectionLabel('Recent', action: 'See all', onAction: () => context.push('/inbox')),
        if (_recent == null)
          const Loading(padding: 24)
        else if (_recent!.isEmpty)
          Glass(child: Text('Nothing yet. News about your AI and your account appears here.', style: Ds.callout))
        else
          Group(children: [
            for (final n in _recent!)
              ListRow(
                icon: _iconFor(n.category),
                color: _colorFor(n.category),
                title: n.title,
                subtitle: '${n.platform.toUpperCase()} · ${_ago(n.createdAt)}',
                trailing: n.read ? null : Container(width: 8, height: 8, decoration: const BoxDecoration(color: Ds.iris, shape: BoxShape.circle)),
                onTap: () => context.push('/inbox'),
              ),
          ]),
        const SectionLabel('Across ALT'),
        Group(children: [
          ListRow(icon: Icons.forum_outlined, color: Ds.sky, title: 'ALTERA', subtitle: 'The social hub, signed in already', onTap: () => _open(AltPlatform.altera)),
          ListRow(icon: Icons.storefront_outlined, color: Ds.amber, title: 'ALTAR', subtitle: 'The AI marketplace', onTap: () => _open(AltPlatform.altar)),
          ListRow(icon: Icons.manage_accounts_outlined, color: Ds.iris, title: 'ALT Account', subtitle: 'Security, devices and wallets', onTap: () => context.push('/account')),
        ]),
      ],
    );
  }

  static IconData _iconFor(String category) => switch (category) {
        'security' => Icons.shield_outlined,
        'ai' => Icons.auto_awesome_outlined,
        'transaction' => Icons.fingerprint_rounded,
        'moderation' => Icons.flag_outlined,
        _ => Icons.campaign_outlined,
      };
  static Color _colorFor(String category) => switch (category) {
        'security' => Ds.amber,
        'moderation' => Ds.rose,
        'transaction' => Ds.mint,
        _ => Ds.iris,
      };
  static String _ago(DateTime t) {
    final d = DateTime.now().difference(t);
    if (d.inMinutes < 1) return 'now';
    if (d.inHours < 1) return '${d.inMinutes}m ago';
    if (d.inDays < 1) return '${d.inHours}h ago';
    return '${d.inDays}d ago';
  }
}

/// The AIs on the ALT account as picture bubbles (owned, rented, subscribed), when there is more
/// than the one ALTER is working on. Owned ones switch ALTER to them; the others open a chat.
class _AccountStrip extends StatelessWidget {
  const _AccountStrip();

  Future<void> _open(BuildContext context, AccountAi ai) async {
    if (!ai.owned) {
      context.push('/talk/${ai.id}');
      return;
    }
    if (ai.id == currentAi.value?.id) return;
    try {
      await switchAi(ai.id);
    } on AltApiException catch (e) {
      if (context.mounted) toast(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<List<AccountAi>?>(
        valueListenable: accountAis,
        builder: (context, list, _) {
          if (list == null || list.length < 2) return const SizedBox.shrink();
          final current = currentAi.value?.id;
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            SectionLabel('Your AIs', action: 'See all', onAction: () => context.push('/yours')),
            SizedBox(
              height: 112,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: list.length,
                separatorBuilder: (_, __) => const SizedBox(width: 14),
                itemBuilder: (context, i) {
                  final ai = list[i];
                  final on = ai.id == current;
                  return Pressable(
                    onTap: () => _open(context, ai),
                    child: SizedBox(
                      width: 64,
                      child: Column(children: [
                        Container(
                          padding: const EdgeInsets.all(2),
                          decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: on ? Ds.iris : Colors.transparent, width: 2)),
                          child: Opacity(opacity: ai.active ? 1 : 0.5, child: AiAvatar(ai: ai, size: 52)),
                        ),
                        const SizedBox(height: 6),
                        Text(ai.name, maxLines: 1, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center, style: Ds.caption.copyWith(color: Ds.text, fontSize: 11.5)),
                        Text(ai.owned ? (on ? 'In ALTER' : ai.label) : ai.active ? (ai.role == 'subscriber' ? 'Subscribed' : 'Rented') : 'Ended',
                            maxLines: 1, overflow: TextOverflow.ellipsis, style: Ds.caption.copyWith(fontSize: 10.5, color: ai.owned ? Ds.iris : ai.active ? Ds.mint : Ds.textTertiary)),
                      ]),
                    ),
                  );
                },
              ),
            ),
          ]);
        },
      );
}

class _Action extends StatelessWidget {
  const _Action({required this.icon, required this.color, required this.title, required this.subtitle, required this.onTap, this.highlight = false});
  final IconData icon;
  final Color color;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final bool highlight;

  @override
  Widget build(BuildContext context) => Glass(
        onTap: onTap,
        padding: const EdgeInsets.all(14),
        border: highlight ? color.withValues(alpha: 0.5) : null,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          IconBadge(icon, color: color, size: 34),
          const Spacer(),
          Text(title, style: Ds.bodyStrong),
          const SizedBox(height: 1),
          Text(subtitle, maxLines: 1, overflow: TextOverflow.ellipsis, style: Ds.caption.copyWith(color: highlight ? color : Ds.textSecondary)),
        ]),
      );
}

class _UserAvatar extends StatelessWidget {
  const _UserAvatar({required this.user});
  final AltUser? user;

  @override
  Widget build(BuildContext context) {
    final url = user?.avatarUrl == null ? null : media(user!.avatarUrl!);
    return Pressable(
      onTap: () => context.push('/account'),
      child: Container(
        width: 44,
        height: 44,
        decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: Ds.hairlineStrong), color: Ds.glassStrong),
        clipBehavior: Clip.antiAlias,
        child: url != null
            ? Image.network(url, fit: BoxFit.cover, errorBuilder: (_, __, ___) => _initial())
            : _initial(),
      ),
    );
  }

  Widget _initial() => Center(child: Text((user?.displayName.isNotEmpty ?? false) ? user!.displayName[0].toUpperCase() : '·', style: Ds.headline));
}
