import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';

import '../../core/alt/ai_api.dart';
import '../../core/alt/alt_session.dart';
import '../../core/theme/ds.dart';
import '../../shared/ui/ui.dart';

/// One conversation between your AI and another person's AI. You brief your AI, it writes the message,
/// and you send it as written or edited, or discard it.
class AiThreadScreen extends StatefulWidget {
  const AiThreadScreen({super.key, required this.threadId});
  final String threadId;

  @override
  State<AiThreadScreen> createState() => _AiThreadScreenState();
}

class _AiThreadScreenState extends State<AiThreadScreen> {
  Map<String, dynamic>? _thread;
  final _brief = TextEditingController();
  bool _busy = false;

  String get _aiId => currentAi.value!.id;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _brief.dispose();
    super.dispose();
  }

  void _toast(String text) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> _load() async {
    try {
      final t = await aiApi.aiThread(_aiId, widget.threadId);
      if (mounted) setState(() => _thread = t);
    } on AltApiException catch (e) {
      _toast(e.message);
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
    } on AltApiException catch (e) {
      _toast(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    await _load();
  }

  Future<void> _write() async {
    final brief = _brief.text.trim();
    if (brief.length < 3) return _toast('Tell your AI what to say.');
    await _run(() async {
      await aiApi.draftAiMessage(_aiId, threadId: widget.threadId, brief: brief);
      _brief.clear();
    });
  }

  Future<void> _edit(Map<String, dynamic> m) async {
    final text = TextEditingController(text: m['content'] as String);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Edit before sending'),
        content: TextField(controller: text, minLines: 3, maxLines: 10, maxLength: 4000),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Send')),
        ],
      ),
    );
    final edited = text.text.trim();
    text.dispose();
    if (ok == true && edited.isNotEmpty) await _run(() => aiApi.sendAiMessage(_aiId, m['id'] as String, content: edited));
  }

  @override
  Widget build(BuildContext context) {
    final t = _thread;
    final messages = ((t?['messages'] as List?) ?? []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    final other = t == null ? null : Map<String, dynamic>.from(t['with'] as Map);
    return AltPage(
      appBar: topBar(context, title: t?['subject'] as String? ?? 'AI messages'),
      onRefresh: _load,
      children: [
        if (t == null) const Loading(),
        if (other != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text('With ${other['name']} (@${other['handle']}), ${(other['owner'] as Map)['name']}’s AI', style: Ds.caption),
          ),
        for (final m in messages) _bubble(m),
        if (t != null) ...[
          const SizedBox(height: 12),
          Glass(
            padding: const EdgeInsets.all(12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              TextField(
                controller: _brief,
                minLines: 2,
                maxLines: 5,
                maxLength: 2000,
                decoration: InputDecoration(hintText: 'What should ${currentAi.value?.name ?? 'your AI'} tell them?', border: InputBorder.none),
              ),
              Btn(_busy ? 'Writing…' : 'Let my AI write it', icon: Icons.auto_awesome_outlined, onTap: _busy ? null : _write),
            ]),
          ),
        ],
      ],
    );
  }

  Widget _bubble(Map<String, dynamic> m) {
    final mine = m['mine'] == true;
    final draft = m['status'] == 'draft';
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 520),
        child: Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Glass(
            tint: draft ? Ds.amber : (mine ? Ds.iris : null),
            padding: const EdgeInsets.all(14),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(draft ? 'DRAFT · ONLY YOU SEE THIS' : (mine ? 'YOUR AI' : 'THEIR AI'), style: Ds.overline.copyWith(fontSize: 10)),
              const SizedBox(height: 4),
              Text(m['content'] as String, style: Ds.body),
              if (draft && m['brief'] != null) ...[
                const SizedBox(height: 6),
                Text('Your brief: ${m['brief']}', style: Ds.caption),
              ],
              if (draft) ...[
                const SizedBox(height: 10),
                Wrap(spacing: 8, runSpacing: 8, children: [
                  Btn('Send', icon: Icons.send_rounded, compact: true, onTap: _busy ? null : () => _run(() => aiApi.sendAiMessage(_aiId, m['id'] as String))),
                  Btn('Edit', kind: BtnKind.secondary, compact: true, onTap: _busy ? null : () => _edit(m)),
                  Btn('Discard', kind: BtnKind.ghost, compact: true, onTap: _busy ? null : () => _run(() => aiApi.discardAiDraft(_aiId, m['id'] as String))),
                ]),
              ],
            ]),
          ),
        ),
      ),
    );
  }
}
