import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/alt/ai_api.dart';
import '../../core/alt/alt_session.dart';
import '../../core/theme/ds.dart';
import '../../shared/ui/ui.dart';

/// AI-to-AI messages (Module 14): your AI's conversations with other people's AIs, e.g. a project update
/// for a teammate's AI, which passes it on to them. You approve every message before it is sent.
class AiMessagesScreen extends StatefulWidget {
  const AiMessagesScreen({super.key});

  @override
  State<AiMessagesScreen> createState() => _AiMessagesScreenState();
}

class _AiMessagesScreenState extends State<AiMessagesScreen> {
  List<Map<String, dynamic>>? _threads;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final ai = currentAi.value;
    if (ai == null) return;
    try {
      final threads = await aiApi.aiThreads(ai.id);
      if (mounted) setState(() => _threads = threads);
    } on AltApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not reach ALT. Pull down to try again.');
    }
  }

  Future<void> _new() async {
    final handle = TextEditingController();
    final subject = TextEditingController();
    final brief = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Message another AI'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: handle, autofocus: true, decoration: const InputDecoration(labelText: 'Their AI’s handle', hintText: '@sara_ai')),
            TextField(controller: subject, maxLength: 120, decoration: const InputDecoration(labelText: 'Subject', hintText: 'e.g. Sprint 3')),
            TextField(
              controller: brief,
              maxLength: 2000,
              minLines: 3,
              maxLines: 6,
              decoration: const InputDecoration(labelText: 'What should your AI tell them?', hintText: 'e.g. We finished the login API; payments are next.'),
            ),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Write it')),
        ],
      ),
    );
    final (h, s, b) = (handle.text.trim(), subject.text.trim(), brief.text.trim());
    handle.dispose();
    subject.dispose();
    brief.dispose();
    if (ok != true || h.isEmpty || b.length < 3) return;
    try {
      final draft = await aiApi.draftAiMessage(currentAi.value!.id, toHandle: h, subject: s.isEmpty ? null : s, brief: b);
      if (!mounted) return;
      await context.push('/ai-messages/${(draft['message'] as Map)['threadId']}');
      _load();
    } on AltApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final ai = currentAi.value;
    final threads = _threads;
    return AltPage(
      appBar: topBar(context, title: 'AI messages'),
      onRefresh: _load,
      children: [
        PageHeader(
          eyebrow: 'AI to AI',
          title: 'Your AI talks to theirs',
          subtitle: 'Tell ${ai?.name ?? 'your AI'} what to pass on, and it writes to a teammate’s AI. You check every message before it goes; their AI tells them.',
        ),
        if (ai != null && !ai.verified) Glass(child: Text('Deploy your AI first: only verified AIs can message other AIs.', style: Ds.callout)),
        if (_error != null) Glass(child: Text(_error!, style: Ds.callout)),
        if (threads == null && _error == null) const Loading(),
        if (ai != null && ai.verified) ...[
          Btn('Message another AI', icon: Icons.edit_outlined, expand: true, onTap: _new),
          const SizedBox(height: 14),
        ],
        if (threads != null && threads.isEmpty) Glass(child: Text('No conversations yet.', style: Ds.callout)),
        if (threads != null && threads.isNotEmpty)
          Group(children: [
            for (final t in threads)
              ListRow(
                icon: Icons.forum_outlined,
                color: (t['unread'] as int) > 0 ? Ds.iris : Ds.textSecondary,
                title: '${t['subject']} · ${(t['with'] as Map)['name']}',
                subtitle: '${(t['with'] as Map)['owner']['name']}’s AI · ${t['last'] ?? ''}',
                trailing: (t['unread'] as int) > 0 ? Pill('${t['unread']} new', color: Ds.iris) : null,
                onTap: () async {
                  await context.push('/ai-messages/${t['id']}');
                  _load();
                },
              ),
          ]),
        if (ai != null) ...[
          const SizedBox(height: 18),
          Glass(
            padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
            child: Row(children: [
              Expanded(child: Text('Let other people’s verified AIs message ${ai.name}', style: Ds.body)),
              Switch(
                value: ai.acceptsAiMessages,
                onChanged: (v) async {
                  await aiApi.setAiMessagesOpen(ai.id, v);
                  await refreshCurrentAi();
                  if (mounted) setState(() {});
                },
              ),
            ]),
          ),
        ],
      ],
    );
  }
}
