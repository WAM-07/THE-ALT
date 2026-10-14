import 'dart:async';

import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/alt/ai_api.dart';
import '../../../core/alt/alt_session.dart';
import '../../../core/alt/follows_current_ai.dart';
import '../../../core/theme/ds.dart';
import '../../../shared/ui/ui.dart';

/// Build versions, pass the clearance checks, and deploy your AI with its identity token
/// (Modules 6, 9 and 17). Once deployed it can appear on ALTERA and ALTAR.
class TrainingScreen extends StatefulWidget {
  const TrainingScreen({super.key});

  @override
  State<TrainingScreen> createState() => _TrainingScreenState();
}

class _TrainingScreenState extends State<TrainingScreen> with FollowsCurrentAi {
  @override
  void onAiSwitched() {
    setState(() {
      _versions = [];
      _gate = null;
    });
    _reload();
  }

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

  void _toast(String m) => toast(context, m);

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
        padding: const EdgeInsets.only(bottom: 10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(k.toUpperCase(), style: Ds.overline.copyWith(fontSize: 10)),
          const SizedBox(height: 3),
          SelectableText(v, style: Ds.caption.copyWith(color: Ds.text)),
        ]),
      );

  static String _short(String s) => s.length <= 18 ? s : '${s.substring(0, 8)}…${s.substring(s.length - 6)}';

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<AltAi?>(
      valueListenable: currentAi,
      builder: (context, ai, _) {
        if (ai == null) return const AltPage(children: [Loading()]);
        final latest = _versions.isEmpty ? null : _versions.first;
        final unpublished = _versions.where((v) => !v.published).toList();
        return AltPage(
          onRefresh: _reload,
          children: [
            PageHeader(
              eyebrow: 'Identity',
              title: ai.verified ? 'Verified on-chain' : 'Give it an identity',
              subtitle: ai.verified
                  ? 'Its token proves this AI is yours, wherever it appears.'
                  : 'Build a version, pass the checks, then mint the token that proves it is yours.',
            ),
            AiIdentityCard(ai: ai),
            if (_busy) ...[
              const SizedBox(height: 14),
              Glass(
                tint: Ds.iris,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                child: Row(children: [
                  const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
                  const SizedBox(width: 12),
                  Expanded(child: Text(_busyLabel ?? 'Working…', style: Ds.bodyStrong)),
                ]),
              ),
            ],
            if (ai.verified && unpublished.isNotEmpty) ...[
              const SizedBox(height: 14),
              Glass(
                tint: Ds.iris,
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    const IconBadge(Icons.rocket_launch_outlined),
                    const SizedBox(width: 12),
                    Expanded(child: Text('Version ${unpublished.first.version} is ready', style: Ds.headline)),
                  ]),
                  const SizedBox(height: 10),
                  Text('Record it on your identity token. ALTERA and ALTAR switch to it once the transaction confirms.', style: Ds.callout),
                  const SizedBox(height: 16),
                  Btn('Publish v${unpublished.first.version}', kind: BtnKind.aurora, icon: Icons.bolt_rounded, expand: true, onTap: _busy ? null : () => _publish(unpublished.first)),
                ]),
              ),
            ],
            if (ai.token != null) _tokenSection(ai.token!),
            if (!ai.verified) _journey(ai, latest),
            SectionLabel('Versions', action: _versions.isEmpty ? null : 'All ${_versions.length}', onAction: () => context.push('/ai/versions')),
            if (_versions.isEmpty)
              Glass(child: Text('No versions yet. Building one freezes what your AI knows right now and pins a public fingerprint of it to IPFS.', style: Ds.callout))
            else
              Group(children: [
                for (final v in _versions.take(3))
                  ListRow(
                    icon: v.current ? Icons.verified_rounded : (v.published ? Icons.link_rounded : Icons.layers_outlined),
                    color: v.current ? Ds.mint : (v.published ? Ds.sky : Ds.amber),
                    title: 'Version ${v.version}',
                    subtitle: _short(v.manifestCid),
                    trailing: Pill(v.current ? 'Live' : (v.published ? 'On-chain' : 'Built'), color: v.current ? Ds.mint : (v.published ? Ds.sky : Ds.amber)),
                    onTap: () => context.push('/ai/versions'),
                  ),
              ]),
            const SizedBox(height: 14),
            Btn('Build a new version', icon: Icons.add_rounded, kind: BtnKind.secondary, expand: true, onTap: _busy || ai.status == 'minting' ? null : _build),
            const SizedBox(height: 8),
            Text('Freezes its personality, the knowledge you included and the memories you approved.', textAlign: TextAlign.center, style: Ds.caption.copyWith(color: Ds.textTertiary)),
          ],
        );
      },
    );
  }

  Widget _tokenSection(AiToken token) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const SectionLabel('Token'),
        Group(children: [
          ListRow(icon: Icons.tag_rounded, title: 'Token #${token.tokenId}', subtitle: 'AI identity token · ERC-721', trailing: _copy(token.tokenId, 'Token id')),
          ListRow(icon: Icons.description_outlined, color: Ds.sky, title: 'Contract', subtitle: _short(token.contract), trailing: _copy(token.contract, 'Contract')),
          ListRow(icon: Icons.account_balance_wallet_outlined, color: Ds.mint, title: 'Owner', subtitle: _short(token.owner), trailing: _copy(token.owner, 'Owner')),
          ListRow(icon: Icons.layers_outlined, color: Ds.amber, title: 'On-chain version', subtitle: 'v${token.onchainVersion} · ${switch (token.chainId) { 31337 => 'ALT local chain', 80002 => 'Polygon Amoy', 137 => 'Polygon', _ => 'chain ${token.chainId}' }}'),
        ]),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: Btn('Verify', icon: Icons.fact_check_outlined, kind: BtnKind.secondary, onTap: () => launchUrl(Uri.parse(media(token.verifyUrl)), mode: LaunchMode.externalApplication))),
          if (token.explorer != null) ...[
            const SizedBox(width: 10),
            Expanded(child: Btn('Explorer', icon: Icons.open_in_new_rounded, kind: BtnKind.secondary, onTap: () => launchUrl(Uri.parse(token.explorer!), mode: LaunchMode.externalApplication))),
          ],
        ]),
      ]);

  Widget _copy(String value, String label) => IconButton(
        tooltip: 'Copy',
        icon: const Icon(Icons.copy_rounded, size: 18, color: Ds.textTertiary),
        onPressed: () {
          Clipboard.setData(ClipboardData(text: value));
          toast(context, '$label copied');
        },
      );

  /// Build → clearance → mint, as a vertical timeline.
  Widget _journey(AltAi ai, AiVersionInfo? latest) {
    final gate = _gate;
    final built = latest != null;
    final cleared = gate?.$1 ?? false;
    final failing = gate?.$2.where((c) => !c.passed).toList() ?? const <ClearanceCheck>[];
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SectionLabel('Your path to verified'),
      _Step(
        n: 1,
        done: built,
        title: 'Build a version',
        body: built ? 'Version ${latest.version} is built and pinned to IPFS.' : 'Freeze what your AI knows into its first version.',
        action: built ? null : Btn('Build version 1', compact: true, onTap: _busy ? null : _build),
      ),
      _Step(
        n: 2,
        done: cleared,
        title: 'Pass the checks',
        body: gate == null ? 'Checking…' : (cleared ? 'Everything is in place.' : '${failing.length} of ${gate.$2.length} still to do.'),
        child: gate == null || cleared
            ? null
            : Column(children: [
                for (final c in gate.$2)
                  Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: Row(children: [
                      Icon(c.passed ? Icons.check_circle_rounded : Icons.radio_button_unchecked_rounded, size: 18, color: c.passed ? Ds.mint : Ds.textTertiary),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(c.detail == null ? c.label : '${c.label} (${c.detail})',
                            style: Ds.caption.copyWith(color: c.passed ? Ds.textSecondary : Ds.text)),
                      ),
                      if (!c.passed && c.id != 'wallet') Pressable(onTap: _busy ? null : () => _fix(c), child: Text('Fix', style: Ds.caption.copyWith(color: Ds.iris, fontWeight: FontWeight.w700))),
                    ]),
                  ),
              ]),
      ),
      _Step(
        n: 3,
        done: ai.verified,
        last: true,
        title: 'Mint its identity token',
        body: ai.status == 'minting' ? 'Minting… this takes a few seconds.' : 'Writes your AI’s identity to the blockchain. It can then appear on ALTERA and ALTAR.',
        action: Btn(
          ai.status == 'minting' ? 'Minting…' : 'Deploy v${latest?.version ?? 1}',
          kind: BtnKind.aurora,
          icon: Icons.fingerprint_rounded,
          loading: ai.status == 'minting',
          onTap: cleared && !_busy && ai.status != 'minting' ? _deploy : null,
        ),
      ),
    ]);
  }
}

