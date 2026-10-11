import 'dart:async';

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
import '../../../shared/widgets/alt_card.dart';
import '../../../shared/widgets/gradient_background.dart';

/// Build versions, pass the clearance checks, and deploy your AI with its identity token
/// (Modules 6, 9 and 17). Once deployed it can appear on ALTERA and ALTAR.
class TrainingScreen extends StatefulWidget {
  const TrainingScreen({super.key});

  @override
  State<TrainingScreen> createState() => _TrainingScreenState();
}

class _TrainingScreenState extends State<TrainingScreen> {
  List<AiVersionInfo> _versions = [];
  (bool, List<ClearanceCheck>)? _gate;
  bool _busy = false;
  String? _busyLabel;
  Timer? _poll;

  AltAi? get _ai => currentAi.value;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  void _toast(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<void> _reload() async {
    final ai = await refreshCurrentAi();
    if (ai == null) return;
    try {
      final results = await Future.wait([aiApi.versions(ai.id), aiApi.clearance(ai.id)]);
      if (!mounted) return;
      setState(() {
        _versions = results[0] as List<AiVersionInfo>;
        _gate = results[1] as (bool, List<ClearanceCheck>);
      });
      if (ai.status == 'minting') _watchDeployment();
    } on AltApiException catch (e) {
      _toast(e.message);
    }
  }

  Future<void> _run(String label, Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _busyLabel = label;
    });
    try {
      await action();
    } on AltApiException catch (e) {
      _toast(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    await _reload();
  }

  Future<void> _build() => _run('Building a new version…', () async {
        final v = await aiApi.buildVersion(_ai!.id);
        _toast('Version ${v.version} built and pinned to IPFS');
      });

  Future<void> _fix(ClearanceCheck c) async {
    final ai = _ai!;
    switch (c.id) {
      case 'consent_training':
        return _run('Saving consent…', () => aiApi.setConsent(ai.id, 'persona_training', true));
      case 'consent_provider':
        return _run('Saving consent…', () => aiApi.setConsent(ai.id, 'third_party_processing', true));
      case 'consent_deployment':
        return _run('Saving consent…', () => aiApi.setConsent(ai.id, 'public_deployment', true));
      case 'version_built':
        return _build();
      case 'tested':
        context.go('/chat');
      case 'owner_confirmed':
        final ok = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Does it behave like you?'),
            content: const Text('Only confirm after chatting with it. Your AI will speak for you on ALTERA and ALTAR.'),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Not yet')),
              FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Yes, it’s me')),
            ],
          ),
        );
        if (ok == true) await _run('Saving…', () => aiApi.confirm(ai.id, true));
      case 'persona_safe':
        context.go('/chat');
        _toast('Adjust its personality so it passes the safety check, then rebuild.');
      default:
        _toast(c.label);
    }
  }

  Future<void> _deploy() async {
    final ai = _ai!;
    Map<String, dynamic> preview;
    try {
      preview = await aiApi.deployPreview(ai.id);
    } on AltApiException catch (e) {
      return _toast(e.message);
    }
    if (!mounted) return;
    final costPol = (BigInt.tryParse('${preview['estimatedCostWei']}') ?? BigInt.zero) / BigInt.from(10).pow(18);
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Mint your AI identity token'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('This writes your AI’s identity to the blockchain. It cannot be undone.'),
            const SizedBox(height: 12),
            _kv('Network', '${preview['network']} (chain ${preview['chainId']})'),
            _kv('Contract', '${preview['contract']}'),
            _kv('Call', '${preview['function']}'),
            _kv('Token goes to', '${preview['to']} (your wallet)'),
            _kv('Version', 'v${preview['version']}'),
            _kv('Manifest (IPFS)', '${preview['manifestCid']}'),
            _kv('Creator royalty', '${(preview['royaltyBps'] as num) / 100}% of later sales and rentals'),
            _kv('Estimated gas', '${preview['gasEstimate']} (≈ ${costPol.toStringAsFixed(6)} POL)'),
            _kv('Paid by', '${preview['paidBy']}'),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Mint')),
        ],
      ),
    );
    if (go != true) return;
    await _run('Sending the mint transaction…', () => aiApi.deploy(ai.id));
    _watchDeployment();
  }

  void _watchDeployment() {
    _poll?.cancel();
    var ticks = 0;
    _poll = Timer.periodic(const Duration(seconds: 2), (t) async {
      ticks++;
      final ai = await refreshCurrentAi().catchError((_) => null);
      if (!mounted) return t.cancel();
      if (ai == null || ai.status != 'minting' || ticks > 90) {
        t.cancel();
        await _reload();
        if (mounted && ai?.verified == true) _toast('Verified! Your AI now has identity token #${ai!.token?.tokenId}.');
      }
      if (mounted) setState(() {});
    });
  }

  Future<void> _publish(AiVersionInfo v) => _run('Publishing v${v.version} on-chain…', () async {
        await aiApi.publish(_ai!.id, v.id);
        _toast('Publishing v${v.version}. ALTERA and ALTAR switch to it once confirmed.');
      });

  static Widget _kv(String k, String v) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(k, style: ALTTypography.bodySmall.copyWith(fontWeight: FontWeight.w600)),
          SelectableText(v, style: ALTTypography.bodySmall),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return GradientBackground(
      baseColor: isDark ? ALTColors.darkBgPage : ALTColors.lightBgPage,
      layers: isDark ? ALTGradients.alterDark : ALTGradients.alterLight,
      animate: false,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: AppBar(title: const Text('Train & deploy', style: ALTTypography.headlineMedium), backgroundColor: Colors.transparent, elevation: 0),
        body: ValueListenableBuilder<AltAi?>(
          valueListenable: currentAi,
          builder: (context, ai, _) {
            if (ai == null) return const Center(child: CircularProgressIndicator());
            final latest = _versions.isEmpty ? null : _versions.first;
            final unpublished = _versions.where((v) => !v.published).toList();
            return RefreshIndicator(
              onRefresh: _reload,
              child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 120), children: [
                _statusCard(ai),
                if (_busy) Padding(padding: const EdgeInsets.only(top: 12), child: LinearProgressIndicator(semanticsLabel: _busyLabel)),
                if (_busy && _busyLabel != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(_busyLabel!, style: ALTTypography.bodySmall)),
                const SizedBox(height: 16),
                ALTCard(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Text('1. Build a version', style: ALTTypography.labelLarge),
                    const SizedBox(height: 6),
                    Text(
                      'Freezes your AI’s current personality, the data you included and the memories you approved. '
                      'A public manifest with fingerprints (never your data) is pinned to IPFS.',
                      style: ALTTypography.bodySmall,
                    ),
                    const SizedBox(height: 10),
                    FilledButton.icon(onPressed: _busy || ai.status == 'minting' ? null : _build, icon: const Icon(Icons.build_circle_outlined), label: const Text('Build new version')),
                    for (final v in _versions.take(5))
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                        leading: Icon(v.current ? Icons.verified : (v.published ? Icons.cloud_done_outlined : Icons.inventory_2_outlined)),
                        title: Text('v${v.version}${v.current ? ' · live everywhere' : v.published ? ' · on-chain' : ' · built'}'),
                        subtitle: Text(v.manifestCid, maxLines: 1, overflow: TextOverflow.ellipsis),
                        onTap: () => launchUrl(Uri.parse(v.manifestUrl), mode: LaunchMode.externalApplication),
                      ),
                    if (_versions.isNotEmpty)
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton(onPressed: () => context.push('/ai/versions'), child: Text('All ${_versions.length} versions')),
                      ),
                  ]),
                ),
                const SizedBox(height: 16),
                if (!ai.verified) _clearanceCard(ai, latest),
                if (ai.verified && unpublished.isNotEmpty)
                  ALTCard(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      const Text('Publish your latest version', style: ALTTypography.labelLarge),
                      const SizedBox(height: 6),
                      const Text('Records the new version on your identity token. ALTERA and ALTAR then use it.', style: ALTTypography.bodySmall),
                      const SizedBox(height: 10),
                      FilledButton(onPressed: _busy ? null : () => _publish(unpublished.first), child: Text('Publish v${unpublished.first.version}')),
                    ]),
                  ),
              ]),
            );
          },
        ),
      ),
    );
  }

  Widget _statusCard(AltAi ai) {
    final (label, color, icon) = switch (ai.status) {
      'verified' => ('Verified · identity token #${ai.token?.tokenId}', ALTColors.jadeSurge, Icons.verified),
      'minting' => ('Minting its identity token…', ALTColors.solarEmber, Icons.hourglass_top),
      'ready' => ('Ready to deploy once the checks pass', ALTColors.skyFlux, Icons.check_circle_outline),
      _ => ('Draft: add data, chat, then build a version', ALTColors.lightTextMuted, Icons.edit_outlined),
    };
    final token = ai.token;
    return ALTCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [Icon(icon, color: color), const SizedBox(width: 8), Expanded(child: Text(label, style: ALTTypography.labelLarge.copyWith(color: color)))]),
        if (token != null) ...[
          const SizedBox(height: 10),
          Text('Contract ${token.contract}', style: ALTTypography.bodySmall),
          Text('Owner ${token.owner}', style: ALTTypography.bodySmall),
          Text('On-chain version v${token.onchainVersion}', style: ALTTypography.bodySmall),
          const SizedBox(height: 8),
          Wrap(spacing: 8, children: [
            OutlinedButton.icon(
              icon: const Icon(Icons.fact_check_outlined, size: 18),
              label: const Text('Verify'),
              onPressed: () => launchUrl(Uri.parse(token.verifyUrl), mode: LaunchMode.externalApplication),
            ),
            if (token.explorer != null)
              OutlinedButton.icon(
                icon: const Icon(Icons.open_in_new, size: 18),
                label: const Text('Explorer'),
                onPressed: () => launchUrl(Uri.parse(token.explorer!), mode: LaunchMode.externalApplication),
              ),
            OutlinedButton.icon(
              icon: const Icon(Icons.copy, size: 18),
              label: const Text('Token id'),
              onPressed: () => Clipboard.setData(ClipboardData(text: token.tokenId)),
            ),
          ]),
        ],
      ]),
    );
  }

  Widget _clearanceCard(AltAi ai, AiVersionInfo? latest) {
    final gate = _gate;
    return ALTCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('2. Clearance', style: ALTTypography.labelLarge),
        const SizedBox(height: 6),
        const Text('Before your AI can represent you on ALTERA and ALTAR, all of these must be true.', style: ALTTypography.bodySmall),
        const SizedBox(height: 6),
        if (gate == null) const Padding(padding: EdgeInsets.all(12), child: Center(child: CircularProgressIndicator())),
        for (final c in gate?.$2 ?? <ClearanceCheck>[])
          ListTile(
            contentPadding: EdgeInsets.zero,
            dense: true,
            leading: Icon(c.passed ? Icons.check_circle : Icons.radio_button_unchecked, color: c.passed ? ALTColors.jadeSurge : ALTColors.solarEmber),
            title: Text(c.label),
            subtitle: c.detail != null ? Text(c.detail!) : null,
            trailing: c.passed || c.id == 'wallet' ? null : TextButton(onPressed: _busy ? null : () => _fix(c), child: const Text('Fix')),
          ),
        const SizedBox(height: 8),
        const Text('3. Deploy', style: ALTTypography.labelLarge),
        const SizedBox(height: 6),
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: ALTColors.irisViolet, padding: const EdgeInsets.symmetric(vertical: 14)),
            onPressed: (gate?.$1 ?? false) && !_busy && ai.status != 'minting' ? _deploy : null,
            icon: const Icon(Icons.token_outlined),
            label: Text(ai.status == 'minting' ? 'Minting…' : 'Deploy v${latest?.version ?? '?'} with an identity token'),
          ),
        ),
      ]),
    );
  }
}
