import 'package:alt_account/alt_account.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/alt/ai_api.dart';
import '../../../core/alt/alt_session.dart';
import '../../../core/alt/follows_current_ai.dart';
import '../../../core/theme/ds.dart';
import '../../../shared/ui/ui.dart';
import 'add_text_screen.dart';

/// Studio: everything your AI learns from (Module 8). Every item needs your consent, can be read
/// back, excluded from training, or deleted for good. Files are encrypted on the server.
class DatasetScreen extends StatefulWidget {
  const DatasetScreen({super.key});

  @override
  State<DatasetScreen> createState() => _DatasetScreenState();
}

class _DatasetScreenState extends State<DatasetScreen> with FollowsCurrentAi {
  @override
  void onAiSwitched() {
    setState(() => _items = null);
    _reload();
  }

  List<DatasetEntry>? _items;
  String? _error;

  AltAi? get _ai => currentAi.value;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    final ai = _ai;
    if (ai == null) return;
    try {
      final items = await aiApi.datasets(ai.id);
      await refreshCurrentAi();
      if (!mounted) return;
      setState(() {
        _items = items;
        _error = null;
      });
    } on AltApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not reach ALT. Pull down to try again.');
    }
  }

  Future<void> _grantTrainingConsent() async {
    try {
      await aiApi.setConsent(_ai!.id, 'persona_training', true);
      await _reload();
    } on AltApiException catch (e) {
      if (mounted) toast(context, e.message);
    }
  }

  Future<void> _addText() async {
    final added = await Navigator.of(context, rootNavigator: true).push<bool>(MaterialPageRoute(builder: (_) => AddTextScreen(aiId: _ai!.id)));
    if (added == true) {
      _reload();
      if (mounted) toast(context, 'Added. It goes into your next version.');
    }
  }

  Future<void> _upload(FileType type, {List<String>? extensions}) async {
    final picked = await FilePicker.platform.pickFiles(type: type, allowedExtensions: extensions, withData: true);
    final file = picked?.files.single;
    if (file == null || file.bytes == null) return;
    final ext = (file.extension ?? '').toLowerCase();
    final mime = switch (ext) {
      'txt' => 'text/plain',
      'md' => 'text/markdown',
      'csv' => 'text/csv',
      'json' => 'application/json',
      'pdf' => 'application/pdf',
      'doc' => 'application/msword',
      'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'png' => 'image/png',
      'jpg' || 'jpeg' => 'image/jpeg',
      'webp' => 'image/webp',
      'mp3' => 'audio/mpeg',
      'm4a' => 'audio/mp4',
      'wav' => 'audio/wav',
      _ => 'application/octet-stream',
    };
    try {
      await aiApi.uploadFile(_ai!.id, bytes: file.bytes!, fileName: file.name, mimeType: mime);
      if (mounted) toast(context, 'Added ${file.name}');
      _reload();
    } on AltApiException catch (e) {
      if (mounted) toast(context, e.message);
    }
  }

  void _showAddSheet() {
    showModalBottomSheet(
      context: context,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Teach your AI', style: Ds.title2),
            const SizedBox(height: 6),
            Text('Only you can see these. Your AI uses what you include.', style: Ds.callout),
            const SizedBox(height: 18),
            Group(children: [
              ListRow(
                icon: Icons.edit_note_rounded,
                title: 'Write something',
                subtitle: 'Who you are, how you talk, what you know',
                onTap: () {
                  Navigator.pop(ctx);
                  _addText();
                },
              ),
              ListRow(
                icon: Icons.description_outlined,
                color: Ds.sky,
                title: 'Upload a text file',
                subtitle: '.txt, .md, .csv or .json · used right away',
                onTap: () {
                  Navigator.pop(ctx);
                  _upload(FileType.custom, extensions: ['txt', 'md', 'csv', 'json']);
                },
              ),
              ListRow(
                icon: Icons.perm_media_outlined,
                color: Ds.amber,
                title: 'Document, image or voice note',
                subtitle: 'Stored securely now; used when full training arrives',
                onTap: () {
                  Navigator.pop(ctx);
                  _upload(FileType.any);
                },
              ),
            ]),
          ]),
        ),
      ),
    );
  }

  Future<void> _openItem(DatasetEntry item) async {
    String? text;
    if (item.usableAsText) {
      try {
        text = await aiApi.datasetText(_ai!.id, item.id);
      } catch (_) {}
    }
    if (!mounted) return;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.62,
        maxChildSize: 0.92,
        builder: (ctx, scroll) => ListView(controller: scroll, padding: const EdgeInsets.fromLTRB(22, 0, 22, 28), children: [
          Row(children: [
            IconBadge(_icon(item.kind), color: _color(item.kind), size: 44),
            const SizedBox(width: 14),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(item.title, style: Ds.title2.copyWith(fontSize: 18)),
                const SizedBox(height: 2),
                Text('${_categoryLabel(item.category)} · ${(item.sizeBytes / 1024).toStringAsFixed(1)} KB', style: Ds.caption),
              ]),
            ),
          ]),
          const SizedBox(height: 18),
          Glass(
            padding: const EdgeInsets.fromLTRB(16, 6, 8, 6),
            child: Row(children: [
              Expanded(child: Text('Use this to build my AI', style: Ds.bodyStrong)),
              Switch(
                value: item.included,
                onChanged: (v) async {
                  Navigator.pop(ctx);
                  await aiApi.setIncluded(_ai!.id, item.id, v);
                  _reload();
                },
              ),
            ]),
          ),
          if (text != null) ...[
            const SizedBox(height: 18),
            Text('CONTENT', style: Ds.overline),
            const SizedBox(height: 10),
            SelectableText(text, style: Ds.body.copyWith(color: Ds.textSecondary)),
          ],
          const SizedBox(height: 24),
          Btn('Delete for good', kind: BtnKind.danger, icon: Icons.delete_outline_rounded, expand: true, onTap: () async {
            Navigator.pop(ctx);
            await aiApi.deleteDataset(_ai!.id, item.id);
            if (mounted) toast(context, 'Deleted');
            _reload();
          }),
        ]),
      ),
    );
  }

  static IconData _icon(String kind) => switch (kind) {
        'document' => Icons.description_outlined,
        'image' => Icons.image_outlined,
        'voice' => Icons.graphic_eq_rounded,
        _ => Icons.notes_rounded,
      };
  static Color _color(String kind) => switch (kind) {
        'document' => Ds.sky,
        'image' => Ds.amber,
        'voice' => Ds.mint,
        _ => Ds.iris,
      };
  static String _plural(int n, String word) => '$n $word${n == 1 ? '' : 's'}';

  static String _categoryLabel(String c) => switch (c) {
        'personality' => 'Who I am',
        'knowledge' => 'What I know',
        'communication_style' => 'How I talk',
        'preferences' => 'What I like',
        _ => c.replaceAll('_', ' '),
      };

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<AltAi?>(
      valueListenable: currentAi,
      builder: (context, ai, _) {
        final consented = ai?.consent('persona_training') ?? false;
        final items = _items;
        return AltPage(
          onRefresh: _reload,
          children: [
            PageHeader(
              eyebrow: 'Studio',
              title: 'Teach your AI',
              subtitle: 'What it knows, how it speaks, what it remembers.',
              trailing: [if (consented) RoundIconButton(icon: Icons.add_rounded, tooltip: 'Teach it something', size: 44, onTap: _showAddSheet)],
            ),
            if (!consented && ai != null)
              Glass(
                tint: Ds.iris,
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [const IconBadge(Icons.verified_user_outlined), const SizedBox(width: 12), Expanded(child: Text('Your consent comes first', style: Ds.headline))]),
                  const SizedBox(height: 10),
                  Text(consentScopes['persona_training']!, style: Ds.callout),
                  const SizedBox(height: 16),
                  Btn('I agree', onTap: _grantTrainingConsent, compact: true),
                ]),
              ),
            if (ai != null)
              Row(children: [
                Expanded(child: _Tile(icon: Icons.face_retouching_natural_rounded, color: Ds.iris, title: 'Personality', value: _plural((ai.persona['traits'] as List? ?? const []).length, 'trait'), onTap: () => context.push('/ai'))),
                const SizedBox(width: 12),
                Expanded(
                  child: _Tile(
                    icon: Icons.psychology_alt_outlined,
                    color: Ds.mint,
                    title: 'Memories',
                    value: ai.count('proposedMemories') > 0 ? '${ai.count('proposedMemories')} to review' : '${ai.count('memories')} kept',
                    highlight: ai.count('proposedMemories') > 0,
                    onTap: () => context.push('/ai/memories'),
                  ),
                ),
              ]),
            SectionLabel('Knowledge', action: consented ? 'Add' : null, onAction: _showAddSheet),
            if (_error != null)
              EmptyState(icon: Icons.cloud_off_rounded, title: 'Couldn’t load your knowledge', body: _error, action: Btn('Try again', onTap: _reload, kind: BtnKind.secondary, compact: true))
            else if (items == null)
              const Loading()
            else if (items.isEmpty)
              Glass(
                child: EmptyState(
                  icon: Icons.auto_awesome_outlined,
                  title: 'Nothing here yet',
                  body: 'Write a few lines about yourself: how you talk, what you know, what you love.',
                  action: consented ? Btn('Teach it something', icon: Icons.add_rounded, onTap: _showAddSheet, compact: true) : null,
                ),
              )
            else
              Group(children: [
                for (final item in items)
                  ListRow(
                    icon: _icon(item.kind),
                    color: _color(item.kind),
                    title: item.title,
                    subtitle: _categoryLabel(item.category),
                    trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                      Pill(
                        item.included ? (item.usableAsText ? 'Included' : 'Stored') : 'Excluded',
                        color: item.included ? (item.usableAsText ? Ds.mint : Ds.sky) : Ds.amber,
                      ),
                      const SizedBox(width: 4),
                      Icon(Icons.chevron_right_rounded, color: Ds.textTertiary),
                    ]),
                    onTap: () => _openItem(item),
                  ),
              ]),
            if (consented && items != null) ...[
              const SectionLabel('Ideas'),
              Glass(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    IconBadge(Icons.lightbulb_outline_rounded, color: Ds.amber, size: 34),
                    const SizedBox(width: 12),
                    Expanded(child: Text('The more it knows, the more it sounds like you', style: Ds.bodyStrong)),
                  ]),
                  const SizedBox(height: 12),
                  for (final idea in const [
                    'A typical day, and what you care about most',
                    'Phrases and jokes you actually use',
                    'Opinions on the topics you talk about',
                    'What you never want it to say',
                  ])
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('·  ', style: Ds.callout),
                        Expanded(child: Text(idea, style: Ds.callout)),
                      ]),
                    ),
                ]),
              ),
            ],
          ],
        );
      },
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile({required this.icon, required this.color, required this.title, required this.value, required this.onTap, this.highlight = false});
  final IconData icon;
  final Color color;
  final String title;
  final String value;
  final VoidCallback onTap;
  final bool highlight;

  @override
  Widget build(BuildContext context) => Glass(
        onTap: onTap,
        padding: const EdgeInsets.all(14),
        border: highlight ? color.withValues(alpha: 0.5) : null,
        child: Row(children: [
          IconBadge(icon, color: color, size: 36),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: Ds.bodyStrong),
              Text(value, maxLines: 1, overflow: TextOverflow.ellipsis, style: Ds.caption.copyWith(color: highlight ? color : Ds.textSecondary)),
            ]),
          ),
        ]),
      );
}
