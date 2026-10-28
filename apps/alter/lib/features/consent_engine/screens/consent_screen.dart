import 'package:alt_account/alt_account.dart';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';

import '../../../core/alt/ai_api.dart';
import '../../../core/alt/alt_session.dart';
import '../../../core/theme/ds.dart';
import '../../../shared/ui/ui.dart';

/// Consent Engine (Module 8): what your AI may do with your data. Every change is recorded with
/// the policy version in ALT Core's permanent consent history.
class ConsentScreen extends StatefulWidget {
  const ConsentScreen({super.key});

  @override
  State<ConsentScreen> createState() => _ConsentScreenState();
}

class _ConsentScreenState extends State<ConsentScreen> {
  bool _saving = false;

  Future<void> _set(String scope, bool granted) async {
    final ai = currentAi.value;
    if (ai == null) return;
    setState(() => _saving = true);
    try {
      await aiApi.setConsent(ai.id, scope, granted);
      await refreshCurrentAi();
    } on AltApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  /// Saves the full consent record (Module 8 FE-4) as a PDF on the phone.
  Future<void> _downloadRecord(AltAi ai) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      final bytes = await aiApi.consentRecordPdf(ai.id);
      final dir = await getApplicationDocumentsDirectory();
      final file = File('${dir.path}/consent-${ai.handle}.pdf');
      await file.writeAsBytes(bytes);
      messenger.showSnackBar(SnackBar(content: Text('Consent record saved: ${file.path}')));
    } on AltApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } catch (_) {
      messenger.showSnackBar(const SnackBar(content: Text('Could not save the record. Try again.')));
    }
  }

  static Map<String, (String, IconData, Color)> get _titles => {
    'persona_training': ('Learn from my data', Icons.auto_awesome_outlined, Ds.iris),
    'third_party_processing': ('Use an AI provider', Icons.cloud_outlined, Ds.sky),
    'public_deployment': ('Appear on ALTERA and ALTAR', Icons.public_rounded, Ds.mint),
    'interaction_learning': ('Suggest memories from chats', Icons.psychology_alt_outlined, Ds.amber),
  };

  @override
  Widget build(BuildContext context) {
    return Backdrop(
      animate: false,
      intensity: 0.35,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: topBar(context),
        body: ValueListenableBuilder<AltAi?>(
          valueListenable: currentAi,
          builder: (context, ai, _) {
            if (ai == null) return const Loading();
            return AbsorbPointer(
              absorbing: _saving,
              child: ListView(padding: const EdgeInsets.fromLTRB(Ds.gutter, 0, Ds.gutter, 40), children: [
                const PageHeader(
                  eyebrow: 'Privacy',
                  title: 'Your consent',
                  subtitle: 'You decide what your AI may do. Changes take effect immediately and are kept in ALT Core’s permanent consent record.',
                ),
                for (final e in consentScopes.entries) ...[
                  Glass(
                    padding: const EdgeInsets.fromLTRB(16, 16, 10, 16),
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      IconBadge(_titles[e.key]?.$2 ?? Icons.check, color: _titles[e.key]?.$3 ?? Ds.iris, size: 38),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(_titles[e.key]?.$1 ?? e.key, style: Ds.bodyStrong),
                          const SizedBox(height: 4),
                          Text(e.value, style: Ds.caption),
                        ]),
                      ),
                      Switch(value: ai.consent(e.key), onChanged: (v) => _set(e.key, v)),
                    ]),
                  ),
                  const SizedBox(height: 10),
                ],
                if (!kIsWeb) ...[
                  const SizedBox(height: 6),
                  Btn('Download my consent record', icon: Icons.download_rounded, kind: BtnKind.secondary, expand: true, onTap: () => _downloadRecord(ai)),
                ],
              ]),
            );
          },
        ),
      ),
    );
  }
}
