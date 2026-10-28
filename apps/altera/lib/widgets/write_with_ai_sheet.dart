import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/account_ai_service.dart';
import '../theme/app_theme.dart';
import 'avatar_widget.dart';

/// "Write with your AI": pick one of the AIs on the ALT account that you may use now (owned, rented
/// or subscribed) and say what you want. Returns the AI and the brief, or null if cancelled. Used for
/// posts ("posted with") and comments and replies ("replied with").
Future<({AccountAi ai, String brief})?> pickAiToWriteWith(
  BuildContext context,
  WidgetRef ref, {
  required String title,
  required String subtitle,
  required String hint,
  bool briefRequired = true,
  String? initialAiId,
}) async {
  List<AccountAi> ais;
  try {
    ais = (await ref.read(accountAiServiceProvider).accountAis()).where((a) => a.active).toList();
  } catch (_) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not reach ALT. Try again.')));
    return null;
  }
  if (!context.mounted) return null;
  if (ais.isEmpty) {
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('No AIs on your account yet. Make one in ALTER, or rent or subscribe on ALTAR.')));
    return null;
  }
  var chosen = ais.firstWhere((a) => a.id == initialAiId, orElse: () => ais.first);
  final brief = TextEditingController();
  final go = await showModalBottomSheet<bool>(
    context: context,
    useRootNavigator: true, // above the home screen's frosted bar
    isScrollControlled: true,
    showDragHandle: true,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, set) => Padding(
        padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.of(ctx).viewInsets.bottom),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(title, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text(subtitle, style: TextStyle(color: Theme.of(ctx).colorScheme.onSurface.withValues(alpha: 0.6))),
          const SizedBox(height: 14),
          SizedBox(
            height: 92,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: ais.length,
              separatorBuilder: (_, __) => const SizedBox(width: 12),
              itemBuilder: (_, i) {
                final a = ais[i];
                final on = a.id == chosen.id;
                return InkWell(
                  borderRadius: BorderRadius.circular(14),
                  onTap: () => set(() => chosen = a),
                  child: SizedBox(
                    width: 70,
                    child: Column(children: [
                      Container(
                        padding: const EdgeInsets.all(2),
                        decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: on ? AppColors.primary : Colors.transparent, width: 2)),
                        child: AvatarWidget(avatarUrl: a.avatarUrl, displayName: a.name, radius: 24, isAI: true),
                      ),
                      const SizedBox(height: 4),
                      Text(a.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11.5, fontWeight: on ? FontWeight.w700 : FontWeight.w500)),
                      Text(a.owned ? (a.created ? 'Yours' : 'Bought') : a.role == 'subscriber' ? 'Subscribed' : 'Rented',
                          style: const TextStyle(fontSize: 10.5, color: AppColors.textTertiary)),
                    ]),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: brief,
            autofocus: true,
            maxLines: 3,
            decoration: InputDecoration(hintText: hint, border: OutlineInputBorder(borderRadius: BorderRadius.circular(14))),
          ),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: () => Navigator.pop(ctx, true),
            icon: const Icon(Icons.auto_awesome_rounded),
            label: const Text('Draft it'),
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          ),
        ]),
      ),
    ),
  );
  final text = brief.text.trim();
  if (go != true || (briefRequired && text.length < 3)) return null;
  return (ai: chosen, brief: text);
}
