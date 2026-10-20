import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../../../core/alt/ai_api.dart';
import '../../../core/alt/alt_session.dart';
import '../../../core/alt/follows_current_ai.dart';
import '../../../core/theme/ds.dart';
import '../../../shared/ui/ui.dart';

/// Talk to your personal AI (Module 10). Replies come from ALT Core's persona engine, the same
/// engine ALTERA and ALTAR use, so what you test here is what others will meet. Once the AI is
/// live you can switch between your draft (with your latest edits) and the live version.
class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> with FollowsCurrentAi {
  @override
  void onAiSwitched() {
    setState(() {
      _sessionId = null;
      _live = false;
      _messages.clear();
    });
    _load();
  }

  final _input = TextEditingController();
  final _scroll = ScrollController();
  final List<ChatMsg> _messages = [];
  String? _sessionId;
  bool _loading = true;
  bool _sending = false;
  bool _live = false;
  String? _error;

  AltAi? get _ai => currentAi.value;

  static const _starters = ['Who are you?', 'What am I working on?', 'Describe me in one line', 'Remember that I prefer short answers'];

  @override
  void initState() {
    super.initState();
    _input.addListener(() => setState(() {}));
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
    setState(() {
      _loading = true;
      _error = null;
    });
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
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not reach ALT. Check your connection.';
        _loading = false;
      });
    }
  }

  void _toBottom() => WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent + 80, duration: Ds.calm, curve: Ds.ease);
      });

  Future<void> _send([String? preset]) async {
    final text = (preset ?? _input.text).trim();
    final ai = _ai;
    if (text.isEmpty || _sending || ai == null || _sessionId == null) return;
    setState(() {
      _sending = true;
      _messages.add(ChatMsg({'role': 'user', 'content': text, 'flagged': false}));
      _input.clear();
    });
    _toBottom();
    try {
      final (_, reply, memory) = await aiApi.send(ai.id, _sessionId!, text, current: _live);
      if (!mounted) return;
      setState(() => _messages.add(reply));
      _toBottom();
      if (memory != null) _offerMemory(ai.id, memory);
    } on AltApiException catch (e) {
      if (!mounted) return;
      setState(() => _messages.removeLast());
      _input.text = text;
      toast(context, e.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _messages.removeLast());
      _input.text = text;
      toast(context, 'Could not reach ALT. Try again.');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  void _offerMemory(String aiId, Map<String, dynamic> memory) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      duration: const Duration(seconds: 8),
      content: Text('Remember “${memory['content']}”?'),
      action: SnackBarAction(label: 'Remember', onPressed: () => aiApi.decideMemory(aiId, memory['id'] as String, true).then((_) => refreshCurrentAi())),
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
          padding: EdgeInsets.fromLTRB(24, 0, 24, 24 + MediaQuery.of(ctx).viewInsets.bottom),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Personality', style: Ds.title2),
            const SizedBox(height: 6),
            Text('Changes apply to your draft right away. Publish a new version to update ALTERA and ALTAR.', style: Ds.callout),
            const SizedBox(height: 22),
            _slider('Creativity', 'Predictable', 'Imaginative', creativity, (v) => set(() => creativity = v)),
            _slider('Sticks to facts', 'Free', 'Strict', strictness, (v) => set(() => strictness = v)),
            Text('TONE', style: Ds.overline),
            const SizedBox(height: 10),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final t in ['casual', 'friendly', 'professional', 'playful', 'formal'])
                ChoiceChip(label: Text(t[0].toUpperCase() + t.substring(1)), selected: tone == t, onSelected: (_) => set(() => tone = t)),
            ]),
            const SizedBox(height: 18),
            Text('REPLY LENGTH', style: Ds.overline),
            const SizedBox(height: 10),
            Wrap(spacing: 8, children: [
              for (final v in ['short', 'medium', 'long']) ChoiceChip(label: Text(v[0].toUpperCase() + v.substring(1)), selected: verbosity == v, onSelected: (_) => set(() => verbosity = v)),
            ]),
            const SizedBox(height: 26),
            Btn('Save personality', onTap: () => Navigator.pop(ctx, true), expand: true),
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
      if (mounted) toast(context, 'Personality updated in your draft');
    } on AltApiException catch (e) {
      if (mounted) toast(context, e.message);
    }
  }

  static Widget _slider(String label, String low, String high, double value, ValueChanged<double> onChanged) => Padding(
        padding: const EdgeInsets.only(bottom: 18),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [Expanded(child: Text(label, style: Ds.bodyStrong)), Text('${(value * 100).round()}%', style: Ds.caption)]),
          Slider(value: value, onChanged: onChanged, padding: const EdgeInsets.symmetric(vertical: 8)),
          Row(children: [Text(low, style: Ds.caption.copyWith(color: Ds.textTertiary)), const Spacer(), Text(high, style: Ds.caption.copyWith(color: Ds.textTertiary))]),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final ai = _ai;
    return Backdrop(
      animate: false,
      intensity: 0.35,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          bottom: false,
          child: Column(children: [
            if (ai != null) _header(ai),
            Expanded(child: _body(ai)),
            _composer(ai),
          ]),
        ),
      ),
    );
  }

  Widget _header(AltAi ai) => Container(
        padding: const EdgeInsets.fromLTRB(Ds.gutter, 10, 14, 12),
        decoration: BoxDecoration(border: Border(bottom: BorderSide(color: Ds.hairline))),
        child: Row(children: [
          AiAvatar(ai: ai, size: 40),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(ai.name, style: Ds.headline, maxLines: 1, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 4),
              // Once the AI is live you can test the draft against what others meet.
              if (ai.verified)
                Align(alignment: Alignment.centerLeft, child: _Segmented(live: _live, liveVersion: ai.currentVersion, onChanged: (v) => setState(() => _live = v)))
              else
                Row(children: [
                  Container(width: 7, height: 7, decoration: BoxDecoration(shape: BoxShape.circle, color: Ds.iris)),
                  const SizedBox(width: 6),
                  Flexible(child: Text('Draft · your latest edits', style: Ds.caption, maxLines: 1, overflow: TextOverflow.ellipsis)),
                ]),
            ]),
          ),
          const SizedBox(width: 8),
          RoundIconButton(icon: Icons.tune_rounded, tooltip: 'Personality', onTap: _tunePersonality),
        ]),
      );

  Widget _body(AltAi? ai) {
    if (ai == null || _loading) return const Loading();
    if (_error != null) {
      return EmptyState(icon: Icons.cloud_off_rounded, title: 'Chat is unavailable', body: _error, action: Btn('Try again', onTap: _load, kind: BtnKind.secondary, compact: true));
    }
    if (_messages.isEmpty) {
      return SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(Ds.gutter, 40, Ds.gutter, 20),
        child: Column(children: [
          AiAvatar(ai: ai, size: 84).animate().scale(begin: const Offset(0.9, 0.9), duration: Ds.calm, curve: Ds.ease).fadeIn(),
          const SizedBox(height: 18),
          Text('Say hello to ${ai.name}', textAlign: TextAlign.center, style: Ds.title2),
          const SizedBox(height: 8),
          Text('Test whether it sounds like you. Start a sentence with “Remember that…” to teach it something new.', textAlign: TextAlign.center, style: Ds.callout),
          const SizedBox(height: 26),
          Wrap(alignment: WrapAlignment.center, spacing: 8, runSpacing: 10, children: [
            for (final s in _starters)
              Pressable(
                onTap: () => _send(s),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(color: Ds.glass, borderRadius: BorderRadius.circular(99), border: Border.all(color: Ds.hairline)),
                  child: Text(s, style: Ds.caption.copyWith(color: Ds.text, fontSize: 13)),
                ),
              ),
          ]),
        ]),
      );
    }
    return ListView.builder(
      controller: _scroll,
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
      itemCount: _messages.length + (_sending ? 1 : 0),
      itemBuilder: (context, i) {
        if (i == _messages.length) return _Typing(ai: ai);
        final m = _messages[i];
        final firstOfRun = i == 0 || _messages[i - 1].mine != m.mine;
        return _Bubble(msg: m, ai: ai, showAvatar: !m.mine && firstOfRun, gapAbove: firstOfRun ? 14 : 4);
      },
    );
  }

  Widget _composer(AltAi? ai) {
    final ready = _input.text.trim().isNotEmpty && !_sending;
    return Padding(
      // Sits just above the floating dock.
      // The shell already reports the dock in the bottom padding.
      padding: EdgeInsets.fromLTRB(14, 6, 14, MediaQuery.of(context).padding.bottom + 10),
      child: Container(
        padding: const EdgeInsets.fromLTRB(18, 4, 6, 4),
        decoration: BoxDecoration(color: Ds.isObsidian ? const Color(0xFF15151D) : Color.alphaBlend(Ds.glassStrong, Ds.bgRaised), borderRadius: BorderRadius.circular(Ds.r4), border: Border.all(color: Ds.hairlineStrong)),
        child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Expanded(
            child: TextField(
              controller: _input,
              minLines: 1,
              maxLines: 5,
              enabled: ai != null && _error == null,
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => _send(),
              style: Ds.body,
              decoration: InputDecoration(
                hintText: ai == null ? 'Message' : 'Message ${ai.name}…',
                filled: false,
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                disabledBorder: InputBorder.none,
                contentPadding: const EdgeInsets.symmetric(vertical: 14),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Pressable(
              onTap: ready ? () => _send() : null,
              child: AnimatedContainer(
                duration: Ds.quick,
                width: 42,
                height: 42,
                decoration: BoxDecoration(shape: BoxShape.circle, gradient: ready ? Ds.aurora : null, color: ready ? null : Ds.glassStrong),
                child: Icon(Icons.arrow_upward_rounded, color: ready ? Ds.onAccent : Ds.textTertiary, size: 22),
              ),
            ),
          ),
        ]),
      ),
    );
  }
}

