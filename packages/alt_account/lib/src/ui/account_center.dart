import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../client.dart';
import '../errors.dart';
import '../handoff.dart';
import '../models.dart';
import 'code_dialog.dart';

/// The ALT Account Center: one place, in every ALT app, to manage the account that works across
/// ALTER, ALTAR and ALTERA (profile, password, two-factor, devices, wallets and connected apps).
class AltAccountCenterScreen extends StatefulWidget {
  const AltAccountCenterScreen({super.key, required this.client, required this.handoff, this.onSignedOut});

  final AltAccountClient client;
  final AltHandoff handoff;

  /// Called after the person signs out from here; navigate to the app's sign-in screen.
  final VoidCallback? onSignedOut;

  @override
  State<AltAccountCenterScreen> createState() => _AltAccountCenterScreenState();
}

class _AltAccountCenterScreenState extends State<AltAccountCenterScreen> {
  List<AltSession>? _sessions;
  bool _busy = false;

  AltAccountClient get _client => widget.client;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    try {
      await _client.reloadMe();
      final sessions = await _client.sessions();
      if (mounted) setState(() => _sessions = sessions);
    } on AltApiException catch (e) {
      _toast(e.message);
    }
  }

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _guard(Future<void> Function() action, {String? success}) async {
    setState(() => _busy = true);
    try {
      await action();
      if (success != null) _toast(success);
    } on AltApiException catch (e) {
      _toast(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // ------------------------------------------------------------------ actions

  Future<void> _editProfile(AltUser user) async {
    final name = TextEditingController(text: user.displayName);
    final handle = TextEditingController(text: user.handle);
    final bio = TextEditingController(text: user.bio ?? '');
    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Edit profile'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: name, decoration: const InputDecoration(labelText: 'Name')),
            const SizedBox(height: 12),
            TextField(controller: handle, decoration: const InputDecoration(labelText: 'Handle', prefixText: '@')),
            const SizedBox(height: 12),
            TextField(controller: bio, maxLines: 3, maxLength: 500, decoration: const InputDecoration(labelText: 'Bio')),
            const Text('Your name, handle and picture are the same in every ALT app.', style: TextStyle(fontSize: 12)),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save')),
        ],
      ),
    );
    if (saved != true) return;
    await _guard(
      () => _client.updateProfile(
        displayName: name.text.trim() == user.displayName ? null : name.text.trim(),
        handle: handle.text.trim() == user.handle ? null : handle.text.trim(),
        bio: bio.text.trim() == (user.bio ?? '') ? null : bio.text.trim(),
      ),
      success: 'Profile updated everywhere',
    );
  }

  Future<void> _changePassword(AltUser user) async {
    final current = TextEditingController();
    final next = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(user.hasPassword ? 'Change password' : 'Set a password'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          if (user.hasPassword)
            TextField(controller: current, obscureText: true, decoration: const InputDecoration(labelText: 'Current password')),
          TextField(
            controller: next,
            obscureText: true,
            decoration: const InputDecoration(labelText: 'New password', helperText: 'At least 8 characters, with a letter and a number'),
          ),
          const SizedBox(height: 8),
          const Text('Other devices will be signed out.', style: TextStyle(fontSize: 12)),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save')),
        ],
      ),
    );
    if (ok != true) return;
    await _guard(
      () => _client.changePassword(currentPassword: user.hasPassword ? current.text : null, newPassword: next.text),
      success: 'Password saved. Other devices were signed out.',
    );
    await _reload();
  }

  Future<void> _enableTwoFactor() async {
    TwoFactorSetup setup;
    try {
      setup = await _client.startTwoFactorSetup();
    } on AltApiException catch (e) {
      return _toast(e.message);
    }
    if (!mounted) return;
    final proceed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Turn on two-factor authentication'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Add THE ALT to an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) with this key:'),
          const SizedBox(height: 12),
          SelectableText(setup.secret, style: const TextStyle(fontFamily: 'monospace', fontSize: 16, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Wrap(spacing: 8, children: [
            OutlinedButton.icon(
              icon: const Icon(Icons.copy, size: 16),
              label: const Text('Copy key'),
              onPressed: () => Clipboard.setData(ClipboardData(text: setup.secret)),
            ),
            OutlinedButton.icon(
              icon: const Icon(Icons.open_in_new, size: 16),
              label: const Text('Open authenticator'),
              onPressed: () => launchUrl(Uri.parse(setup.otpauthUrl), mode: LaunchMode.externalApplication),
            ),
          ]),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('I added it')),
        ],
      ),
    );
    if (proceed != true || !mounted) return;
    final entered = await showAltCodeDialog(context, title: 'Confirm', message: 'Enter the 6-digit code your authenticator shows now.');
    if (entered == null) return;
    try {
      final codes = await _client.enableTwoFactor(entered.code);
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => AlertDialog(
          title: const Text('Save your recovery codes'),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('If you lose your phone, each of these codes lets you sign in once. They are shown only now.'),
            const SizedBox(height: 12),
            SelectableText(codes.join('\n'), style: const TextStyle(fontFamily: 'monospace', fontSize: 15)),
          ]),
          actions: [
            TextButton(onPressed: () => Clipboard.setData(ClipboardData(text: codes.join('\n'))), child: const Text('Copy')),
            FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('I saved them')),
          ],
        ),
      );
      setState(() {});
    } on AltApiException catch (e) {
      _toast(e.message);
    }
  }

  Future<void> _disableTwoFactor() async {
    final entered = await showAltCodeDialog(
      context,
      title: 'Turn off two-factor authentication',
      message: 'Enter the current code from your authenticator app.',
      allowRecoveryCode: true,
    );
    if (entered == null) return;
    await _guard(
      () => entered.recovery ? _client.disableTwoFactor(recoveryCode: entered.code) : _client.disableTwoFactor(code: entered.code),
      success: 'Two-factor authentication is off',
    );
  }

  Future<void> _openApp(AltPlatform target) async {
    try {
      final opened = await widget.handoff.open(target);
      if (!opened) _toast('${target.label} is not installed on this device.');
    } on AltApiException catch (e) {
      _toast(e.message);
    }
  }

  Future<void> _signOutEverywhere() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sign out everywhere?'),
        content: const Text('This signs you out of ALTER, ALTAR and ALTERA on every device, including this one.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Sign out everywhere')),
        ],
      ),
    );
    if (ok != true) return;
    await _guard(_client.signOutEverywhere);
    widget.onSignedOut?.call();
  }

  // ------------------------------------------------------------------ UI

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('ALT Account')),
      body: ValueListenableBuilder<AltUser?>(
        valueListenable: _client.currentUser,
        builder: (context, user, _) {
          if (user == null) return const Center(child: CircularProgressIndicator());
          final scheme = Theme.of(context).colorScheme;
          return AbsorbPointer(
            absorbing: _busy,
            child: RefreshIndicator(
              onRefresh: _reload,
              child: ListView(
                padding: const EdgeInsets.symmetric(vertical: 8),
                children: [
                  ListTile(
                    leading: CircleAvatar(
                      radius: 28,
                      backgroundImage: user.avatarUrl != null ? NetworkImage(user.avatarUrl!) : null,
                      child: user.avatarUrl == null ? Text(user.displayName.characters.first.toUpperCase()) : null,
                    ),
                    title: Text(user.displayName, style: Theme.of(context).textTheme.titleMedium),
                    subtitle: Text('@${user.handle}${user.email != null ? '\n${user.email}' : ''}'),
                    isThreeLine: user.email != null,
                    trailing: IconButton(icon: const Icon(Icons.edit_outlined), tooltip: 'Edit profile', onPressed: () => _editProfile(user)),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                    child: Text(
                      'One account for every ALT app. Changes here apply to ALTER, ALTAR and ALTERA.',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                  const _Section('Your ALT apps'),
                  for (final app in [AltPlatform.alter, AltPlatform.altera, AltPlatform.altar])
                    ListTile(
                      leading: Icon(_appIcon(app), color: scheme.primary),
                      title: Text(app.label),
                      subtitle: Text(app == _client.platform ? 'You are here' : app.tagline),
                      trailing: app == _client.platform
                          ? const Icon(Icons.check_circle_outline)
                          : TextButton(onPressed: () => _openApp(app), child: const Text('Open')),
                    ),
                  const _Section('Security'),
                  ListTile(
                    leading: const Icon(Icons.password_outlined),
                    title: Text(user.hasPassword ? 'Change password' : 'Set a password'),
                    onTap: () => _changePassword(user),
                  ),
                  SwitchListTile(
                    secondary: const Icon(Icons.verified_user_outlined),
                    title: const Text('Two-factor authentication'),
                    subtitle: Text(user.twoFactorEnabled ? 'On: a code from your authenticator app is needed to sign in' : 'Off'),
                    value: user.twoFactorEnabled,
                    onChanged: (on) => on ? _enableTwoFactor() : _disableTwoFactor(),
                  ),
                  const _Section('Signed-in devices'),
                  if (_sessions == null)
                    const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()))
                  else
                    for (final s in _sessions!)
                      ListTile(
                        leading: Icon(_appIcon(s.platform)),
                        title: Text('${s.platform.label} · ${s.deviceName ?? 'Unknown device'}'),
                        subtitle: Text(s.current ? 'This device' : 'Last active ${_ago(s.lastUsedAt)}'),
                        trailing: s.current
                            ? null
                            : IconButton(
                                icon: const Icon(Icons.logout),
                                tooltip: 'Sign out this device',
                                onPressed: () => _guard(() async {
                                  await _client.revokeSession(s.id);
                                  await _reload();
                                }, success: 'Device signed out'),
                              ),
                      ),
                  const _Section('Wallets'),
                  for (final w in user.wallets)
                    ListTile(
                      leading: Icon(w.isCustodial ? Icons.account_balance_wallet_outlined : Icons.link),
                      title: Text(w.isCustodial ? 'ALT wallet (managed for you)' : (w.label ?? 'Linked wallet')),
                      subtitle: Text('${w.short}${w.isPrimary ? ' · primary' : ''}'),
                      trailing: IconButton(
                        icon: const Icon(Icons.copy, size: 18),
                        tooltip: 'Copy address',
                        onPressed: () {
                          Clipboard.setData(ClipboardData(text: w.address));
                          _toast('Address copied');
                        },
                      ),
                    ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                    child: Text(
                      'Your AI identity tokens are held by your primary wallet. Link MetaMask from ALTAR on the web.',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                  const Divider(),
                  ListTile(
                    leading: const Icon(Icons.logout),
                    title: const Text('Sign out'),
                    onTap: () => _guard(() async {
                      await _client.signOut();
                      widget.onSignedOut?.call();
                    }),
                  ),
                  ListTile(
                    leading: Icon(Icons.phonelink_erase, color: scheme.error),
                    title: Text('Sign out everywhere', style: TextStyle(color: scheme.error)),
                    onTap: _signOutEverywhere,
                  ),
                  const SizedBox(height: 24),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  static IconData _appIcon(AltPlatform p) => switch (p) {
        AltPlatform.alter => Icons.psychology_alt_outlined,
        AltPlatform.altera => Icons.forum_outlined,
        AltPlatform.altar => Icons.storefront_outlined,
        AltPlatform.admin => Icons.admin_panel_settings_outlined,
      };

  static String _ago(DateTime t) {
    final d = DateTime.now().difference(t);
    if (d.inMinutes < 1) return 'just now';
    if (d.inHours < 1) return '${d.inMinutes} min ago';
    if (d.inDays < 1) return '${d.inHours} h ago';
    return '${d.inDays} d ago';
  }
}

class _Section extends StatelessWidget {
  const _Section(this.title);
  final String title;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 20, 16, 4),
        child: Text(title.toUpperCase(),
            style: Theme.of(context).textTheme.labelMedium?.copyWith(color: Theme.of(context).colorScheme.primary, letterSpacing: 0.8)),
      );
}