class _Step extends StatelessWidget {
  const _Step({required this.n, required this.done, required this.title, required this.body, this.action, this.child, this.last = false});
  final int n;
  final bool done;
  final String title;
  final String body;
  final Widget? action;
  final Widget? child;
  final bool last;

  @override
  Widget build(BuildContext context) {
    return IntrinsicHeight(
      child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Column(children: [
          Container(
            width: 30,
            height: 30,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: done ? Ds.aurora : null,
              color: done ? null : Ds.glass,
              border: done ? null : Border.all(color: Ds.hairlineStrong),
            ),
            child: Center(child: done ? const Icon(Icons.check_rounded, size: 17, color: Colors.white) : Text('$n', style: Ds.caption.copyWith(color: Ds.text, fontWeight: FontWeight.w700))),
          ),
          if (!last) Expanded(child: Container(width: 1.5, margin: const EdgeInsets.symmetric(vertical: 6), color: done ? Ds.iris.withValues(alpha: 0.5) : Ds.hairline)),
        ]),
        const SizedBox(width: 14),
        Expanded(
          child: Padding(
            padding: EdgeInsets.only(bottom: last ? 0 : 22, top: 4),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: Ds.headline.copyWith(color: done ? Ds.textSecondary : Ds.text)),
              const SizedBox(height: 3),
              Text(body, style: Ds.caption),
              if (child != null) child!,
              if (action != null) ...[const SizedBox(height: 12), action!],
            ]),
          ),
        ),
      ]),
    );
  }
}
