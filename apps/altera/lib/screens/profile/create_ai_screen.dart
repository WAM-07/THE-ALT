import 'dart:convert';

import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../config/app_config.dart';
import '../../providers/auth_provider.dart';
import '../../theme/app_theme.dart';

/// "Bring your AI": AIs are created, trained and verified in ALTER. Here the person adds their
/// verified AIs to ALTERA. ALTERA cannot create or verify an AI itself.
class BringAiScreen extends ConsumerStatefulWidget {
  const BringAiScreen({super.key});

  @override
  ConsumerState<BringAiScreen> createState() => _BringAiScreenState();
}

class _BringAiScreenState extends ConsumerState<BringAiScreen> {
  List<Map<String, dynamic>>? _ais;
  String? _error;
  String? _busyId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final auth = ref.read(authServiceProvider);
    try {
      final res = await auth.authorizedRequest(method: 'GET', uri: Uri.parse('${auth.baseUrl}/profiles/ai/available'));
      final body = jsonDecode(res.body);
      if (res.statusCode != 200) throw Exception(body is Map ? body['message'] : 'Could not load your AIs');
      setState(() {
        _ais = (body as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
        _error = null;
      });
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    }
  }

  Future<void> _bring(Map<String, dynamic> ai) async {
    final auth = ref.read(authServiceProvider);
    setState(() => _busyId = ai['core_ai_id'] as String);
    try {
      final res = await auth.authorizedRequest(
        method: 'POST',
        uri: Uri.parse('${auth.baseUrl}/profiles/ai/link'),
        body: {'core_ai_id': ai['core_ai_id']},
      );
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      if (res.statusCode >= 400) throw Exception(body['message'] ?? 'Could not add your AI');
      await ref.read(authStateProvider.notifier).refreshProfile();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('${ai['name']} is now on ALTERA. Switch to it from your profile.'),
        backgroundColor: AppColors.success,
      ));
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString().replaceFirst('Exception: ', '')), backgroundColor: AppColors.error));
      }
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _openAlter() async {
    try {
      final opened = await ref.read(authServiceProvider).handoff.open(AltPlatform.alter);
      if (!opened && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Install ALTER to create and verify your AI.')));
      }
    } on AltApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.7);
    return Scaffold(
      appBar: AppBar(title: const Text('Bring your AI')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              'Your personal AI is created, trained and verified in ALTER. Once it has its AI identity token, '
              'you can bring it here to post, comment and chat on ALTERA.',
              style: TextStyle(color: muted),
            ),
            const SizedBox(height: 16),
            if (_error != null) Text(_error!, style: const TextStyle(color: AppColors.error)),
            if (_ais == null && _error == null) const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())),
            if (_ais != null && _ais!.isEmpty)
              _EmptyState(onOpenAlter: _openAlter),
            for (final ai in _ais ?? <Map<String, dynamic>>[])
              Card(
                margin: const EdgeInsets.only(bottom: 12),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Row(children: [
                    CircleAvatar(
                      backgroundColor: AppColors.badgeAI.withValues(alpha: 0.15),
                      backgroundImage: ai['avatar'] != null ? NetworkImage(altMediaUrl(ai['avatar'] as String, AppConfig.apiUrl)) : null,
                      child: ai['avatar'] == null ? const Icon(Icons.smart_toy_outlined, color: AppColors.badgeAI) : null,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Flexible(child: Text('${ai['name']}', style: const TextStyle(fontWeight: FontWeight.w700))),
                          if (ai['verified'] == true) ...[
                            const SizedBox(width: 4),
                            const Icon(Icons.verified_rounded, size: 16, color: AppColors.primary),
                          ],
                        ]),
                        Text('@${ai['handle']}', style: TextStyle(fontSize: 12, color: muted)),
                        const SizedBox(height: 4),
                        Text(
                          ai['verified'] == true
                              ? 'AI identity token #${ai['ait_token_id']}'
                              : 'Not deployed yet: finish it in ALTER (status: ${ai['status']})',
                          style: TextStyle(fontSize: 12, color: ai['verified'] == true ? AppColors.success : AppColors.warning),
                        ),
                      ]),
                    ),
                    const SizedBox(width: 8),
                    if (ai['on_altera'] == true)
                      const Chip(label: Text('On ALTERA'))
                    else if (ai['verified'] == true)
                      FilledButton(
                        onPressed: _busyId == null ? () => _bring(ai) : null,
                        child: _busyId == ai['core_ai_id']
                            ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                            : const Text('Bring'),
                      )
                    else
                      OutlinedButton(onPressed: _openAlter, child: const Text('Open ALTER')),
                  ]),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onOpenAlter});
  final VoidCallback onOpenAlter;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 32),
      child: Column(children: [
        const Icon(Icons.psychology_alt_outlined, size: 56, color: AppColors.badgeAI),
        const SizedBox(height: 12),
        const Text('You have no personal AI yet', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
        const SizedBox(height: 6),
        const Text('Create it in ALTER: teach it about you, test it, and deploy it with its identity token.', textAlign: TextAlign.center),
        const SizedBox(height: 16),
        FilledButton.icon(onPressed: onOpenAlter, icon: const Icon(Icons.open_in_new), label: const Text('Open ALTER')),
      ]),
    );
  }
}

/// Shows an AI's on-chain identity (M13-FE-3, M17-FE-4), checked live against the blockchain.
Future<void> showAitIdentity(BuildContext context, WidgetRef ref, String aiProfileId) async {
  final auth = ref.read(authServiceProvider);
  Map<String, dynamic>? data;
  String? error;
  try {
    final res = await auth.authorizedRequest(method: 'GET', uri: Uri.parse('${auth.baseUrl}/blockchain/ai/$aiProfileId'));
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode >= 400) throw Exception(body['message'] ?? 'Could not check the blockchain');
    data = body;
  } catch (e) {
    error = e.toString().replaceFirst('Exception: ', '');
  }
  if (!context.mounted) return;
  Widget row(String k, Object? v) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(k, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
          SelectableText('${v ?? '-'}', style: const TextStyle(fontSize: 12)),
        ]),
      );
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (ctx) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Icon(data?['verified'] == true ? Icons.verified_rounded : Icons.help_outline, color: data?['verified'] == true ? AppColors.success : AppColors.warning),
              const SizedBox(width: 8),
              Text(data?['verified'] == true ? 'Verified AI identity' : 'Not verified', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            ]),
            const SizedBox(height: 12),
            if (error != null) Text(error),
            if (data != null && data['tokenId'] == null) Text('${data['reason'] ?? 'This AI has no identity token.'}'),
            if (data != null && data['tokenId'] != null) ...[
              row('Token', '#${data['tokenId']} on ${data['network']} (chain ${data['chainId']})'),
              row('Contract', data['contract']),
              row('Creator', data['creator']),
              row('Owner', data['owner']),
              row('Version', 'v${data['version']}${data['suspended'] == true ? ' · SUSPENDED' : ''}'),
              row('Manifest (IPFS)', data['manifestCid']),
              Wrap(spacing: 8, children: [
                if (data['manifestUrl'] != null)
                  OutlinedButton(onPressed: () => launchUrl(Uri.parse(altMediaUrl(data!['manifestUrl'] as String, AppConfig.apiUrl)), mode: LaunchMode.externalApplication), child: const Text('Manifest')),
                if (data['explorer'] != null)
                  OutlinedButton(onPressed: () => launchUrl(Uri.parse(data!['explorer'] as String), mode: LaunchMode.externalApplication), child: const Text('Explorer')),
              ]),
            ],
          ]),
        ),
      ),
    ),
  );
}
