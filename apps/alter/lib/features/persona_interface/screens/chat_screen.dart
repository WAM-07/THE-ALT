import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';

import '../../../core/alt/ai_api.dart';
import '../../../core/alt/alt_session.dart';
import '../../../core/theme/colors.dart';
import '../../../core/theme/gradients.dart';
import '../../../core/theme/typography.dart';
import '../../../shared/widgets/gradient_background.dart';

/// Talk to your personal AI (Module 10). Replies come from ALT Core's persona engine, the same
/// engine ALTERA and ALTAR use, so what you test here is what others will meet.
class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final List<ChatMsg> _messages = [];
  String? _sessionId;
  bool _loading = true;
  bool _sending = false;
  String? _error;

  AltAi? get _ai => currentAi.value;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final ai = _ai;
    if (ai == null) return;
    try {
      final sid = await aiApi.latestOrNewSession(ai.id);
      final msgs = await aiApi.messages(ai.id, sid);
      if (!mounted) return;
      setState(() {
        _sessionId = sid;
        _messages
          ..clear()
          ..addAll(msgs);
        _loading = false;
      });
      _toBottom();
    } on AltApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _loading = false;
        });
      }
    }
  }

  void _toBottom() => WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
      });

  Future<void> _send() async {
    final text = _input.text.trim();
    final ai = _ai;
    if (text.isEmpty || _sending || ai == null || _sessionId == null) return;
    setState(() {
      _sending = true;
      _messages.add(ChatMsg({'role': 'user', 'content': text, 'flagged': false}));
      _input.clear();
    });
    _toBottom();
    try {
      final (_, reply, memory) = await aiApi.send(ai.id, _sessionId!, text);
      if (!mounted) return;
      setState(() => _messages.add(reply));
      _toBottom();
      if (memory != null) _offerMemory(ai.id, memory);
    } on AltApiException catch (e) {
      if (!mounted) return;
      setState(() => _messages.removeLast());
      _input.text = text;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  void _offerMemory(String aiId, Map<String, dynamic> memory) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      duration: const Duration(seconds: 8),
      content: Text('Remember: “${memory['content']}”?'),
      action: SnackBarAction(
        label: 'Approve',
        onPressed: () => aiApi.decideMemory(aiId, memory['id'] as String, true),
      ),
    ));
  }

  Future<void> _tunePersonality() async {
    final ai = _ai;
    if (ai == null) return;
    final persona = ai.persona;
    final style = Map<String, dynamic>.from(persona['style'] as Map? ?? {});
    double creativity = (style['creativity'] as num?)?.toDouble() ?? 0.6;
    double strictness = (style['strictness'] as num?)?.toDouble() ?? 0.5;
    String tone = style['tone'] as String? ?? 'friendly';
    String verbosity = style['verbosity'] as String? ?? 'medium';
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => Padding(
          padding: EdgeInsets.fromLTRB(24, 24, 24, 24 + MediaQuery.of(ctx).viewInsets.bottom),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Personality', style: ALTTypography.headlineMedium),
            const SizedBox(height: 4),
            const Text('Changes apply to your draft right away. Publish a new version to update ALTERA and ALTAR.', style: ALTTypography.bodySmall),
            const SizedBox(height: 16),
            Text('Creativity ${(creativity * 100).round()}%', style: ALTTypography.labelLarge),
            Slider(value: creativity, onChanged: (v) => set(() => creativity = v)),
            Text('Sticks to facts ${(strictness * 100).round()}%', style: ALTTypography.labelLarge),
            Slider(value: strictness, onChanged: (v) => set(() => strictness = v)),
            const SizedBox(height: 8),
            Wrap(spacing: 8, children: [
              for (final t in ['casual', 'friendly', 'professional', 'playful', 'formal'])
                ChoiceChip(label: Text(t), selected: tone == t, onSelected: (_) => set(() => tone = t)),
            ]),
            const SizedBox(height: 8),
            Wrap(spacing: 8, children: [
              for (final v in ['short', 'medium', 'long'])
                ChoiceChip(label: Text('$v replies'), selected: verbosity == v, onSelected: (_) => set(() => verbosity = v)),
            ]),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                style: FilledButton.styleFrom(backgroundColor: ALTColors.irisViolet),
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Save'),
              ),
            ),
          ]),
        ),
      ),
    );
    if (saved != true) return;
    try {
      currentAi.value = await aiApi.updatePersona(ai.id, {
        ...persona,
        'style': {...style, 'creativity': creativity, 'strictness': strictness, 'tone': tone, 'verbosity': verbosity},
      });
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Personality updated in your draft')));
    } on AltApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bubbleMine = ALTColors.irisViolet;
    final bubbleAi = isDark ? ALTColors.darkBgSurface02 : ALTColors.lightBgSurface02;
    return GradientBackground(
      baseColor: isDark ? ALTColors.darkBgPage : ALTColors.lightBgPage,
      layers: isDark ? ALTGradients.alterDark : ALTGradients.alterLight,
      animate: false,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: AppBar(
          backgroundColor: Colors.transparent,
          elevation: 0,
          title: Text(_ai?.name ?? 'Chat', style: ALTTypography.headlineMedium),
          actions: [IconButton(icon: const Icon(Icons.tune), tooltip: 'Personality', onPressed: _tunePersonality)],
        ),
        body: Padding(
          padding: const EdgeInsets.only(bottom: 96),
          child: Column(children: [
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null
                      ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!, textAlign: TextAlign.center)))
                      : _messages.isEmpty
                          ? const Center(
                              child: Padding(
                                padding: EdgeInsets.all(32),
                                child: Text('Say hello. Test whether it sounds like you.\nTip: “Remember that …” teaches it something new.', textAlign: TextAlign.center),
                              ),
                            )
                          : ListView.builder(
                              controller: _scroll,
                              padding: const EdgeInsets.all(16),
                              itemCount: _messages.length + (_sending ? 1 : 0),
                              itemBuilder: (context, i) {
                                if (i == _messages.length) {
                                  return const Align(alignment: Alignment.centerLeft, child: Padding(padding: EdgeInsets.all(8), child: Text('…')));
                                }
                                final m = _messages[i];
                                return Align(
                                  alignment: m.mine ? Alignment.centerRight : Alignment.centerLeft,
                                  child: Container(
                                    margin: const EdgeInsets.symmetric(vertical: 4),
                                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                                    constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
                                    decoration: BoxDecoration(color: m.mine ? bubbleMine : bubbleAi, borderRadius: BorderRadius.circular(18)),
                                    child: Text(m.content, style: TextStyle(color: m.mine ? Colors.white : null)),
                                  ),
                                );
                              },
                            ),
            ),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 8, 8),
                child: Row(children: [
                  Expanded(
                    child: TextField(
                      controller: _input,
                      minLines: 1,
                      maxLines: 4,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _send(),
                      decoration: const InputDecoration(hintText: 'Message your AI…', border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(24)))),
                    ),
                  ),
                  IconButton(icon: const Icon(Icons.send, color: ALTColors.irisViolet), onPressed: _sending ? null : _send),
                ]),
              ),
            ),
          ]),
        ),
      ),
    );
  }
}
