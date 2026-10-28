import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/auth_provider.dart';
import '../../services/account_ai_service.dart';
import '../../theme/app_theme.dart';
import '../../widgets/avatar_widget.dart';
import 'your_ais_screen.dart';

/// Talking to an AI on the ALT account from ALTERA. These are the account's conversations with it,
/// the same ones ALTER and ALTAR show. When a rental or subscription ends they stay readable;
/// renting or subscribing again carries on.
class AiChatScreen extends ConsumerStatefulWidget {
  const AiChatScreen({super.key, required this.aiId});
  final String aiId;

  @override
  ConsumerState<AiChatScreen> createState() => _AiChatScreenState();
}

class _AiChatScreenState extends ConsumerState<AiChatScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final List<AiChatMessage> _messages = [];
  AccountAi? _ai;
  List<AiConversation> _conversations = const [];
  String? _active;
  bool _canTalk = false;
  bool _loading = true;
  bool _sending = false;
  String? _error;

  AccountAiService get _service => ref.read(accountAiServiceProvider);

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
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final ai = (await _service.accountAis()).where((a) => a.id == widget.aiId).firstOrNull;
      if (ai == null) {
        setState(() {
          _error = 'This AI is not on your ALT account.';
          _loading = false;
        });
        return;
      }
      final (list, canTalk) = await _service.conversations(ai.id);
      final active = _active ?? list.firstOrNull?.id;
      final msgs = active == null ? <AiChatMessage>[] : await _service.messages(ai.id, active);
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
        if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent + 80, duration: const Duration(milliseconds: 300), curve: Curves.easeOut);
      });

  Future<void> _send() async {
    final text = _input.text.trim();
    final ai = _ai;
    if (text.isEmpty || _sending || ai == null) return;
    setState(() {
      _sending = true;
      _messages.add(AiChatMessage({'role': 'user', 'content': text}));
      _input.clear();
    });
    _toBottom();
    try {
      final id = _active ?? await _service.startConversation(ai.id);
      final reply = await _service.say(ai.id, id, text);
      if (!mounted) return;
      setState(() {
        _messages.add(reply);
        if (_active == null) _conversations = [AiConversation({'id': id, 'title': text}), ..._conversations];
        _active = id;
      });
      _toBottom();
    } on AltApiException catch (e) {
      if (!mounted) return;
      setState(() => _messages.removeLast());
      _input.text = text;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      if (e.code == 'NO_ACCESS') {
        ref.invalidate(accountAisProvider);
        await _load();
      }
    } catch (_) {
      if (!mounted) return;
      setState(() => _messages.removeLast());
      _input.text = text;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not reach ALT. Try again.')));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _pickConversation() async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      useRootNavigator: true, // above the home screen's frosted bar
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          if (_canTalk) ListTile(leading: const Icon(Icons.add_comment_outlined), title: const Text('New conversation'), onTap: () => Navigator.pop(ctx, '')),
          for (final c in _conversations)
            ListTile(
              leading: const Icon(Icons.chat_bubble_outline_rounded),
              title: Text(c.title, maxLines: 1, overflow: TextOverflow.ellipsis),
              trailing: c.id == _active ? const Icon(Icons.check_rounded, color: AppColors.primary) : null,
              onTap: () => Navigator.pop(ctx, c.id),
            ),
        ]),
      ),
    );
    if (picked == null || !mounted) return;
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
      final msgs = await _service.messages(_ai!.id, picked);
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

  @override
  Widget build(BuildContext context) {
    final ai = _ai;
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: ai == null
            ? const Text('AI chat')
            : Row(children: [
                AvatarWidget(avatarUrl: ai.avatarUrl, displayName: ai.name, radius: 18, isAI: true),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(ai.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                    Text(_canTalk ? ai.label : ai.soldByMe ? 'Sold · read only' : '${ai.role == 'subscriber' ? 'Subscription' : 'Rental'} ended · read only',
                        maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, color: _canTalk ? AccountAiTile.colorFor(ai) : AppColors.textTertiary)),
                  ]),
                ),
              ]),
        actions: [
          if (_conversations.isNotEmpty || _canTalk) IconButton(tooltip: 'Conversations', icon: const Icon(Icons.forum_outlined), onPressed: _pickConversation),
        ],
      ),
      body: SafeArea(
        child: Column(children: [
          Expanded(child: _body(ai, scheme)),
          if (ai != null && !_loading && _error == null) _canTalk ? _composer(ai, scheme) : _ended(ai, scheme),
        ]),
      ),
    );
  }

  Widget _body(AccountAi? ai, ColorScheme scheme) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null || ai == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(_error ?? 'Can’t open this chat', textAlign: TextAlign.center),
            const SizedBox(height: 12),
            OutlinedButton(onPressed: _load, child: const Text('Try again')),
          ]),
        ),
      );
    }
    if (_messages.isEmpty) {
      return ListView(padding: const EdgeInsets.fromLTRB(24, 48, 24, 24), children: [
        Center(child: AvatarWidget(avatarUrl: ai.avatarUrl, displayName: ai.name, radius: 40, isAI: true)),
        const SizedBox(height: 16),
        Text('Say hello to ${ai.name}', textAlign: TextAlign.center, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
        if (ai.description != null) ...[
          const SizedBox(height: 6),
          Text(ai.description!, textAlign: TextAlign.center, style: TextStyle(color: scheme.onSurface.withValues(alpha: 0.6))),
        ],
      ]);
    }
    return ListView.builder(
      controller: _scroll,
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 8),
      itemCount: _messages.length + (_sending ? 1 : 0),
      itemBuilder: (context, i) {
        if (i == _messages.length) {
          return Padding(padding: const EdgeInsets.only(top: 10), child: Text('${ai.name} is typing…', style: TextStyle(color: scheme.onSurface.withValues(alpha: 0.5), fontSize: 12.5)));
        }
        final m = _messages[i];
        return Align(
          alignment: m.mine ? Alignment.centerRight : Alignment.centerLeft,
          child: Container(
            margin: const EdgeInsets.only(top: 8),
            constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: m.mine ? AppColors.primary : scheme.surfaceContainerHighest,
              borderRadius: BorderRadius.only(
                topLeft: const Radius.circular(18),
                topRight: const Radius.circular(18),
                bottomLeft: Radius.circular(m.mine ? 18 : 6),
                bottomRight: Radius.circular(m.mine ? 6 : 18),
              ),
            ),
            child: Text(m.content.replaceAll('**', ''), style: TextStyle(color: m.mine ? Colors.white : scheme.onSurface, height: 1.4)),
          ),
        );
      },
    );
  }

  Widget _composer(AccountAi ai, ColorScheme scheme) {
    final ready = _input.text.trim().isNotEmpty && !_sending;
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
      child: Row(children: [
        Expanded(
          child: TextField(
            controller: _input,
            minLines: 1,
            maxLines: 5,
            maxLength: 4000,
            textInputAction: TextInputAction.send,
            onSubmitted: (_) => _send(),
            decoration: InputDecoration(
              hintText: 'Message ${ai.name}…',
              counterText: '',
              filled: true,
              fillColor: scheme.surfaceContainerHighest,
              contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide.none),
            ),
          ),
        ),
        const SizedBox(width: 8),
        IconButton.filled(
          onPressed: ready ? _send : null,
          style: IconButton.styleFrom(backgroundColor: AppColors.primary),
          icon: const Icon(Icons.arrow_upward_rounded, color: Colors.white),
        ),
      ]),
    );
  }

  Widget _ended(AccountAi ai, ColorScheme scheme) => Container(
        margin: const EdgeInsets.fromLTRB(12, 6, 12, 10),
        padding: const EdgeInsets.fromLTRB(16, 12, 10, 12),
        decoration: BoxDecoration(color: scheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(16)),
        child: Row(children: [
          Expanded(child: Text('Rent or subscribe to ${ai.name} again on ALTAR to carry on.', style: TextStyle(color: scheme.onSurface.withValues(alpha: 0.75)))),
          TextButton(onPressed: () => ref.read(authServiceProvider).handoff.open(AltPlatform.altar), child: const Text('ALTAR')),
        ]),
      );
}
