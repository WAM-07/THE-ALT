import 'package:alt_account/alt_account.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../../../core/alt/ai_api.dart';
import '../../../core/alt/alt_session.dart';
import '../../../core/theme/colors.dart';
import '../../../core/theme/gradients.dart';
import '../../../core/theme/typography.dart';
import '../../../shared/widgets/alt_card.dart';
import '../../../shared/widgets/gradient_background.dart';
import 'add_text_screen.dart';

/// What your AI learns from (Module 8): every item needs your consent, can be read back,
/// excluded from training, or deleted for good. Files are encrypted on the server.
class DatasetScreen extends StatefulWidget {
  const DatasetScreen({super.key});

  @override
  State<DatasetScreen> createState() => _DatasetScreenState();
}

class _DatasetScreenState extends State<DatasetScreen> {
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
      if (mounted) setState(() {
        _items = items;
        _error = null;
      });
    } on AltApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  void _toast(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<void> _grantTrainingConsent() async {
    try {
      await aiApi.setConsent(_ai!.id, 'persona_training', true);
      await _reload();
    } on AltApiException catch (e) {
      _toast(e.message);
    }
  }

  Future<void> _addText() async {
    final added = await Navigator.of(context, rootNavigator: true).push<bool>(MaterialPageRoute(builder: (_) => AddTextScreen(aiId: _ai!.id)));
    if (added == true) _reload();
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
      _toast('Added ${file.name}');
      _reload();
    } on AltApiException catch (e) {
      _toast(e.message);
    }
  }

  void _showAddSheet() {
    showModalBottomSheet(
      context: context,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Add to your AI', style: ALTTypography.headlineMedium),
            const SizedBox(height: 4),
            const Text('Only you can see these. Your AI uses what you include.', style: ALTTypography.bodySmall),
            const SizedBox(height: 12),
            ListTile(
              leading: const Icon(Icons.edit_note),
              title: const Text('Write something'),
              subtitle: const Text('A thought, a story, how you talk, what you like'),
              onTap: () {
                Navigator.pop(ctx);
                _addText();
              },
            ),
            ListTile(
              leading: const Icon(Icons.description_outlined),
              title: const Text('Upload a text file'),
              subtitle: const Text('.txt, .md, .csv. Used right away.'),
              onTap: () {
                Navigator.pop(ctx);
                _upload(FileType.custom, extensions: ['txt', 'md', 'csv', 'json']);
              },
            ),
            ListTile(
              leading: const Icon(Icons.picture_as_pdf_outlined),
              title: const Text('Upload a document, image or voice note'),
              subtitle: const Text('Stored securely now; used once full training arrives'),
              onTap: () {
                Navigator.pop(ctx);
                _upload(FileType.any);
              },
            ),
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
        initialChildSize: 0.6,
        builder: (ctx, scroll) => ListView(controller: scroll, padding: const EdgeInsets.all(20), children: [
          Text(item.title, style: ALTTypography.headlineMedium),
          const SizedBox(height: 4),
          Text('${item.kind} · ${item.category.replaceAll('_', ' ')} · ${(item.sizeBytes / 1024).toStringAsFixed(1)} KB', style: ALTTypography.bodySmall),
          const SizedBox(height: 12),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Use this to build my AI'),
            value: item.included,
            onChanged: (v) async {
              Navigator.pop(ctx);
              await aiApi.setIncluded(_ai!.id, item.id, v);
              _reload();
            },
          ),
          if (text != null) ...[const Divider(), SelectableText(text)],
          const SizedBox(height: 16),
          OutlinedButton.icon(
            icon: const Icon(Icons.delete_outline, color: ALTColors.vermillion),
            label: const Text('Delete for good', style: TextStyle(color: ALTColors.vermillion)),
            onPressed: () async {
              Navigator.pop(ctx);
              await aiApi.deleteDataset(_ai!.id, item.id);
              _toast('Deleted');
              _reload();
            },
          ),
        ]),
      ),
    );
  }

  IconData _icon(String kind) => switch (kind) {
        'document' => Icons.description,
        'image' => Icons.image,
        'voice' => Icons.mic,
        _ => Icons.text_snippet,
      };

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final consented = _ai?.consent('persona_training') ?? false;
    return GradientBackground(
      baseColor: isDark ? ALTColors.darkBgPage : ALTColors.lightBgPage,
      layers: isDark ? ALTGradients.alterDark : ALTGradients.alterLight,
      animate: false,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: AppBar(title: const Text('What your AI learns from', style: ALTTypography.headlineMedium), backgroundColor: Colors.transparent, elevation: 0),
        floatingActionButton: consented
            ? Padding(
                padding: const EdgeInsets.only(bottom: 96),
                child: FloatingActionButton(onPressed: _showAddSheet, backgroundColor: ALTColors.irisViolet, child: const Icon(Icons.add, color: Colors.white)),
              )
            : null,
        body: RefreshIndicator(
          onRefresh: _reload,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 120),
            children: [
              if (!consented)
                ALTCard(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Text('Your consent is needed', style: ALTTypography.labelLarge),
                    const SizedBox(height: 6),
                    Text(consentScopes['persona_training']!, style: ALTTypography.bodySmall),
                    const SizedBox(height: 8),
                    FilledButton(onPressed: _grantTrainingConsent, child: const Text('I agree')),
                  ]),
                ),
              if (_error != null) Padding(padding: const EdgeInsets.all(16), child: Text(_error!)),
              if (_items == null && _error == null) const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())),
              if (_items != null && _items!.isEmpty && consented)
                const Padding(padding: EdgeInsets.all(32), child: Center(child: Text('Nothing yet. Tap + to add something about you.'))),
              for (final item in _items ?? <DatasetEntry>[])
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: ALTCard(
                    onTap: () => _openItem(item),
                    child: Row(children: [
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(color: ALTColors.irisViolet.withValues(alpha: 0.2), borderRadius: BorderRadius.circular(12)),
                        child: Icon(_icon(item.kind), color: ALTColors.violet100),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(item.title, style: ALTTypography.labelLarge),
                          const SizedBox(height: 4),
                          Text(
                            item.included ? (item.usableAsText ? 'Included' : 'Stored for later training') : 'Excluded from training',
                            style: ALTTypography.bodySmall.copyWith(color: item.included ? ALTColors.jadeSurge : ALTColors.solarEmber),
                          ),
                        ]),
                      ),
                      const Icon(Icons.chevron_right),
                    ]),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
