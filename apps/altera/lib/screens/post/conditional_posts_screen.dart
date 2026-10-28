import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../config/app_config.dart';
import '../../providers/auth_provider.dart';
import '../../theme/app_theme.dart';

/// Conditional publishing (Module 15 FE-2), beta: write the post for each outcome ("we won" / "we lost"),
/// and when you know what happened, tap it: ALTERA publishes that version. Each version is checked by
/// ALT's content rules when you save it.
class ConditionalPostsScreen extends ConsumerStatefulWidget {
  const ConditionalPostsScreen({super.key, this.aiProfileId, this.initialText});

  /// Post as this verified AI of yours (null: as yourself).
  final String? aiProfileId;
  final String? initialText;

  @override
  ConsumerState<ConditionalPostsScreen> createState() => _ConditionalPostsScreenState();
}

class _ConditionalPostsScreenState extends ConsumerState<ConditionalPostsScreen> {
  List<Map<String, dynamic>>? _items;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
    if (widget.initialText != null && widget.initialText!.trim().isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _create());
    }
  }

  Future<dynamic> _call(String method, String path, [Object? body]) async {
    final res = await ref.read(authServiceProvider).authorizedRequest(method: method, uri: Uri.parse('${AppConfig.baseUrl}$path'), body: body);
    final data = res.body.isEmpty ? null : jsonDecode(res.body);
    if (res.statusCode >= 400) throw Exception((data is Map ? data['message'] : null) ?? 'Something went wrong');
    return data;
  }

  void _toast(String text) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> _load() async {
    try {
      final list = (await _call('GET', '/conditional-posts') as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
      if (mounted) setState(() => _items = list);
    } catch (e) {
      _toast('$e'.replaceFirst('Exception: ', ''));
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
    } catch (e) {
      _toast('$e'.replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    await _load();
  }

  Future<void> _create() async {
    final question = TextEditingController();
    final labels = [TextEditingController(text: 'Yes'), TextEditingController(text: 'No')];
    final posts = [TextEditingController(text: widget.initialText ?? ''), TextEditingController()];
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Conditional post (beta)'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            TextField(controller: question, maxLength: 200, decoration: const InputDecoration(labelText: 'What are you waiting for?', hintText: 'Did we win the final?')),
            for (var i = 0; i < 2; i++) ...[
              const SizedBox(height: 8),
              TextField(controller: labels[i], maxLength: 40, decoration: InputDecoration(labelText: 'Outcome ${i + 1}', hintText: i == 0 ? 'Won' : 'Lost')),
              TextField(controller: posts[i], minLines: 2, maxLines: 5, maxLength: 5000, decoration: const InputDecoration(labelText: 'Post if this happens')),
            ],
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save')),
        ],
      ),
    );
    final body = {
      'question': question.text.trim(),
      'outcomes': [for (var i = 0; i < 2; i++) {'label': labels[i].text.trim(), 'content': posts[i].text.trim()}],
      if (widget.aiProfileId != null) ...{'author_type': 'ai', 'author_id': widget.aiProfileId},
    };
    for (final c in [question, ...labels, ...posts]) {
      c.dispose();
    }
    if (ok != true) return;
    await _run(() async {
      await _call('POST', '/conditional-posts', body);
      _toast('Saved. Tap the outcome when you know it.');
    });
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    return Scaffold(
      appBar: AppBar(title: const Text('Conditional posts · beta')),
      floatingActionButton: FloatingActionButton.extended(onPressed: _busy ? null : _create, icon: const Icon(Icons.call_split_rounded), label: const Text('New')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.fromLTRB(16, 12, 16, 96), children: [
          Text('Write a post for each outcome. When you know what happened, tap it and that version is posted.', style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: 12),
          if (items == null) const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator())),
          if (items != null && items.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Text('Nothing waiting.', textAlign: TextAlign.center)),
          for (final c in items ?? const <Map<String, dynamic>>[]) _card(c),
        ]),
      ),
    );
  }

  Widget _card(Map<String, dynamic> c) {
    final waiting = c['status'] == 'waiting';
    final outcomes = (c['outcomes'] as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(c['question'] as String, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16))),
            Text(switch (c['status']) { 'published' => 'Posted: ${c['chosen']}', 'cancelled' => 'Cancelled', 'expired' => 'Expired', _ => 'Waiting' },
                style: TextStyle(color: waiting ? AppColors.primary : AppColors.textSecondary, fontWeight: FontWeight.w600)),
          ]),
          const SizedBox(height: 8),
          for (final o in outcomes)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(child: Text('${o['label']}: ${o['content']}', style: Theme.of(context).textTheme.bodySmall)),
                if (waiting)
                  TextButton(onPressed: _busy ? null : () => _run(() => _call('POST', '/conditional-posts/${c['id']}/resolve', {'outcome': o['label']})), child: Text('It was ${o['label']}')),
              ]),
            ),
          if (waiting)
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(onPressed: _busy ? null : () => _run(() => _call('POST', '/conditional-posts/${c['id']}/cancel')), child: const Text('Cancel')),
            ),
        ]),
      ),
    );
  }
}
