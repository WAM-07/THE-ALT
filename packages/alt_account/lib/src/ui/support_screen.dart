import 'package:flutter/material.dart';

import '../client.dart';
import '../errors.dart';
import '../support.dart';

/// Help & support, the same in every ALT app: questions to ALT staff and the reports this person
/// made, answered in the ALT Command Centre. Replies also arrive in the ALT inbox.
class AltSupportScreen extends StatefulWidget {
  const AltSupportScreen({super.key, required this.client});

  final AltAccountClient client;

  @override
  State<AltSupportScreen> createState() => _AltSupportScreenState();
}

class _AltSupportScreenState extends State<AltSupportScreen> {
  late final AltSupport _support = AltSupport(widget.client);
  List<AltCase>? _cases;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final cases = await _support.mine();
      if (!mounted) return;
      setState(() {
        _cases = cases;
        _error = null;
      });
    } on AltApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _cases = _cases ?? [];
        _error = e.message;
      });
    }
  }

  Future<void> _ask() async {
    final created = await Navigator.of(context).push<AltCase>(MaterialPageRoute(builder: (_) => _NewRequestScreen(support: _support)));
    await _load();
    if (created != null && mounted) _openCase(created);
  }

  Future<void> _openCase(AltCase c) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => _CaseScreen(support: _support, id: c.id)));
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cases = _cases;
    return Scaffold(
      appBar: AppBar(title: const Text('Help & support')),
      floatingActionButton: FloatingActionButton.extended(onPressed: _ask, icon: const Icon(Icons.support_agent_outlined), label: const Text('Ask for help')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.only(bottom: 96),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
              child: Text(
                'Ask ALT about your account, payments or an AI. Replies come from the ALT team, here and in your ALT inbox.',
                style: theme.textTheme.bodyMedium,
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
                child: Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
              ),
            if (cases == null)
              const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator()))
            else if (cases.isEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 32, 20, 0),
                child: Text('Nothing here yet. Your requests and reports will show up here.', style: theme.textTheme.bodyMedium?.copyWith(color: theme.hintColor)),
              )
            else
              for (final c in cases)
                ListTile(
                  onTap: () => _openCase(c),
                  leading: Text(c.label, style: theme.textTheme.labelLarge?.copyWith(fontFeatures: const [FontFeature.tabularFigures()])),
                  title: Text(c.title, maxLines: 2, overflow: TextOverflow.ellipsis),
                  subtitle: Text('${c.kindLabel} · ${_ago(c.updatedAt)}'),
                  trailing: _StatusChip(c),
                ),
          ],
        ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip(this.c);
  final AltCase c;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (bg, fg) = c.waitingForYou
        ? (scheme.tertiaryContainer, scheme.onTertiaryContainer)
        : c.closed
            ? (scheme.surfaceContainerHighest, scheme.onSurfaceVariant)
            : (scheme.primaryContainer, scheme.onPrimaryContainer);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(99)),
      child: Text(c.statusLabel, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: fg)),
    );
  }
}

/// What people can ask about. Purchase disputes and appeals against a moderation decision are
/// their own kinds of case, so the right staff see them.
const _topics = [
  ('My account', 'support', 'account'),
  ('Payments & wallet', 'support', 'billing'),
  ('A purchase, rental or subscription', 'dispute', 'marketplace'),
  ('A moderation decision', 'appeal', 'moderation'),
  ('Something else', 'support', 'other'),
];

class _NewRequestScreen extends StatefulWidget {
  const _NewRequestScreen({required this.support});
  final AltSupport support;

  @override
  State<_NewRequestScreen> createState() => _NewRequestScreenState();
}

class _NewRequestScreenState extends State<_NewRequestScreen> {
  var _topic = _topics.first;
  // An appeal names the decision; a dispute names the payment.
  Future<List<AltDecision>>? _decisions;
  Future<List<AltPayment>>? _payments;
  AltDecision? _decision;
  AltPayment? _payment;

