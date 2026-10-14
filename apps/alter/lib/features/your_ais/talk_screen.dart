import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../../core/alt/ai_api.dart';
import '../../core/alt/alt_session.dart';
import '../../core/theme/ds.dart';
import '../../shared/ui/ui.dart';

/// Talking to an AI the person rents or subscribes to. These are the account's conversations with
/// it, the same ones ALTAR shows, so a chat started there carries on here. Once the time ends they
/// stay readable; renting or subscribing again opens them back up.
class TalkScreen extends StatefulWidget {
  const TalkScreen({super.key, required this.aiId});
  final String aiId;

  @override
  State<TalkScreen> createState() => _TalkScreenState();
}

class _TalkScreenState extends State<TalkScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final List<ChatMsg> _messages = [];
  AccountAi? _ai;
  List<Conversation> _conversations = const [];
  String? _active;
  bool _canTalk = false;
  bool _loading = true;
  bool _sending = false;
  String? _error;

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

  AccountAi? _find() => accountAis.value?.where((a) => a.id == widget.aiId).firstOrNull;

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      if (_find() == null) await loadAccountAis();
      final ai = _find();
      if (ai == null) {
        setState(() {
          _error = 'This AI is not on your ALT account.';
          _loading = false;
        });
        return;
      }
      final (list, canTalk) = await aiApi.conversations(ai.id);
      final active = _active ?? list.firstOrNull?.id;
      final msgs = active == null ? <ChatMsg>[] : await aiApi.conversationMessages(ai.id, active);
      if (!mounted) return;
      setState(() {
        _ai = ai;
        _conversations = list;
        _canTalk = canTalk;
        _active = active;
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
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = 'Could not reach ALT. Check your connection.';
          _loading = false;
        });
      }
    }
  }

  void _toBottom() => WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent + 80, duration: Ds.calm, curve: Ds.ease);
      });

  Future<void> _send() async {
    final text = _input.text.trim();
    final ai = _ai;
    if (text.isEmpty || _sending || ai == null) return;
    setState(() {
      _sending = true;
      _messages.add(ChatMsg({'role': 'user', 'content': text, 'flagged': false}));
      _input.clear();
    });
    _toBottom();
    try {
      final id = _active ?? await aiApi.startConversation(ai.id);
      final reply = await aiApi.say(ai.id, id, text);
      if (!mounted) return;
      setState(() {
        _messages.add(reply);
        if (_active == null) _conversations = [Conversation({'id': id, 'title': text, 'updatedAt': DateTime.now().toIso8601String()}), ..._conversations];
        _active = id;
      });
      _toBottom();
    } on AltApiException catch (e) {
      if (!mounted) return;
      setState(() => _messages.removeLast());
      _input.text = text;
      toast(context, e.message);
      // The rental or subscription may just have ended.
      if (e.code == 'NO_ACCESS') {
        await loadAccountAis();
        await _load();
      }
    } catch (_) {
      if (!mounted) return;
      setState(() => _messages.removeLast());
      _input.text = text;
      toast(context, 'Could not reach ALT. Try again.');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _pickConversation() async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(Ds.gutter, 0, Ds.gutter, 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text('Conversations', style: Ds.title2),
            const SizedBox(height: 14),
            if (_canTalk) ...[
              Btn('New conversation', icon: Icons.add_rounded, onTap: () => Navigator.pop(ctx, ''), kind: BtnKind.secondary),
              const SizedBox(height: 12),
            ],
            Flexible(
              child: ListView(shrinkWrap: true, children: [
                for (final c in _conversations)
                  ListRow(
                    title: c.title,
                    subtitle: _day(c.updatedAt),
                    trailing: c.id == _active ? const Icon(Icons.check_rounded, color: Ds.iris) : null,
                    onTap: () => Navigator.pop(ctx, c.id),
                  ),
              ]),
            ),
          ]),
        ),
      ),
    );
    if (picked == null || !mounted) return;
    final ai = _ai!;
    if (picked.isEmpty) {
      setState(() {
        _active = null;
        _messages.clear();
      });
      return;
    }
    setState(() {
      _active = picked;
      _loading = true;
    });
    try {
      final msgs = await aiApi.conversationMessages(ai.id, picked);
      if (!mounted) return;
      setState(() {
        _messages
          ..clear()
          ..addAll(msgs);
        _loading = false;
      });
      _toBottom();
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  static String _day(DateTime t) {
    final d = DateTime.now().difference(t);
    if (d.inDays < 1) return 'Today';
    if (d.inDays < 2) return 'Yesterday';
    return '${d.inDays} days ago';
  }

  Future<void> _openAltar() async {
    try {
      if (!await altHandoff.open(AltPlatform.altar) && mounted) toast(context, 'ALTAR could not be opened on this device.');
    } on AltApiException catch (e) {
      if (mounted) toast(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ai = _ai;
    return Backdrop(
      animate: false,
      intensity: 0.35,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: topBar(context, actions: [
          if (_conversations.isNotEmpty || _canTalk) RoundIconButton(icon: Icons.forum_outlined, tooltip: 'Conversations', onTap: _pickConversation),
        ]),
        body: SafeArea(
          child: Column(children: [
            if (ai != null) _header(ai),
            Expanded(child: _body(ai)),
            if (ai != null && !_loading && _error == null) _canTalk ? _composer(ai) : _ended(ai),
          ]),
        ),
      ),
    );
  }

  Widget _header(AccountAi ai) => Container(
        padding: const EdgeInsets.fromLTRB(Ds.gutter, 0, Ds.gutter, 12),
        decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Ds.hairline))),
        child: Row(children: [
          AiAvatar(ai: ai, size: 40),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(ai.name, style: Ds.headline, maxLines: 1, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 2),
              Text(_canTalk ? ai.label : '${ai.role == 'subscriber' ? 'Subscription' : 'Rental'} ended · read only',
                  maxLines: 1, overflow: TextOverflow.ellipsis, style: Ds.caption.copyWith(color: _canTalk ? Ds.mint : Ds.textTertiary)),
            ]),
          ),
        ]),
      );

  Widget _body(AccountAi? ai) {
    if (_loading) return const Loading();
    if (_error != null || ai == null) {
      return EmptyState(icon: Icons.cloud_off_rounded, title: 'Can’t open this chat', body: _error, action: Btn('Try again', onTap: _load, kind: BtnKind.secondary, compact: true));
    }
    if (_messages.isEmpty) {
      return SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(Ds.gutter, 40, Ds.gutter, 20),
        child: Column(children: [
          AiAvatar(ai: ai, size: 84).animate().scale(begin: const Offset(0.9, 0.9), duration: Ds.calm, curve: Ds.ease).fadeIn(),
          const SizedBox(height: 18),
          Text('Say hello to ${ai.name}', textAlign: TextAlign.center, style: Ds.title2),
          if (ai.description != null) ...[
            const SizedBox(height: 8),
            Text(ai.description!, textAlign: TextAlign.center, style: Ds.callout),
          ],
        ]),
      );
    }
    return ListView.builder(
      controller: _scroll,
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
      itemCount: _messages.length + (_sending ? 1 : 0),
      itemBuilder: (context, i) {
        if (i == _messages.length) {
          return Padding(
            padding: const EdgeInsets.only(top: 14),
            child: Row(children: [AiAvatar(ai: ai, size: 28, ring: false), const SizedBox(width: 8), Text('${ai.name} is typing…', style: Ds.caption)]),
          );
        }
        final m = _messages[i];
        final first = i == 0 || _messages[i - 1].mine != m.mine;
        return _Bubble(msg: m, ai: ai, showAvatar: !m.mine && first, gapAbove: first ? 14 : 4);
      },
    );
  }

  Widget _composer(AccountAi ai) {
    final ready = _input.text.trim().isNotEmpty && !_sending;
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 6, 14, 10),
      child: Container(
        padding: const EdgeInsets.fromLTRB(18, 4, 6, 4),
        decoration: BoxDecoration(color: Ds.bgRaised, borderRadius: BorderRadius.circular(Ds.r4), border: Border.all(color: Ds.hairlineStrong)),
        child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Expanded(
            child: TextField(
              controller: _input,
              minLines: 1,
              maxLines: 5,
              maxLength: 4000,
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => _send(),
              style: Ds.body,
              decoration: InputDecoration(
                hintText: 'Message ${ai.name}…',
                counterText: '',
                filled: false,
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                contentPadding: const EdgeInsets.symmetric(vertical: 14),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Pressable(
              onTap: ready ? _send : null,
              child: AnimatedContainer(
                duration: Ds.quick,
                width: 42,
                height: 42,
                decoration: BoxDecoration(shape: BoxShape.circle, gradient: ready ? Ds.aurora : null, color: ready ? null : Ds.glassStrong),
                child: Icon(Icons.arrow_upward_rounded, color: ready ? Colors.white : Ds.textTertiary, size: 22),
              ),
            ),
          ),
        ]),
      ),
    );
  }

  Widget _ended(AccountAi ai) => Padding(
        padding: const EdgeInsets.fromLTRB(14, 6, 14, 10),
        child: Glass(
          padding: const EdgeInsets.fromLTRB(16, 14, 12, 14),
          child: Row(children: [
            Expanded(child: Text('Rent or subscribe to ${ai.name} again on ALTAR to carry on.', style: Ds.callout)),
            const SizedBox(width: 10),
            Btn('ALTAR', onTap: _openAltar, kind: BtnKind.secondary, compact: true),
          ]),
        ),
      );
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
    final bubble = Container(
      constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.76),
      padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 11),
      decoration: BoxDecoration(
        color: mine ? Ds.text : Ds.glassStrong,
        borderRadius: BorderRadius.only(
          topLeft: const Radius.circular(20),
          topRight: const Radius.circular(20),
          bottomLeft: Radius.circular(mine ? 20 : 6),
          bottomRight: Radius.circular(mine ? 6 : 20),
        ),
        border: mine ? null : Border.all(color: Ds.hairline),
      ),
      child: mine
          ? Text(msg.content, style: Ds.body.copyWith(fontSize: 14.5, color: Ds.bg, height: 1.45))
          : RichMessage(msg.content, style: Ds.body.copyWith(fontSize: 14.5, color: Ds.text, height: 1.45)),
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
    );
  }
}
