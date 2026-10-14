import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import '../client.dart';
import '../errors.dart';
import '../media.dart';
import '../models.dart';

/// A photo the app picked from the phone (the package itself has no camera or gallery access).
typedef AltPickedPhoto = ({List<int> bytes, String fileName, String mimeType});

/// The person's profile picture, the same picker in every ALT app: ALT's ready-made pictures (with
/// their credits) or a photo, either everywhere or only in this app. Saved in ALT Core
/// (`core.users.avatar_url`, or `core.platform_avatars` for one app). [pickPhoto] lets the app offer
/// "Upload a photo" with its own image picker.
Future<void> showAltPicturePicker(BuildContext context, {required AltAccountClient client, Future<AltPickedPhoto?> Function()? pickPhoto}) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _PicturePicker(client: client, pickPhoto: pickPhoto),
    );

class _PicturePicker extends StatefulWidget {
  const _PicturePicker({required this.client, this.pickPhoto});
  final AltAccountClient client;
  final Future<AltPickedPhoto?> Function()? pickPhoto;

  @override
  State<_PicturePicker> createState() => _PicturePickerState();
}

class _PicturePickerState extends State<_PicturePicker> {
  List<Map<String, dynamic>>? _sets;
  bool _onlyHere = false;
  bool _busy = false;
  String? _error;

  AltAccountClient get _client => widget.client;
  AltPlatform get _app => _client.platform;

  @override
  void initState() {
    super.initState();
    _loadSets();
    // Start on "only here" when this app already has its own picture.
    _onlyHere = _client.currentUser.value?.platformAvatars.containsKey(_app.name) ?? false;
  }

  Future<void> _loadSets() async {
    try {
      final res = await http.get(Uri.parse('${_client.coreUrl}/avatars/presets?kind=human'));
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      if (mounted) setState(() => _sets = (body['sets'] as List).map((e) => Map<String, dynamic>.from(e as Map)).toList());
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load the ready-made pictures.');
    }
  }

  String _show(String url) => altMediaUrl(url, _client.apiUrl);

  Future<void> _run(Future<void> Function() action, String done) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
      await _client.reloadMe();
      if (!mounted) return;
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(done)));
      Navigator.pop(context);
    } on AltApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not reach ALT. Try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _check(http.Response res) async {
    if (res.statusCode >= 400) throw AltApiException.fromBody(res.statusCode, res.body.isEmpty ? null : jsonDecode(res.body));
  }

  String get _where => _onlyHere ? 'Picture changed in ${_app.label}' : 'Picture changed in every ALT app';

  Future<void> _usePreset(String url) => _run(() async {
        final res = _onlyHere
            ? await _client.authorizedSend('PUT', Uri.parse('${_client.coreUrl}/me/avatar/${_app.name}'), body: {'avatarUrl': url})
            : await _client.authorizedSend('PATCH', Uri.parse('${_client.coreUrl}/me'), body: {'avatarUrl': url});
        await _check(res);
      }, _where);

  Future<void> _upload() async {
    final photo = await widget.pickPhoto?.call();
    if (photo == null || !mounted) return;
    await _run(() async {
      final token = await _client.accessToken();
      final uri = Uri.parse('${_client.coreUrl}/me/avatar${_onlyHere ? '?platform=${_app.name}' : ''}');
      final req = http.MultipartRequest('POST', uri)
        ..headers['authorization'] = 'Bearer $token'
        ..files.add(http.MultipartFile.fromBytes('file', photo.bytes, filename: photo.fileName, contentType: MediaType.parse(photo.mimeType)));
      await _check(await http.Response.fromStream(await req.send()));
    }, _where);
  }

  Future<void> _useMain() => _run(() async {
        await _check(await _client.authorizedSend('PUT', Uri.parse('${_client.coreUrl}/me/avatar/${_app.name}'), body: {'avatarUrl': null}));
      }, '${_app.label} uses your main picture again');

  @override
  Widget build(BuildContext context) {
    final user = _client.currentUser.value;
    final scheme = Theme.of(context).colorScheme;
    final muted = scheme.onSurface.withValues(alpha: 0.6);
    final current = _onlyHere ? user?.avatarFor(_app) : user?.avatarUrl;
    final hasOwn = user?.platformAvatars.containsKey(_app.name) ?? false;
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.88),
        child: ListView(shrinkWrap: true, padding: const EdgeInsets.fromLTRB(20, 0, 20, 20), children: [
          Row(children: [
            CircleAvatar(
              radius: 30,
              backgroundColor: scheme.surfaceContainerHighest,
              backgroundImage: current != null ? NetworkImage(_show(current)) : null,
              child: current == null ? Text((user?.displayName ?? '?').characters.first.toUpperCase()) : null,
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Profile picture', style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 2),
                Text(_onlyHere ? 'Only in ${_app.label}. Other ALT apps keep your main picture.' : 'Your main picture, in every ALT app.',
                    style: TextStyle(color: muted, fontSize: 13)),
              ]),
            ),
          ]),
          const SizedBox(height: 16),
          SegmentedButton<bool>(
            segments: [
              const ButtonSegment(value: false, label: Text('Everywhere'), icon: Icon(Icons.public_rounded)),
              ButtonSegment(value: true, label: Text('Only in ${_app.label}'), icon: const Icon(Icons.phone_android_rounded)),
            ],
            selected: {_onlyHere},
            onSelectionChanged: _busy ? null : (v) => setState(() => _onlyHere = v.first),
          ),
          const SizedBox(height: 12),
          if (_busy) const LinearProgressIndicator(),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: TextStyle(color: scheme.error))),
          if (widget.pickPhoto != null || (_onlyHere && hasOwn))
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Wrap(spacing: 8, runSpacing: 8, children: [
                if (widget.pickPhoto != null)
                  OutlinedButton.icon(onPressed: _busy ? null : _upload, icon: const Icon(Icons.photo_library_outlined), label: const Text('Upload a photo')),
                if (_onlyHere && hasOwn)
                  TextButton.icon(onPressed: _busy ? null : _useMain, icon: const Icon(Icons.undo_rounded), label: const Text('Use my main picture here')),
              ]),
            ),
          if (_sets == null && _error == null) const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())),
          for (final set in _sets ?? const <Map<String, dynamic>>[]) ...[
            const SizedBox(height: 18),
            Text('${set['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
            // Credits stay visible wherever the sets are shown.
            Text('${set['credit']}', style: TextStyle(color: muted, fontSize: 12)),
            const SizedBox(height: 8),
            Wrap(spacing: 10, runSpacing: 10, children: [
              for (final url in (set['pictures'] as List).cast<String>())
                InkWell(
                  customBorder: const CircleBorder(),
                  onTap: _busy ? null : () => _usePreset(url),
                  child: Container(
                    padding: const EdgeInsets.all(2),
                    decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: url == current ? scheme.primary : Colors.transparent, width: 2.5)),
                    child: CircleAvatar(radius: 26, backgroundColor: scheme.surfaceContainerHighest, backgroundImage: NetworkImage(_show(url))),
                  ),
                ),
            ]),
          ],
        ]),
      ),
    );
  }
}