  void _pickTopic((String, String, String) t) {
    setState(() {
      _topic = t;
      if (t.$2 == 'appeal') _decisions ??= widget.support.decisions();
      if (t.$2 == 'dispute') _payments ??= widget.support.payments();
    });
  }
  final _title = TextEditingController();
  final _body = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (_title.text.trim().length < 3 || _body.text.trim().isEmpty) {
      setState(() => _error = 'Give it a short title and tell us what happened.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final c = await widget.support.open(
        kind: _topic.$2,
        category: _topic.$3,
        title: _title.text.trim(),
        body: _body.text.trim(),
        appealOf: _topic.$2 == 'appeal' ? _decision?.caseNumber : null,
        subject: _topic.$2 == 'dispute' && _payment != null ? {'type': 'transaction', 'id': _payment!.txHash} : null,
      );
      if (mounted) Navigator.of(context).pop(c);
    } on AltApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = e.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Ask for help')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text('What is it about?', style: theme.textTheme.titleSmall),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final t in _topics) ChoiceChip(label: Text(t.$1), selected: _topic == t, onSelected: (_) => _pickTopic(t)),
            ],
          ),
          if (_topic.$2 == 'appeal')
            _Picker<AltDecision>(
              label: 'Which decision?',
              empty: 'ALT staff have not decided anything about you. You can still tell us what happened.',
              future: _decisions!,
              selected: _decision,
              title: (d) => d.label,
              subtitle: (d) => d.appealed ? 'Already appealed' : d.reason,
              enabled: (d) => !d.appealed,
              onPick: (d) => setState(() {
                _decision = d;
                _title.text = 'Appeal of #${d.caseNumber.toString().padLeft(4, '0')}: ${d.label}';
              }),
            ),
          if (_topic.$2 == 'dispute')
            _Picker<AltPayment>(
              label: 'Which payment?',
              empty: 'No marketplace payments on your account yet.',
              future: _payments!,
              selected: _payment,
              title: (p) => p.summary,
              subtitle: (p) => _ago(p.at),
              enabled: (_) => true,
              onPick: (p) => setState(() {
                _payment = p;
                _title.text = '${p.summary.split(' · ').first} (${_ago(p.at)})';
              }),
            ),
          const SizedBox(height: 20),
          TextField(
            controller: _title,
            maxLength: 140,
            textInputAction: TextInputAction.next,
            decoration: const InputDecoration(labelText: 'Title', hintText: 'e.g. My rental was charged twice'),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _body,
            maxLength: 5000,
            minLines: 5,
            maxLines: 10,
            decoration: const InputDecoration(labelText: 'What happened', hintText: 'Which AI, when, and what you expected. Never share your password.', alignLabelWithHint: true),
          ),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: TextStyle(color: theme.colorScheme.error))),
          const SizedBox(height: 16),
          FilledButton(onPressed: _busy ? null : _send, child: Text(_busy ? 'Sending…' : 'Send to ALT')),
        ],
      ),
    );
  }
}

class _CaseScreen extends StatefulWidget {
  const _CaseScreen({required this.support, required this.id});
  final AltSupport support;
  final String id;

  @override
  State<_CaseScreen> createState() => _CaseScreenState();
}

