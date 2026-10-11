import 'package:flutter/material.dart';

import '../../core/alt/alt_session.dart';
import '../../core/theme/colors.dart';
import '../../core/theme/typography.dart';

/// Shown when ALT Core could not be reached while loading the person's AI. We do not know yet
/// whether they have one, so we wait here instead of guessing (guessing "no" would start onboarding).
class OfflineScreen extends StatefulWidget {
  const OfflineScreen({super.key});

  @override
  State<OfflineScreen> createState() => _OfflineScreenState();
}

class _OfflineScreenState extends State<OfflineScreen> {
  bool _trying = false;

  Future<void> _retry() async {
    setState(() => _trying = true);
    await loadMyAi(); // the router moves on by itself once it succeeds
    if (mounted) setState(() => _trying = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            const Icon(Icons.cloud_off_rounded, size: 64, color: ALTColors.irisViolet),
            const SizedBox(height: 16),
            const Text('Can’t reach ALT right now', style: ALTTypography.headlineMedium, textAlign: TextAlign.center),
            const SizedBox(height: 8),
            Text(
              'Check your internet connection. If you are running ALT yourself, make sure `npm run dev` is running.\n${AltConfig.apiUrl}',
              style: ALTTypography.bodySmall,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: _trying ? null : _retry,
              icon: _trying ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.refresh),
              label: const Text('Try again'),
            ),
            TextButton(onPressed: () => altAccount.signOut(), child: const Text('Sign out')),
          ]),
        ),
      ),
    );
  }
}
