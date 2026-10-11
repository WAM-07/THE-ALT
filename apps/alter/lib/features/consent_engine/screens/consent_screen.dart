import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';

import '../../../core/alt/ai_api.dart';
import '../../../core/alt/alt_session.dart';

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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Privacy & consent')),
      body: ValueListenableBuilder<AltAi?>(
        valueListenable: currentAi,
        builder: (context, ai, _) {
          if (ai == null) return const Center(child: CircularProgressIndicator());
          return AbsorbPointer(
            absorbing: _saving,
            child: ListView(padding: const EdgeInsets.symmetric(vertical: 8), children: [
              const Padding(
                padding: EdgeInsets.fromLTRB(16, 8, 16, 8),
                child: Text('You decide what your AI may do. Withdrawing consent takes effect immediately; data you added stays yours and can be deleted any time.'),
              ),
              for (final e in consentScopes.entries)
                SwitchListTile(
                  title: Text(e.value),
                  value: ai.consent(e.key),
                  onChanged: (v) => _set(e.key, v),
                ),
            ]),
          );
        },
      ),
    );
  }
}
