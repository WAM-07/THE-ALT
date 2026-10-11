import 'package:alt_account/alt_account.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/alt/ai_api.dart';
import '../../../core/alt/alt_session.dart';
import '../../../core/theme/ds.dart';
import '../../../shared/ui/ui.dart';

/// Your AI's profile: picture, name and bio (shown on ALTERA straight away) and its personality
/// (saved to the draft; it reaches ALTERA with the next published version).
class AiProfileScreen extends StatefulWidget {
  const AiProfileScreen({super.key});

  @override
  State<AiProfileScreen> createState() => _AiProfileScreenState();
}

class _AiProfileScreenState extends State<AiProfileScreen> {
  final _name = TextEditingController();
  final _bio = TextEditingController();
  final _about = TextEditingController();
  List<String> _traits = [];
  List<String> _interests = [];
  List<String> _boundaries = [];
  String? _loadedFor;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    refreshCurrentAi().catchError((_) => currentAi.value);
  }

  @override
  void dispose() {
    _name.dispose();
    _bio.dispose();
    _about.dispose();
    super.dispose();
  }

  /// Fills the form from the AI once (and again after each save).
  void _fill(AltAi ai) {
    final key = '${ai.id}:${ai.j['name']}:${ai.description}:${ai.persona.hashCode}';
    if (_loadedFor == key) return;
    _loadedFor = key;
    _name.text = ai.name;
    _bio.text = ai.description ?? '';
    final p = ai.persona;
    _about.text = p['about'] as String? ?? '';
    _traits = List<String>.from(p['traits'] as List? ?? const []);
    _interests = List<String>.from(p['interests'] as List? ?? const []);
    _boundaries = List<String>.from(p['boundaries'] as List? ?? const []);
  }

  void _toast(String text) {
    if (mounted) toast(context, text);
  }

  Future<void> _run(Future<AltAi> Function() action, String done) async {
    setState(() => _busy = true);
    try {
      currentAi.value = await action();
      _loadedFor = null;
      _toast(done);
    } on AltApiException catch (e) {
      _toast(e.message);
    } catch (_) {
      _toast('Could not reach ALT. Check your connection and try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickAvatar(AltAi ai) async {
    final picked = await FilePicker.platform.pickFiles(type: FileType.image, withData: true);
    final file = picked?.files.single;
    if (file == null || file.bytes == null) return;
    final mime = switch ((file.extension ?? '').toLowerCase()) {
      'png' => 'image/png',
      'jpg' || 'jpeg' => 'image/jpeg',
      'webp' => 'image/webp',
      _ => null,
    };
    if (mime == null) return _toast('Use a PNG, JPEG or WebP picture.');
    if (file.bytes!.length > 5 * 1024 * 1024) return _toast('The picture must be 5 MB or smaller.');
    await _run(() => aiApi.uploadAvatar(ai.id, bytes: file.bytes!, fileName: file.name, mimeType: mime), 'Picture updated');
  }

  Future<void> _saveProfile(AltAi ai) async {
    final name = _name.text.trim();
    if (name.isEmpty) return _toast('Your AI needs a name.');
    await _run(() => aiApi.update(ai.id, name: name, description: _bio.text.trim()),
        ai.verified ? 'Saved. ALTERA shows the new name and bio now.' : 'Saved');
  }

  Future<void> _savePersona(AltAi ai) => _run(
        () => aiApi.update(ai.id, persona: {
          ...ai.persona,
          'about': _about.text.trim(),
          'traits': _traits,
          'interests': _interests,
          'boundaries': _boundaries,
        }),
        ai.verified ? 'Saved to the draft. Build and publish a version to use it on ALTERA.' : 'Saved to the draft',
      );

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<AltAi?>(
      valueListenable: currentAi,
      builder: (context, ai, _) {
        if (ai == null) return AltPage(appBar: topBar(context), children: const [Loading()]);
        _fill(ai);
        final next = switch (ai.status) {
          'verified' => null,
          'minting' => ('Its identity token is being minted…', 'Identity', '/training'),
          'ready' => ('Version built. Finish the checks and deploy it.', 'Deploy', '/training'),
          _ => ('Teach it about you, chat with it, then build a version.', 'Studio', '/dataset'),
        };
        return AltPage(
          appBar: topBar(context),
          bottomInset: 48,
          children: [
            Center(
              child: Stack(clipBehavior: Clip.none, children: [
                AiAvatar(ai: ai, size: 108),
                Positioned(
                  right: -2,
                  bottom: -2,
                  child: Pressable(
                    onTap: _busy ? null : () => _pickAvatar(ai),
                    child: Container(
                      width: 38,
                      height: 38,
                      decoration: BoxDecoration(shape: BoxShape.circle, color: Ds.text, border: Border.all(color: Ds.bg, width: 3)),
                      child: const Icon(Icons.photo_camera_rounded, size: 18, color: Ds.bg),
                    ),
                  ),
                ),
              ]),
            ),
            const SizedBox(height: 16),
            Center(child: Text(ai.name, textAlign: TextAlign.center, style: Ds.title1)),
            const SizedBox(height: 4),
            Center(child: Text('@${ai.handle}', style: Ds.callout)),
            const SizedBox(height: 12),
            Center(
              child: ai.verified
                  ? Pill('Verified · token #${ai.token?.tokenId} · v${ai.currentVersion ?? 1} live', color: Ds.mint, icon: Icons.verified_rounded)
                  : Pill('Not deployed yet · ${ai.status}', color: Ds.amber, icon: Icons.edit_note_rounded),
            ),
            if (next != null) ...[
              const SizedBox(height: 18),
              Glass(
                onTap: () => context.go(next.$3),
                padding: const EdgeInsets.fromLTRB(16, 14, 12, 14),
                child: Row(children: [
                  const IconBadge(Icons.flag_outlined, size: 36),
                  const SizedBox(width: 12),
                  Expanded(child: Text(next.$1, style: Ds.caption.copyWith(color: Ds.text))),
                  Text('${next.$2} →', style: Ds.caption.copyWith(color: Ds.iris, fontWeight: FontWeight.w700)),
                ]),
              ),
            ],
            const SizedBox(height: 18),
            Group(children: [
              ListRow(
                icon: Icons.psychology_alt_outlined,
                color: Ds.mint,
                title: 'Memories',
                subtitle: '${ai.count('memories')} remembered${ai.count('proposedMemories') > 0 ? ' · ${ai.count('proposedMemories')} waiting for you' : ''}',
                trailing: ai.count('proposedMemories') > 0 ? Pill('${ai.count('proposedMemories')}', color: Ds.rose) : null,
                onTap: () => context.push('/ai/memories'),
              ),
              ListRow(
                icon: Icons.layers_outlined,
                color: Ds.amber,
                title: 'Version history',
                subtitle: ai.latestVersion == null ? 'No versions yet' : 'Latest v${ai.latestVersion!['version']}${ai.currentVersion != null ? ' · v${ai.currentVersion} live' : ''}',
                onTap: () => context.push('/ai/versions'),
              ),
            ]),
            SectionLabel('Profile'),
            Text(ai.verified ? 'Name, picture and bio update on ALTERA within seconds.' : 'How your AI introduces itself.', style: Ds.caption),
            const SizedBox(height: 12),
            Glass(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                TextField(controller: _name, maxLength: 80, style: Ds.body, decoration: const InputDecoration(labelText: 'Name')),
                const SizedBox(height: 6),
                TextField(controller: _bio, maxLength: 500, maxLines: 4, minLines: 2, style: Ds.body, decoration: const InputDecoration(labelText: 'Bio')),
                const SizedBox(height: 8),
                Align(alignment: Alignment.centerRight, child: Btn('Save profile', compact: true, loading: _busy, onTap: _busy ? null : () => _saveProfile(ai))),
              ]),
            ),
            SectionLabel('Personality'),
            Text('Saved to your draft, so you can try it in Chat. It reaches ALTERA when you build and publish a version. Tone and creativity live in Chat → Personality.', style: Ds.caption),
            const SizedBox(height: 12),
            Glass(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                TextField(controller: _about, maxLength: 1000, maxLines: 6, minLines: 3, style: Ds.body, decoration: const InputDecoration(labelText: 'About you, in your words')),
                const SizedBox(height: 10),
                TagEditor(label: 'Traits', hint: 'e.g. curious', values: _traits, max: 12, maxLength: 40, onChanged: (v) => setState(() => _traits = v)),
                TagEditor(label: 'Interests', hint: 'e.g. Flutter', values: _interests, max: 20, maxLength: 40, onChanged: (v) => setState(() => _interests = v)),
                TagEditor(label: 'Boundaries', hint: 'e.g. Never discuss my family', values: _boundaries, max: 20, maxLength: 200, onChanged: (v) => setState(() => _boundaries = v)),
                Align(alignment: Alignment.centerRight, child: Btn('Save personality', compact: true, loading: _busy, onTap: _busy ? null : () => _savePersona(ai))),
              ]),
            ),
          ],
        );
      },
    );
  }
}

