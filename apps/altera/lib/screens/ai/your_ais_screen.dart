import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/auth_provider.dart';
import '../../services/account_ai_service.dart';
import '../../theme/app_theme.dart';
import '../../widgets/avatar_widget.dart';

/// The AIs on the person's ALT account, loaded once per visit (owned, rented, subscribed, ended).
final accountAisProvider = FutureProvider.autoDispose<List<AccountAi>>((ref) => ref.read(accountAiServiceProvider).accountAis());

/// Every AI on the ALT account, the same list ALTER and ALTAR show. Each opens its chat: the same
/// conversations as in the other apps. Ended rentals and subscriptions stay, read-only.
class YourAisScreen extends ConsumerWidget {
  const YourAisScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ais = ref.watch(accountAisProvider);
    final muted = Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.6);
    return Scaffold(
      appBar: AppBar(title: const Text('Your AIs', style: TextStyle(fontWeight: FontWeight.w800))),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(accountAisProvider.future),
        child: ais.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(children: [
            const SizedBox(height: 120),
            Center(child: Text(e is AltApiException ? e.message : 'Could not reach ALT. Pull to try again.', style: TextStyle(color: muted))),
          ]),
          data: (list) {
            final owned = list.where((a) => a.owned).toList();
            final using = list.where((a) => !a.owned && a.active).toList();
            final ended = list.where((a) => !a.owned && !a.active).toList();
            return ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
              Text('The same on ALTER, ALTERA and ALTAR: AIs you own, rent or subscribe to. Chat with them here, or let them draft posts for you.',
                  style: TextStyle(color: muted, height: 1.4)),
              if (list.isEmpty) ...[
                const SizedBox(height: 60),
                Icon(Icons.auto_awesome_outlined, size: 48, color: muted),
                const SizedBox(height: 12),
                Text('No AIs on your account yet', textAlign: TextAlign.center, style: TextStyle(color: muted, fontWeight: FontWeight.w600)),
                const SizedBox(height: 4),
                Text('Make one in ALTER, or rent and subscribe on ALTAR.', textAlign: TextAlign.center, style: TextStyle(color: muted)),
              ],
              if (owned.isNotEmpty) _Section(title: 'Owned', ais: owned),
              if (using.isNotEmpty) _Section(title: 'Rented and subscribed', ais: using),
              if (ended.isNotEmpty) ...[
                _Section(title: 'Ended', ais: ended),
                Text('Your chats and posts stay. Rent or subscribe again on ALTAR to carry on where you left off.', style: TextStyle(color: muted, fontSize: 12.5)),
              ],
              const SizedBox(height: 20),
              OutlinedButton.icon(
                onPressed: () => ref.read(authServiceProvider).handoff.open(AltPlatform.altar),
                icon: const Icon(Icons.storefront_outlined),
                label: const Text('Find more on ALTAR'),
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
              ),
            ]);
          },
        ),
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.ais});
  final String title;
  final List<AccountAi> ais;

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 22, 4, 8),
          child: Text(title.toUpperCase(),
              style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, letterSpacing: 1.2, color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.5))),
        ),
        Card(
          margin: EdgeInsets.zero,
          clipBehavior: Clip.antiAlias,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          child: Column(children: [
            for (var i = 0; i < ais.length; i++) ...[
              if (i > 0) const Divider(height: 1, indent: 72),
              AccountAiTile(ai: ais[i]),
            ],
          ]),
        ),
      ]);
}

/// One AI: picture, name, and how it is the person's ("Rented · 2 days left"). Opens its chat.
class AccountAiTile extends StatelessWidget {
  const AccountAiTile({super.key, required this.ai});
  final AccountAi ai;

  static Color colorFor(AccountAi ai) => ai.owned ? AppColors.primary : ai.active ? AppColors.success : AppColors.textTertiary;

  @override
  Widget build(BuildContext context) => ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
        leading: Opacity(opacity: ai.active ? 1 : 0.5, child: AvatarWidget(avatarUrl: ai.avatarUrl, displayName: ai.name, radius: 22, isAI: true)),
        title: Text(ai.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text(ai.label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: colorFor(ai), fontWeight: FontWeight.w600, fontSize: 12.5)),
        trailing: const Icon(Icons.chat_bubble_outline_rounded, size: 20),
        onTap: () => context.push('/ai-chat/${ai.id}'),
      );
}

/// The account's active AIs as a strip of bubbles (Messages), to jump into their chats.
class AccountAiStrip extends ConsumerWidget {
  const AccountAiStrip({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list = ref.watch(accountAisProvider).valueOrNull ?? const <AccountAi>[];
    if (list.isEmpty) return const SizedBox.shrink();
    final onSurface = Theme.of(context).colorScheme.onSurface;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 12, 4),
        child: Row(children: [
          Expanded(child: Text('YOUR AIS', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, letterSpacing: 1.2, color: onSurface.withValues(alpha: 0.5)))),
          TextButton(onPressed: () => context.push('/your-ais'), child: const Text('See all')),
        ]),
      ),
      SizedBox(
        height: 96,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          itemCount: list.length,
          separatorBuilder: (_, __) => const SizedBox(width: 14),
          itemBuilder: (context, i) {
            final ai = list[i];
            return InkWell(
              borderRadius: BorderRadius.circular(16),
              onTap: () => context.push('/ai-chat/${ai.id}'),
              child: SizedBox(
                width: 66,
                child: Column(children: [
                  Opacity(opacity: ai.active ? 1 : 0.5, child: AvatarWidget(avatarUrl: ai.avatarUrl, displayName: ai.name, radius: 26, isAI: true)),
                  const SizedBox(height: 6),
                  Text(ai.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600)),
                  Text(ai.owned ? (ai.created ? 'Yours' : 'Bought') : ai.soldByMe ? 'Sold' : ai.active ? (ai.role == 'subscriber' ? 'Subscribed' : 'Rented') : 'Ended',
                      maxLines: 1, style: TextStyle(fontSize: 10.5, color: AccountAiTile.colorFor(ai))),
                ]),
              ),
            );
          },
        ),
      ),
      const Divider(height: 16),
    ]);
  }
}
