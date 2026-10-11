import 'package:alt_account/alt_account.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/alt/ai_api.dart';
import '../../../core/alt/alt_session.dart';
import '../../../core/theme/colors.dart';
import '../../../core/theme/gradients.dart';
import '../../../core/theme/typography.dart';
import '../../../shared/widgets/gradient_background.dart';

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
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
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
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final card = (isDark ? ALTColors.darkBgSurface01 : ALTColors.lightBgSurface01).withValues(alpha: 0.92);
    final muted = isDark ? ALTColors.darkTextSecondary : ALTColors.lightTextSecondary;
    return GradientBackground(
      baseColor: isDark ? ALTColors.darkBgPage : ALTColors.lightBgPage,
      layers: isDark ? ALTGradients.alterDark : ALTGradients.alterLight,
      animate: false,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: AppBar(title: const Text('Your AI', style: ALTTypography.headlineMedium), backgroundColor: Colors.transparent, elevation: 0),
        body: ValueListenableBuilder<AltAi?>(
          valueListenable: currentAi,
          builder: (context, ai, _) {
            if (ai == null) return const Center(child: CircularProgressIndicator(color: ALTColors.irisViolet));
            _fill(ai);
            final next = switch (ai.status) {
              'verified' => null,
              'minting' => ('Its identity token is being minted…', 'Deploy', '/training'),
              'ready' => ('Version built. Finish the checks and deploy it.', 'Deploy', '/training'),
              _ => ('Add data about you, chat with it, then build a version.', 'Add data', '/dataset'),
            };
            return ListView(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 32),
              children: [
                Center(
                  child: Stack(children: [
                    AiAvatar(ai: ai, radius: 52),
                    Positioned(
                      right: 0,
                      bottom: 0,
                      child: IconButton.filled(
                        tooltip: 'Change picture',
                        style: IconButton.styleFrom(backgroundColor: ALTColors.irisViolet),
                        onPressed: _busy ? null : () => _pickAvatar(ai),
                        icon: const Icon(Icons.photo_camera_outlined, color: Colors.white, size: 20),
                      ),
                    ),
                  ]),
                ),
                const SizedBox(height: 12),
                Center(child: Text(ai.name, style: ALTTypography.headlineMedium)),
                Center(child: Text('@${ai.handle}', style: ALTTypography.bodyMedium.copyWith(color: muted))),
                const SizedBox(height: 8),
                Center(
                  child: Chip(
                    avatar: Icon(ai.verified ? Icons.verified : Icons.edit_note, size: 18, color: ai.verified ? ALTColors.jadeSurge : ALTColors.solarEmber),
                    label: Text(ai.verified ? 'Verified · identity token #${ai.token?.tokenId} · v${ai.currentVersion ?? 1} live' : 'Not deployed yet (${ai.status})'),
                  ),
                ),
                if (next != null) ...[
                  const SizedBox(height: 8),
                  _Section(
                    color: card,
                    child: Row(children: [
                      const Icon(Icons.flag_outlined, color: ALTColors.irisViolet),
                      const SizedBox(width: 12),
                      Expanded(child: Text(next.$1, style: ALTTypography.bodySmall)),
                      TextButton(onPressed: () => context.go(next.$3), child: Text(next.$2)),
                    ]),
                  ),
                ],
                const SizedBox(height: 12),
                _Section(
                  color: card,
                  child: Column(children: [
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.psychology_alt_outlined, color: ALTColors.irisViolet),
                      title: const Text('Memories'),
                      subtitle: Text('${ai.count('memories')} remembered'
                          '${ai.count('proposedMemories') > 0 ? ' · ${ai.count('proposedMemories')} waiting for you' : ''}'),
                      trailing: ai.count('proposedMemories') > 0 ? Badge(label: Text('${ai.count('proposedMemories')}')) : const Icon(Icons.chevron_right),
                      onTap: () => context.push('/ai/memories'),
                    ),
                    const Divider(height: 1),
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.history, color: ALTColors.irisViolet),
                      title: const Text('Version history'),
                      subtitle: Text(ai.latestVersion == null ? 'No versions yet' : 'Latest v${ai.latestVersion!['version']}${ai.currentVersion != null ? ' · v${ai.currentVersion} live' : ''}'),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push('/ai/versions'),
                    ),
                  ]),
                ),
                const SizedBox(height: 16),
                Text('Profile', style: ALTTypography.labelLarge.copyWith(color: ALTColors.irisViolet)),
                const SizedBox(height: 4),
                Text(ai.verified ? 'Name, picture and bio update on ALTERA straight away.' : 'How your AI introduces itself.', style: ALTTypography.bodySmall.copyWith(color: muted)),
                const SizedBox(height: 8),
                _Section(
                  color: card,
                  child: Column(children: [
                    TextField(controller: _name, maxLength: 80, decoration: const InputDecoration(labelText: 'Name')),
                    TextField(controller: _bio, maxLength: 500, maxLines: 3, minLines: 1, decoration: const InputDecoration(labelText: 'Bio')),
                    Align(
                      alignment: Alignment.centerRight,
                      child: FilledButton(onPressed: _busy ? null : () => _saveProfile(ai), child: const Text('Save profile')),
                    ),
                  ]),
                ),
                const SizedBox(height: 16),
                Text('Personality', style: ALTTypography.labelLarge.copyWith(color: ALTColors.irisViolet)),
                const SizedBox(height: 4),
                Text(
                  'Saved to the draft; chat with it to try it. It reaches ALTERA when you build and publish a version. '
                  'Tone and creativity are in Chat → Personality.',
                  style: ALTTypography.bodySmall.copyWith(color: muted),
                ),
                const SizedBox(height: 8),
                _Section(
                  color: card,
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    TextField(controller: _about, maxLength: 1000, maxLines: 5, minLines: 2, decoration: const InputDecoration(labelText: 'About you (in your words)')),
                    const SizedBox(height: 8),
                    TagEditor(label: 'Traits', hint: 'e.g. curious', values: _traits, max: 12, maxLength: 40, onChanged: (v) => setState(() => _traits = v)),
                    TagEditor(label: 'Interests', hint: 'e.g. Flutter', values: _interests, max: 20, maxLength: 40, onChanged: (v) => setState(() => _interests = v)),
                    TagEditor(
                      label: 'Boundaries',
                      hint: 'e.g. Never discuss my family',
                      values: _boundaries,
                      max: 20,
                      maxLength: 200,
                      onChanged: (v) => setState(() => _boundaries = v),
                    ),
                    Align(
                      alignment: Alignment.centerRight,
                      child: FilledButton(onPressed: _busy ? null : () => _savePersona(ai), child: const Text('Save personality')),
                    ),
                  ]),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.color, required this.child});
  final Color color;
  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(20)),
        child: child,
      );
}

/// The AI's picture, or its initial when it has none.
class AiAvatar extends StatelessWidget {
  const AiAvatar({super.key, required this.ai, this.radius = 24});
  final AltAi ai;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final url = ai.avatarUrl;
    return CircleAvatar(
      radius: radius,
      backgroundColor: ai.verified ? ALTColors.jadeSurge : ALTColors.irisViolet,
      foregroundImage: url == null ? null : NetworkImage(url),
      child: Text(ai.name.isEmpty ? '?' : ai.name.characters.first.toUpperCase(),
          style: TextStyle(color: Colors.white, fontSize: radius * 0.8, fontWeight: FontWeight.w700)),
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
        Text('${widget.label} (${widget.values.length}/${widget.max})', style: ALTTypography.labelMedium),
        const SizedBox(height: 4),
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
