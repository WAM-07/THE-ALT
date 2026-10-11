import 'package:flutter/material.dart';

import '../../core/alt/alt_session.dart';
import '../../core/theme/ds.dart';
import '../ui/ui.dart';

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
    return Backdrop(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          child: Center(
            child: EmptyState(
              icon: Icons.cloud_off_rounded,
              title: 'Can’t reach ALT right now',
              body: 'Check your internet connection. If you run ALT yourself, make sure `npm run dev` is running.\n${AltConfig.apiUrl}',
              action: Column(children: [
                Btn('Try again', icon: Icons.refresh_rounded, loading: _trying, onTap: _trying ? null : _retry),
                const SizedBox(height: 8),
                TextButton(onPressed: () => altAccount.signOut(), child: Text('Sign out', style: Ds.callout)),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}
