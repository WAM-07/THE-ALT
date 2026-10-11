import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/alt/ai_api.dart';
import '../../../core/alt/alt_session.dart';
import '../../../core/theme/colors.dart';
import '../../../core/theme/gradients.dart';
import '../../../core/theme/typography.dart';
import '../../../shared/ui/ui.dart';
import '../../../shared/widgets/gradient_background.dart';

/// Every version of your AI: when it was built, what went into it, its public manifest on IPFS
/// and whether it is recorded on-chain (Modules 6 and 9).
class VersionsScreen extends StatefulWidget {
  const VersionsScreen({super.key});

  @override
  State<VersionsScreen> createState() => _VersionsScreenState();
}

class _VersionsScreenState extends State<VersionsScreen> {
  List<AiVersionInfo>? _versions;
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final ai = currentAi.value;
    if (ai == null) return;
    try {
      final v = await aiApi.versions(ai.id);
      if (!mounted) return;
      setState(() {
        _versions = v;
        _error = null;
      });
    } on AltApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not reach ALT. Pull down to try again.');
    }
  }

  Future<void> _publish(AltAi ai, AiVersionInfo v) async {
    setState(() => _busy = true);
    try {
      await aiApi.publish(ai.id, v.id);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Publishing v${v.version}. You’ll get a notification when it is live.')));
      }
      await Future<void>.delayed(const Duration(seconds: 3));
      await _load();
      await refreshCurrentAi();
    } on AltApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  static String _date(DateTime? d) {
    if (d == null) return '';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    final l = d.toLocal();
    return '${l.day} ${months[l.month - 1]} ${l.year}, ${l.hour.toString().padLeft(2, '0')}:${l.minute.toString().padLeft(2, '0')}';
  }

  static String _short(String s) => s.length <= 20 ? s : '${s.substring(0, 10)}…${s.substring(s.length - 8)}';

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final ai = currentAi.value;
    final versions = _versions;
    // Only the newest version can be published, and only once the AI has its identity token.
    final publishable = ai != null && ai.verified && versions != null && versions.isNotEmpty && !versions.first.published ? versions.first : null;
    return GradientBackground(
      baseColor: isDark ? ALTColors.darkBgPage : ALTColors.lightBgPage,
      layers: isDark ? ALTGradients.alterDark : ALTGradients.alterLight,
      animate: false,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: topBar(context, title: 'Version history'),
        body: RefreshIndicator(
          onRefresh: _load,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
            children: [
              Text(
                'Each version freezes your AI’s personality, the data you included and the memories you approved. '
                'Its manifest holds only fingerprints (hashes) of your data, never the data itself.',
                style: ALTTypography.bodySmall,
              ),
              const SizedBox(height: 12),
              if (versions == null && _error == null) const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator(color: ALTColors.irisViolet))),
              if (_error != null) Padding(padding: const EdgeInsets.all(24), child: Column(children: [Text(_error!, textAlign: TextAlign.center), TextButton(onPressed: _load, child: const Text('Try again'))])),
              if (versions != null && versions.isEmpty)
                Padding(
                  padding: const EdgeInsets.all(32),
                  child: Column(children: [
                    const Icon(Icons.history, size: 48, color: ALTColors.irisViolet),
                    const SizedBox(height: 12),
                    const Text('No versions yet', style: ALTTypography.headlineSmall),
                    const SizedBox(height: 6),
                    const Text('Build your first version in Deploy once you have added data and chatted with your AI.', textAlign: TextAlign.center, style: ALTTypography.bodySmall),
                    const SizedBox(height: 12),
                    FilledButton(onPressed: () => context.go('/training'), child: const Text('Go to Deploy')),
                  ]),
                ),
              for (final v in versions ?? <AiVersionInfo>[])
                Card(
                  margin: const EdgeInsets.only(bottom: 12),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Text('v${v.version}', style: ALTTypography.headlineSmall),
                        const SizedBox(width: 8),
                        _Badge(
                          v.current ? 'Live everywhere' : (v.published ? 'On-chain' : 'Built'),
                          v.current ? ALTColors.jadeSurge : (v.published ? ALTColors.skyFlux : ALTColors.solarEmber),
                        ),
                        const Spacer(),
                        Text(_date(v.createdAt), style: ALTTypography.bodySmall),
                      ]),
                      const SizedBox(height: 6),
                      Text('${v.datasets} data item${v.datasets == 1 ? '' : 's'} · ${v.memories} memor${v.memories == 1 ? 'y' : 'ies'}', style: ALTTypography.bodySmall),
                      const SizedBox(height: 6),
                      _CopyRow(label: 'Manifest', value: v.manifestCid, shown: _short(v.manifestCid)),
                      if (v.onchainTx != null && !v.onchainTx!.startsWith('adopted')) _CopyRow(label: 'Transaction', value: v.onchainTx!, shown: _short(v.onchainTx!)),
                      Row(children: [
                        TextButton.icon(
                          onPressed: () => launchUrl(Uri.parse(v.manifestUrl), mode: LaunchMode.externalApplication),
                          icon: const Icon(Icons.open_in_new, size: 18),
                          label: const Text('View manifest'),
                        ),
                        const Spacer(),
                        if (publishable?.id == v.id)
                          FilledButton(onPressed: _busy ? null : () => _publish(ai!, v), child: Text('Publish v${v.version}')),
                      ]),
                      if (!v.published && ai != null && !ai.verified && v.id == versions!.first.id)
                        Text('Deploy your AI to record this version with its identity token.', style: ALTTypography.bodySmall),
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

class _Badge extends StatelessWidget {
  const _Badge(this.text, this.color);
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(12)),
        child: Text(text, style: ALTTypography.labelMedium.copyWith(color: color)),
      );
}

class _CopyRow extends StatelessWidget {
  const _CopyRow({required this.label, required this.value, required this.shown});
  final String label;
  final String value;
  final String shown;

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: () {
          Clipboard.setData(ClipboardData(text: value));
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$label copied')));
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Row(children: [
            SizedBox(width: 92, child: Text(label, style: ALTTypography.bodySmall.copyWith(fontWeight: FontWeight.w600))),
            Expanded(child: Text(shown, style: ALTTypography.bodySmall.copyWith(fontFamily: 'monospace'))),
            const Icon(Icons.copy, size: 14),
          ]),
        ),
      );
}
