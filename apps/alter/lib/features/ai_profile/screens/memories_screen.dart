import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';

import '../../../core/alt/ai_api.dart';
import '../../../core/alt/alt_session.dart';
import '../../../core/theme/colors.dart';
import '../../../core/theme/gradients.dart';
import '../../../core/theme/typography.dart';
import '../../../shared/ui/ui.dart';
import '../../../shared/widgets/gradient_background.dart';

/// What your AI remembers about you (Module 10 FE-6). Suggestions from chats wait for your approval;
/// approved memories go into the next version you build.
class MemoriesScreen extends StatefulWidget {
  const MemoriesScreen({super.key});

  @override
  State<MemoriesScreen> createState() => _MemoriesScreenState();
}

class _MemoriesScreenState extends State<MemoriesScreen> {
  List<AiMemory>? _all;
  String? _error;
  final Set<String> _busy = {};

  String? get _aiId => currentAi.value?.id;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final id = _aiId;
    if (id == null) return;
    try {
      final all = await aiApi.memories(id);
      if (!mounted) return;
      setState(() {
        _all = all;
        _error = null;
      });
    } on AltApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not reach ALT. Pull down to try again.');
    }
  }

  void _toast(String text) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> _decide(AiMemory m, bool keep) async {
    setState(() => _busy.add(m.id));
    try {
      await aiApi.decideMemory(_aiId!, m.id, keep);
      await _load();
      refreshCurrentAi().ignore();
      _toast(keep ? 'Remembered. It goes into your next version.' : (m.status == 'approved' ? 'Forgotten' : 'Dismissed'));
    } on AltApiException catch (e) {
      _toast(e.message);
    } catch (_) {
      _toast('Could not reach ALT. Try again.');
    } finally {
      if (mounted) setState(() => _busy.remove(m.id));
    }
  }

  Future<void> _forget(AiMemory m) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Forget this?'),
        content: Text('“${m.content}”\n\nYour AI stops using it from the next version you build.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Forget')),
        ],
      ),
    );
    if (ok == true) await _decide(m, false);
  }

  Future<void> _teach() async {
    final input = TextEditingController();
    final text = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Teach your AI something'),
        content: TextField(
          controller: input,
          autofocus: true,
          maxLength: 500,
          maxLines: 4,
          minLines: 2,
          decoration: const InputDecoration(hintText: 'e.g. I prefer short answers in the morning'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, input.text.trim()), child: const Text('Remember')),
        ],
      ),
    );
    input.dispose();
    if (text == null) return;
    if (text.length < 3) return _toast('Write at least a few words.');
    try {
      await aiApi.addMemory(_aiId!, text);
      await _load();
      refreshCurrentAi().ignore();
      _toast('Remembered. It goes into your next version.');
    } on AltApiException catch (e) {
      _toast(e.message);
    } catch (_) {
      _toast('Could not reach ALT. Try again.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final suggested = _all?.where((m) => m.status == 'proposed').toList() ?? [];
    final kept = _all?.where((m) => m.status == 'approved').toList() ?? [];
    return GradientBackground(
      baseColor: isDark ? ALTColors.darkBgPage : ALTColors.lightBgPage,
      layers: isDark ? ALTGradients.alterDark : ALTGradients.alterLight,
      animate: false,
      child: DefaultTabController(
        length: 2,
        initialIndex: suggested.isNotEmpty ? 0 : 1,
        child: Scaffold(
          backgroundColor: Colors.transparent,
          appBar: topBar(
            context,
            title: 'Memories',
            bottom: TabBar(tabs: [Tab(text: 'Suggested · ${suggested.length}'), Tab(text: 'Remembered · ${kept.length}')]),
          ),
          floatingActionButton: Btn('Teach it something', icon: Icons.add_rounded, onTap: _aiId == null ? null : _teach),
          body: _all == null
              ? Center(
                  child: _error == null
                      ? const CircularProgressIndicator(color: ALTColors.irisViolet)
                      : _Message(icon: Icons.cloud_off, title: _error!, action: TextButton(onPressed: _load, child: const Text('Try again'))),
                )
              : TabBarView(children: [
                  _list(
                    suggested,
                    empty: const _Message(
                      icon: Icons.lightbulb_outline,
                      title: 'No suggestions right now',
                      body: 'When you tell your AI something worth remembering in Chat, it asks you here first. Nothing is kept without your approval.',
                    ),
                    tile: (m) => Card(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(16, 12, 8, 4),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(m.content, style: ALTTypography.bodyMedium),
                          const SizedBox(height: 4),
                          Text('Suggested during a chat', style: ALTTypography.bodySmall),
                          Row(mainAxisAlignment: MainAxisAlignment.end, children: [
                            TextButton(onPressed: _busy.contains(m.id) ? null : () => _decide(m, false), child: const Text('Dismiss')),
                            FilledButton.tonal(onPressed: _busy.contains(m.id) ? null : () => _decide(m, true), child: const Text('Remember')),
                          ]),
                        ]),
                      ),
                    ),
                  ),
                  _list(
                    kept,
                    empty: const _Message(
                      icon: Icons.psychology_alt_outlined,
                      title: 'Nothing remembered yet',
                      body: 'Teach your AI facts about you, or approve its suggestions. They go into the next version you build.',
                    ),
                    tile: (m) => Card(
                      child: ListTile(
                        title: Text(m.content),
                        subtitle: Text(m.source == 'owner' ? 'You taught it' : 'From a chat'),
                        trailing: IconButton(
                          tooltip: 'Forget',
                          icon: const Icon(Icons.delete_outline),
                          onPressed: _busy.contains(m.id) ? null : () => _forget(m),
                        ),
                      ),
                    ),
                  ),
                ]),
        ),
      ),
    );
  }

  Widget _list(List<AiMemory> items, {required Widget empty, required Widget Function(AiMemory) tile}) => RefreshIndicator(
        onRefresh: _load,
        child: items.isEmpty
            ? ListView(children: [Padding(padding: const EdgeInsets.only(top: 64), child: empty)])
            : ListView(padding: const EdgeInsets.fromLTRB(16, 14, 16, 110), children: [for (final m in items) Padding(padding: const EdgeInsets.only(bottom: 10), child: tile(m))]),
      );
}

class _Message extends StatelessWidget {
  const _Message({required this.icon, required this.title, this.body, this.action});
  final IconData icon;
  final String title;
  final String? body;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 48, color: ALTColors.irisViolet),
          const SizedBox(height: 12),
          Text(title, style: ALTTypography.headlineSmall, textAlign: TextAlign.center),
          if (body != null) ...[const SizedBox(height: 6), Text(body!, style: ALTTypography.bodySmall, textAlign: TextAlign.center)],
          if (action != null) ...[const SizedBox(height: 8), action!],
        ]),
      );
}
