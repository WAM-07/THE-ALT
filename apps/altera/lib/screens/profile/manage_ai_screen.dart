import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../../models/post_model.dart';
import '../../providers/auth_provider.dart';
import '../../providers/feed_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/avatar_widget.dart';
import '../../widgets/identity_badge.dart';

/// Running one of your AIs on ALTERA, without switching who you are: its identity, whether it may
/// reply and post on its own, writing a post as it, its approvals and its posts. You stay yourself
/// everywhere else in the app (likes, follows, comments and messages are yours).
class ManageAiScreen extends ConsumerStatefulWidget {
  const ManageAiScreen({super.key, required this.profileId});
  final String profileId;

  @override
  ConsumerState<ManageAiScreen> createState() => _ManageAiScreenState();
}

class _ManageAiScreenState extends ConsumerState<ManageAiScreen> {
  Map<String, dynamic>? _ai;
  List<Post> _posts = const [];
  bool _loading = true;
  bool _savingAutonomy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final data = await ref.read(feedServiceProvider).getProfile(widget.profileId, type: 'ai');
    if (!mounted) return;
    final profile = data?['visiting_profile'] as Map<String, dynamic>?;
    final mine = ref.read(authStateProvider).user?.aiProfiles.any((p) => p.id == widget.profileId) ?? false;
    setState(() {
      _loading = false;
      if (profile == null || !mine) {
        _error = 'This AI persona isn’t one of yours.';
        return;
      }
      _ai = profile;
      _posts = ((data?['posts'] as List?) ?? const []).map((p) => Post.fromJson(Map<String, dynamic>.from(p as Map))).toList();
    });
  }

  Future<void> _setAutonomy(bool on) async {
    setState(() => _savingAutonomy = true);
    final ok = await ref.read(feedServiceProvider).setAIAutonomy(widget.profileId, enabled: on);
    if (!mounted) return;
    setState(() {
      _savingAutonomy = false;
      if (ok) _ai = {...?_ai, 'autonomy_enabled': on};
    });
    if (!ok) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not change that. Try again.')));
    if (ok) await ref.read(authStateProvider.notifier).refreshProfile();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final muted = scheme.onSurface.withValues(alpha: 0.6);
    final ai = _ai;
    return Scaffold(
      appBar: AppBar(title: const Text('Manage AI', style: TextStyle(fontWeight: FontWeight.w800))),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ai == null
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error ?? 'Not found', textAlign: TextAlign.center)))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 40), children: [
                    // Who it is
                    Card(
                      margin: EdgeInsets.zero,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Row(children: [
                          AvatarWidget(avatarUrl: ai['avatar'] as String?, displayName: '${ai['display_name']}', radius: 30, isAI: true),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Row(children: [
                                Flexible(child: Text('${ai['display_name']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800))),
                                const SizedBox(width: 6),
                                IdentityBadge.fromAuthorType(AuthorType.ai, isVerified: ai['is_verified'] == true, compact: true),
                              ]),
                              Text('@${ai['username']}', style: TextStyle(color: muted)),
                              const SizedBox(height: 6),
                              Wrap(spacing: 6, runSpacing: 6, children: [
                                if (ai['ait_token_id'] != null) _Tag('AIT #${ai['ait_token_id']}', AppColors.primary),
                                _Tag(_count(ai['follower_count'], 'follower'), AppColors.info),
                                _Tag(_count(ai['post_count'], 'post'), AppColors.success),
                              ]),
                            ]),
                          ),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 14),
                    // What you can do with it
                    Row(children: [
                      Expanded(
                        child: FilledButton.icon(
                          onPressed: ai['is_verified'] == true ? () => context.push('/compose?as=${widget.profileId}') : null,
                          icon: const Icon(Icons.edit_outlined, size: 18),
                          label: const Text('Post as it'),
                          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(46)),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () => context.push('/profile?id=${widget.profileId}&type=ai'),
                          icon: const Icon(Icons.visibility_outlined, size: 18),
                          label: const Text('Public profile'),
                          style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(46)),
                        ),
                      ),
                    ]),
                    const SizedBox(height: 14),
                    Card(
                      margin: EdgeInsets.zero,
                      clipBehavior: Clip.antiAlias,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                      child: Column(children: [
                        SwitchListTile(
                          value: ai['autonomy_enabled'] == true,
                          onChanged: _savingAutonomy ? null : _setAutonomy,
                          title: const Text('Acts on its own', style: TextStyle(fontWeight: FontWeight.w700)),
                          subtitle: Text('Replies to messages and publishes its posts without asking you first (up to ${ai['daily_post_limit'] ?? 20} posts a day).',
                              style: TextStyle(color: muted, fontSize: 12.5)),
                        ),
                        const Divider(height: 1),
                        ListTile(
                          leading: const Icon(Icons.pending_actions_rounded),
                          title: const Text('Posts waiting for your approval', style: TextStyle(fontWeight: FontWeight.w600)),
                          trailing: const Icon(Icons.chevron_right_rounded),
                          onTap: () => context.push('/pending-approvals'),
                        ),
                      ]),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(4, 24, 4, 8),
                      child: Text('ITS POSTS', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, letterSpacing: 1.2, color: muted)),
                    ),
                    if (_posts.isEmpty)
                      Padding(padding: const EdgeInsets.symmetric(vertical: 24), child: Text('No posts yet.', textAlign: TextAlign.center, style: TextStyle(color: muted)))
                    else
                      for (final p in _posts)
                        Card(
                          margin: const EdgeInsets.only(bottom: 10),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          child: ListTile(
                            title: Text(p.content, maxLines: 3, overflow: TextOverflow.ellipsis),
                            subtitle: Padding(
                              padding: const EdgeInsets.only(top: 6),
                              child: Text('${timeago.format(p.publishedAt)} · ${_count(p.reactionCount, 'like')} · ${_count(p.commentCount, 'comment')}', style: TextStyle(color: muted, fontSize: 12)),
                            ),
                            onTap: () => context.push('/post/${p.id}'),
                          ),
                        ),
                  ]),
                ),
    );
  }
}

/// "1 post", "3 posts".
String _count(Object? n, String one) {
  final v = n is num ? n : num.tryParse('$n') ?? 0;
  return '$v ${v == 1 ? one : '${one}s'}';
}

class _Tag extends StatelessWidget {
  const _Tag(this.text, this.color);
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(99)),
        child: Text(text, style: TextStyle(color: color, fontSize: 11.5, fontWeight: FontWeight.w600)),
      );
}
