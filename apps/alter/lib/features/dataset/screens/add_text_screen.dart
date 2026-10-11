import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';

import '../../../core/alt/ai_api.dart';
import '../../../core/theme/colors.dart';
import '../../../core/theme/gradients.dart';
import '../../../core/theme/typography.dart';
import '../../../shared/widgets/alt_button.dart';
import '../../../shared/widgets/gradient_background.dart';

/// Write something for your AI to learn from. Pops `true` when saved.
class AddTextScreen extends StatefulWidget {
  const AddTextScreen({super.key, required this.aiId});
  final String aiId;

  @override
  State<AddTextScreen> createState() => _AddTextScreenState();
}

class _AddTextScreenState extends State<AddTextScreen> {
  final _title = TextEditingController();
  final _body = TextEditingController();
  String _category = 'knowledge';
  bool _saving = false;

  static const _categories = {
    'personality': 'Who I am',
    'knowledge': 'What I know',
    'communication_style': 'How I talk',
    'preferences': 'What I like',
  };

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_title.text.trim().isEmpty || _body.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Add a title and some text.')));
      return;
    }
    setState(() => _saving = true);
    try {
      await aiApi.addText(widget.aiId, _title.text.trim(), _body.text.trim(), _category);
      if (mounted) Navigator.of(context).pop(true);
    } on AltApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return GradientBackground(
      baseColor: isDark ? ALTColors.darkBgPage : ALTColors.lightBgPage,
      layers: isDark ? ALTGradients.alterDark : ALTGradients.alterLight,
      animate: false,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: AppBar(title: const Text('Write something', style: ALTTypography.headlineMedium), backgroundColor: Colors.transparent, elevation: 0),
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              TextField(controller: _title, decoration: const InputDecoration(labelText: 'Title', hintText: 'e.g. My weekends')),
              const SizedBox(height: 12),
              Wrap(spacing: 8, children: [
                for (final e in _categories.entries)
                  ChoiceChip(label: Text(e.value), selected: _category == e.key, onSelected: (_) => setState(() => _category = e.key)),
              ]),
              const SizedBox(height: 12),
              Expanded(
                child: TextField(
                  controller: _body,
                  maxLines: null,
                  expands: true,
                  textAlignVertical: TextAlignVertical.top,
                  decoration: const InputDecoration(hintText: 'Write in your own words. Your AI uses this to sound and think like you.', border: OutlineInputBorder()),
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(width: double.infinity, child: ALTButton(label: 'Save', isLoading: _saving, onPressed: _saving ? null : _save)),
            ]),
          ),
        ),
      ),
    );
  }
}