/// A short list of words or phrases, edited as chips.
class TagEditor extends StatefulWidget {
  const TagEditor({super.key, required this.label, required this.values, required this.onChanged, this.hint, this.max = 12, this.maxLength = 40});
  final String label;
  final String? hint;
  final List<String> values;
  final int max;
  final int maxLength;
  final ValueChanged<List<String>> onChanged;

  @override
  State<TagEditor> createState() => _TagEditorState();
}

class _TagEditorState extends State<TagEditor> {
  final _input = TextEditingController();

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  void _add() {
    final v = _input.text.trim();
    if (v.isEmpty || widget.values.contains(v) || widget.values.length >= widget.max) return;
    widget.onChanged([...widget.values, v]);
    _input.clear();
  }

  @override
  Widget build(BuildContext context) {
    final full = widget.values.length >= widget.max;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('${widget.label.toUpperCase()} · ${widget.values.length}/${widget.max}', style: Ds.overline),
        const SizedBox(height: 10),
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final v in widget.values) InputChip(label: Text(v), onDeleted: () => widget.onChanged([...widget.values]..remove(v))),
        ]),
        TextField(
          controller: _input,
          enabled: !full,
          maxLength: widget.maxLength,
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => _add(),
          decoration: InputDecoration(
            hintText: full ? 'That’s the most you can add' : widget.hint,
            counterText: '',
            suffixIcon: IconButton(icon: const Icon(Icons.add), tooltip: 'Add', onPressed: full ? null : _add),
          ),
        ),
      ]),
    );
  }
}