class _CaseScreenState extends State<_CaseScreen> {
  AltCase? _case;
  List<AltCaseMessage> _messages = const [];
  final _reply = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _reply.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final (c, messages) = await widget.support.get(widget.id);
      if (!mounted) return;
      setState(() {
        _case = c;
        _messages = messages.where((m) => m.body != null).toList();
        _error = null;
      });
    } on AltApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _send() async {
    final text = _reply.text.trim();
    if (text.isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.support.reply(widget.id, text);
      _reply.clear();
      await _load();
    } on AltApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final c = _case;
    return Scaffold(
      appBar: AppBar(title: Text(c?.label ?? 'Case')),
      body: c == null
          ? Center(child: _error != null ? Text(_error!) : const CircularProgressIndicator())
          : Column(
              children: [
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                    children: [
                      Text(c.title, style: theme.textTheme.titleMedium),
                      const SizedBox(height: 6),
                      Row(children: [_StatusChip(c), const SizedBox(width: 8), Flexible(child: Text(c.kindLabel, style: theme.textTheme.bodySmall))]),
                      const SizedBox(height: 16),
                      for (final m in _messages)
                        Align(
                          alignment: m.fromYou ? Alignment.centerRight : Alignment.centerLeft,
                          child: Container(
                            margin: const EdgeInsets.only(bottom: 10),
                            constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.8),
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                            decoration: BoxDecoration(
                              color: m.fromYou ? scheme.primary : scheme.surfaceContainerHighest,
                              borderRadius: BorderRadius.circular(16),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('${m.fromYou ? 'You' : 'ALT team'} · ${_ago(m.at)}',
                                    style: theme.textTheme.labelSmall?.copyWith(color: (m.fromYou ? scheme.onPrimary : scheme.onSurfaceVariant).withValues(alpha: 0.75))),
                                const SizedBox(height: 4),
                                Text(m.body!, style: theme.textTheme.bodyMedium?.copyWith(color: m.fromYou ? scheme.onPrimary : scheme.onSurface)),
                              ],
                            ),
                          ),
                        ),
                      if (c.closed)
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Text('This is closed. If you still need help, ask again with a new request.', style: theme.textTheme.bodySmall),
                        ),
                    ],
                  ),
                ),
                if (_error != null) Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Text(_error!, style: TextStyle(color: scheme.error))),
                if (!c.closed)
                  SafeArea(
                    top: false,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
                      child: Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: _reply,
                              minLines: 1,
                              maxLines: 4,
                              textInputAction: TextInputAction.send,
                              onSubmitted: (_) => _send(),
                              decoration: InputDecoration(hintText: c.waitingForYou ? 'ALT is waiting for your answer…' : 'Add something…'),
                            ),
                          ),
                          IconButton(onPressed: _busy ? null : _send, icon: const Icon(Icons.send_rounded), tooltip: 'Send'),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
    );
  }
}

/// Picks the decision an appeal is about, or the payment a dispute is about.
class _Picker<T> extends StatelessWidget {
  const _Picker({
    required this.label,
    required this.empty,
    required this.future,
    required this.selected,
    required this.title,
    required this.subtitle,
    required this.enabled,
    required this.onPick,
  });

  final String label;
  final String empty;
  final Future<List<T>> future;
  final T? selected;
  final String Function(T) title;
  final String Function(T) subtitle;
  final bool Function(T) enabled;
  final void Function(T) onPick;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: theme.textTheme.titleSmall),
          FutureBuilder<List<T>>(
            future: future,
            builder: (context, snap) {
              if (snap.connectionState != ConnectionState.done) {
                return const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()));
              }
              final items = snap.data ?? <T>[];
              if (items.isEmpty) return Padding(padding: const EdgeInsets.only(top: 8), child: Text(empty, style: theme.textTheme.bodySmall));
              return Column(children: [
                for (final it in items)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    enabled: enabled(it),
                    leading: Icon(it == selected ? Icons.radio_button_checked : Icons.radio_button_unchecked),
                    title: Text(title(it)),
                    subtitle: Text(subtitle(it), maxLines: 2, overflow: TextOverflow.ellipsis),
                    onTap: () => onPick(it),
                  ),
              ]);
            },
          ),
        ],
      ),
    );
  }
}

String _ago(DateTime t) {
  final d = DateTime.now().difference(t);
  if (d.inMinutes < 1) return 'just now';
  if (d.inHours < 1) return '${d.inMinutes} min ago';
  if (d.inDays < 1) return '${d.inHours} h ago';
  return '${d.inDays} d ago';
}
