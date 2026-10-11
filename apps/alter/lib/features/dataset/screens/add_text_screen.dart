import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';

import '../../../core/alt/ai_api.dart';
import '../../../core/theme/ds.dart';
import '../../../shared/ui/ui.dart';

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
    return Backdrop(
      animate: false,
      intensity: 0.35,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: topBar(context, title: 'Write something'),
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(Ds.gutter, 8, Ds.gutter, 16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              TextField(controller: _title, style: Ds.title2.copyWith(fontSize: 20), decoration: const InputDecoration(hintText: 'Title, e.g. My weekends')),
              const SizedBox(height: 14),
              Text('THIS IS ABOUT', style: Ds.overline),
              const SizedBox(height: 10),
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final e in _categories.entries)
                  ChoiceChip(label: Text(e.value), selected: _category == e.key, onSelected: (_) => setState(() => _category = e.key)),
              ]),
              const SizedBox(height: 16),
              Expanded(
                child: TextField(
                  controller: _body,
                  maxLines: null,
                  expands: true,
                  style: Ds.body,
                  textAlignVertical: TextAlignVertical.top,
                  decoration: const InputDecoration(hintText: 'Write in your own words. Your AI uses this to sound and think like you.'),
                ),
              ),
              const SizedBox(height: 16),
              Btn('Save', loading: _saving, expand: true, onTap: _saving ? null : _save),
            ]),
          ),
        ),
      ),
    );
  }
}