class _Segmented extends StatelessWidget {
  const _Segmented({required this.live, required this.onChanged, this.liveVersion});
  final bool live;
  final int? liveVersion;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    Widget seg(String label, bool value) => Pressable(
          onTap: () => onChanged(value),
          child: AnimatedContainer(
            duration: Ds.quick,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(color: live == value ? Ds.glassStrong : Colors.transparent, borderRadius: BorderRadius.circular(99)),
            child: Text(label, style: Ds.caption.copyWith(fontSize: 12, color: live == value ? Ds.text : Ds.textTertiary, fontWeight: FontWeight.w600)),
          ),
        );
    return Container(
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(99), border: Border.all(color: Ds.hairline)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [seg('Draft', false), seg(liveVersion == null ? 'Live' : 'Live v$liveVersion', true)]),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.msg, required this.ai, required this.showAvatar, required this.gapAbove});
  final ChatMsg msg;
  final AltAi ai;
  final bool showAvatar;
  final double gapAbove;

  @override
  Widget build(BuildContext context) {
    final mine = msg.mine;
    final maxW = MediaQuery.of(context).size.width * 0.76;
    final bubble = Container(
      constraints: BoxConstraints(maxWidth: maxW),
      padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 11),
      decoration: BoxDecoration(
        color: mine ? Ds.text : Ds.glassStrong,
        borderRadius: BorderRadius.only(
          topLeft: const Radius.circular(20),
          topRight: const Radius.circular(20),
          bottomLeft: Radius.circular(mine ? 20 : 6),
          bottomRight: Radius.circular(mine ? 6 : 20),
        ),
        border: mine ? null : Border.all(color: msg.flagged ? Ds.amber.withValues(alpha: 0.6) : Ds.hairline),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (msg.flagged) ...[
          Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(Icons.shield_outlined, size: 14, color: Ds.amber),
            const SizedBox(width: 5),
            Text('Held back by ALT’s safety rules', style: Ds.caption.copyWith(color: Ds.amber, fontSize: 11.5)),
          ]),
          const SizedBox(height: 4),
        ],
        mine
            ? Text(msg.content, style: Ds.body.copyWith(fontSize: 14.5, color: Ds.bg, height: 1.45))
            : RichMessage(msg.content, style: Ds.body.copyWith(fontSize: 14.5, color: Ds.text, height: 1.45)),
        if (!mine && msg.styleScore != null) ...[
          const SizedBox(height: 6),
          Text('Sounds like you · ${(msg.styleScore! * 100).round()}%',
              style: Ds.caption.copyWith(color: Ds.textTertiary, fontSize: 11.5)),
        ],
      ]),
    );
    return Padding(
      padding: EdgeInsets.only(top: gapAbove),
      child: Row(
        mainAxisAlignment: mine ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (!mine) ...[SizedBox(width: 28, child: showAvatar ? AiAvatar(ai: ai, size: 28, ring: false) : null), const SizedBox(width: 8)],
          Flexible(child: bubble),
        ],
      ),
    ).animate().fadeIn(duration: 220.ms).slideY(begin: 0.15, curve: Ds.ease, duration: 260.ms);
  }
}

class _Typing extends StatelessWidget {
  const _Typing({required this.ai});
  final AltAi ai;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 14),
        child: Row(children: [
          AiAvatar(ai: ai, size: 28, ring: false),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: BoxDecoration(color: Ds.glassStrong, borderRadius: BorderRadius.circular(20), border: Border.all(color: Ds.hairline)),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              for (var i = 0; i < 3; i++)
                Container(
                  margin: const EdgeInsets.symmetric(horizontal: 2.5),
                  width: 7,
                  height: 7,
                  decoration: BoxDecoration(color: Ds.textSecondary, shape: BoxShape.circle),
                ).animate(onPlay: (c) => c.repeat()).fadeIn(delay: (i * 160).ms, duration: 300.ms).then().fadeOut(duration: 300.ms),
            ]),
          ),
        ]),
      );
}
