import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';

import '../../../core/alt/ai_api.dart';
import '../../../core/alt/alt_session.dart';
import '../../../core/theme/ds.dart';
import '../../../shared/ui/ui.dart';

/// Readiness and approval (Module 9 FE-2/FE-4): the owner writes questions with their own answers, sees
/// the trained version's answers next to theirs with a score, then approves it or trains again.
class ReadinessScreen extends StatefulWidget {
  const ReadinessScreen({super.key});

  @override
  State<ReadinessScreen> createState() => _ReadinessScreenState();
}

class _ReadinessScreenState extends State<ReadinessScreen> {
  List<EvalItem> _items = [];
  AiVersionInfo? _version;
  AiEvaluation? _evaluation;
  bool _loading = true;
  String? _busy;

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
      final items = await aiApi.evaluationSet(id);
      final versions = await aiApi.versions(id);
      final trained = versions.where((v) => v.trained).toList();
      final version = trained.isEmpty ? null : trained.first;
      final evaluation = version == null ? null : await aiApi.evaluation(id, version.id);
      if (!mounted) return;
      setState(() {
        _items = items;
        _version = version;
        _evaluation = evaluation;
        _loading = false;
      });
    } on AltApiException catch (e) {
      _toast(e.message);
    } catch (_) {
      _toast('Could not reach ALT. Pull down to try again.');
    }
    if (mounted && _loading) setState(() => _loading = false);
  }

  void _toast(String text) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> _run(String label, Future<void> Function() action) async {
    setState(() => _busy = label);
    try {
      await action();
    } on AltApiException catch (e) {
      _toast(e.message);
    } catch (_) {
      _toast('Could not reach ALT. Try again.');
    } finally {
      if (mounted) setState(() => _busy = null);
    }
    await _load();
  }

  Future<void> _add() async {
    final question = TextEditingController();
    final answer = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('A question for your AI'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: question, autofocus: true, maxLength: 500, decoration: const InputDecoration(labelText: 'Question', hintText: 'e.g. How would you explain recursion?')),
            TextField(controller: answer, maxLength: 4000, minLines: 3, maxLines: 6, decoration: const InputDecoration(labelText: 'Your own answer', hintText: 'Answer it the way you really would')),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Add')),
        ],
      ),
    );
    final q = question.text.trim();
    final a = answer.text.trim();
    question.dispose();
    answer.dispose();
    if (ok != true) return;
    if (q.length < 3 || a.isEmpty) return _toast('Write the question and your answer.');
    await _run('Saving…', () => aiApi.addEvalItem(_aiId!, q, a));
  }

  /// Asks the version the questions again and waits for the score.
  Future<void> _evaluate() => _run('Asking your questions…', () async {
        final id = _aiId!;
        final versionId = _version!.id;
        await aiApi.evaluate(id, versionId);
        for (var i = 0; i < 120 && mounted; i++) {
          await Future<void>.delayed(const Duration(seconds: 1));
          final e = await aiApi.evaluation(id, versionId);
          if (e != null && e.finished) return;
        }
      });

  Future<void> _verdict(bool approved) => _run(approved ? 'Approving…' : 'Saving…', () async {
        await aiApi.verdict(_aiId!, _version!.id, approved);
        refreshCurrentAi().ignore();
        _toast(approved ? 'Approved. Finish the checks to deploy it.' : 'Noted. Add more of your data and train again.');
      });

  @override
  Widget build(BuildContext context) {
    final version = _version;
    final evaluation = _evaluation;
    return AltPage(
      appBar: topBar(context, title: 'Readiness'),
      onRefresh: _load,
      children: [
        const PageHeader(
          eyebrow: 'Test and compare',
          title: 'Does it answer like you?',
          subtitle: 'Write questions with your own answers. Each trained version answers them, and ALT scores how close it comes to you.',
        ),
        if (_loading) const Loading(),
        if (_busy != null)
          Glass(
            tint: Ds.iris,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            child: Row(children: [
              const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
              const SizedBox(width: 12),
              Expanded(child: Text(_busy!, style: Ds.bodyStrong)),
            ]),
          ),
        if (!_loading) ...[
          SectionLabel('Your questions · ${_items.length}', action: 'Add', onAction: _busy == null ? _add : null),
          if (_items.isEmpty)
            Glass(child: Text('No questions yet. Add a few things people ask you, answered in your own words.', style: Ds.callout))
          else
            Group(children: [
              for (final item in _items)
                ListRow(
                  icon: Icons.help_outline_rounded,
                  title: item.question,
                  subtitle: item.answer,
                  trailing: IconButton(
                    tooltip: 'Remove',
                    icon: Icon(Icons.close_rounded, color: Ds.textTertiary),
                    onPressed: _busy == null ? () => _run('Removing…', () => aiApi.deleteEvalItem(_aiId!, item.id)) : null,
                  ),
                ),
            ]),
          SectionLabel(version == null ? 'No trained version yet' : 'Version ${version.version}${version.simulated ? ' · simulated training' : ''}'),
          if (version == null)
            Glass(child: Text('Train your AI first (Identity → the checks). Its answers appear here.', style: Ds.callout))
          else ...[
            _score(evaluation),
            for (final item in evaluation?.items ?? const <Map<String, dynamic>>[]) _compare(item),
            const SizedBox(height: 14),
            Btn('Ask my questions again', icon: Icons.replay_rounded, kind: BtnKind.secondary, expand: true, onTap: _busy == null && _items.isNotEmpty ? _evaluate : null),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: Btn('Train again', icon: Icons.school_outlined, kind: BtnKind.ghost, onTap: _busy == null ? () => _verdict(false) : null)),
              const SizedBox(width: 10),
              Expanded(child: Btn(version.verdict == 'approved' ? 'Approved' : 'It’s me: approve', icon: Icons.check_rounded, onTap: _busy == null && version.verdict != 'approved' ? () => _verdict(true) : null)),
            ]),
          ],
        ],
      ],
    );
  }

  Widget _score(AiEvaluation? e) {
    final r = e?.readiness;
    final text = e == null ? 'Not evaluated yet' : (r == null ? 'Evaluation ${e.status}' : '${r.round()}% ready');
    final color = r == null ? Ds.textSecondary : (!e!.safe ? Ds.rose : (r >= 50 ? Ds.mint : Ds.amber));
    return Glass(
      tint: color,
      child: Row(children: [
        IconBadge(Icons.speed_rounded, color: color),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(text, style: Ds.headline),
            const SizedBox(height: 2),
            Text(e != null && !e.safe ? 'Some answers broke ALT’s safety rules.' : 'How close its answers come to yours, in meaning and in style.', style: Ds.caption),
          ]),
        ),
      ]),
    );
  }

  Widget _compare(Map<String, dynamic> item) {
    final score = ((item['score'] as num?) ?? 0) * 100;
    final mine = _items.where((i) => i.id == item['itemId']).map((i) => i.answer).firstOrNull;
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Glass(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(item['question'] as String? ?? '', style: Ds.bodyStrong)),
            Pill('${score.round()}%', color: item['flagged'] == true ? Ds.rose : (score >= 50 ? Ds.mint : Ds.amber)),
          ]),
          if (mine != null) ...[
            const SizedBox(height: 10),
            Text('YOU', style: Ds.overline.copyWith(fontSize: 10)),
            const SizedBox(height: 3),
            Text(mine, style: Ds.callout),
          ],
          const SizedBox(height: 10),
          Text('YOUR AI', style: Ds.overline.copyWith(fontSize: 10)),
          const SizedBox(height: 3),
          Text(item['reply'] as String? ?? '', style: Ds.callout.copyWith(color: Ds.text)),
        ]),
      ),
    );
  }
}
