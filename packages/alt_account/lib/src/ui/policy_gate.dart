import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../client.dart';
import '../errors.dart';
import '../policies.dart';

/// Asks a signed-in person to agree to ALT's policies when there is a version they haven't agreed to
/// (new account, or ALT published a change). Wrap the app with it, like [AltAppLockGate]:
/// `builder: (context, child) => AltPolicyGate(client: alt, child: child!)`.
class AltPolicyGate extends StatefulWidget {
  const AltPolicyGate({super.key, required this.client, required this.child});

  final AltAccountClient client;
  final Widget child;

  @override
  State<AltPolicyGate> createState() => _AltPolicyGateState();
}

class _AltPolicyGateState extends State<AltPolicyGate> with WidgetsBindingObserver {
  late final AltPolicies _policies = AltPolicies(widget.client);
  List<AltPolicy> _pending = const [];
  String? _checkedFor;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.client.currentUser.addListener(_check);
    _check();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.client.currentUser.removeListener(_check);
    super.dispose();
  }

  // Coming back to the app (e.g. after reading a policy) checks again.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _checkedFor = null;
      _check();
    }
  }

  Future<void> _check() async {
    final user = widget.client.currentUser.value;
    if (user == null) {
      _checkedFor = null;
      if (_pending.isNotEmpty && mounted) setState(() => _pending = const []);
      return;
    }
    if (_checkedFor == user.id) return;
    _checkedFor = user.id;
    try {
      final pending = await _policies.pending();
      if (mounted) setState(() => _pending = pending);
    } catch (_) {
      // Offline or signed out meanwhile: ask next time.
      _checkedFor = null;
    }
  }

  Future<void> _agree() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final left = await _policies.accept(_pending);
      if (!mounted) return;
      setState(() => _pending = left);
    } on AltApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_pending.isEmpty) return widget.child;
    final theme = Theme.of(context);
    final updated = _pending.any((p) => p.acceptedVersion != null);
    return Stack(
      children: [
        widget.child,
        const Positioned.fill(child: ModalBarrier(dismissible: false, color: Colors.black54)),
        SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 440),
                child: Material(
                  color: theme.colorScheme.surface,
                  borderRadius: BorderRadius.circular(20),
                  clipBehavior: Clip.antiAlias,
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.fromLTRB(20, 22, 20, 16),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(updated ? 'ALT updated its policies' : "Please read ALT's policies", style: theme.textTheme.titleLarge),
                        const SizedBox(height: 6),
                        Text(
                          updated ? 'Read what changed, then agree to keep using ALT.' : 'They apply in ALTER, ALTERA and ALTAR.',
                          style: theme.textTheme.bodyMedium,
                        ),
                        const SizedBox(height: 12),
                        for (final p in _pending)
                          ListTile(
                            contentPadding: EdgeInsets.zero,
                            leading: const Icon(Icons.description_outlined),
                            title: Text('${p.title} · v${p.version}'),
                            subtitle: p.acceptedVersion != null ? Text(p.summary) : null,
                            trailing: TextButton(
                              onPressed: () => launchUrl(_policies.pageFor(p.slug), mode: LaunchMode.inAppBrowserView),
                              child: const Text('Read'),
                            ),
                          ),
                        if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: TextStyle(color: theme.colorScheme.error))),
                        const SizedBox(height: 12),
                        FilledButton(onPressed: _busy ? null : _agree, child: Text(_busy ? 'Saving…' : 'I agree')),
                        TextButton(onPressed: _busy ? null : () => unawaited(widget.client.signOut()), child: const Text('Not now, sign me out')),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}
