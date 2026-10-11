import 'dart:async';

import 'package:flutter/material.dart';

import '../errors.dart';
import '../inbox.dart';

/// The ALT inbox: one list of notifications shared by ALTER, ALTAR and ALTERA.
class AltInboxScreen extends StatefulWidget {
  const AltInboxScreen({super.key, required this.inbox, this.onOpen});

  final AltInbox inbox;

  /// Called when a notification with a link is tapped (each app decides how to open it).
  final void Function(AltNotification notification)? onOpen;

  @override
  State<AltInboxScreen> createState() => _AltInboxScreenState();
}

class _AltInboxScreenState extends State<AltInboxScreen> {
  List<AltNotification>? _items;
  String? _error;
  bool _loadingMore = false;
  bool _end = false;
  StreamSubscription<AltNotification>? _live;

  @override
  void initState() {
    super.initState();
    _load();
    _live = widget.inbox.incoming.listen((n) {
      if (mounted) setState(() => _items = [n, ...?_items]);
    });
  }

  @override
  void dispose() {
    _live?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final items = await widget.inbox.list();
      if (!mounted) return;
      setState(() {
        _items = items;
        _error = null;
        _end = items.length < 30;
      });
    } on AltApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _more() async {
    if (_loadingMore || _end || _items == null || _items!.isEmpty) return;
    setState(() => _loadingMore = true);
    try {
      final older = await widget.inbox.list(before: _items!.last.createdAt);
      if (!mounted) return;
      setState(() {
        _items = [..._items!, ...older];
        _end = older.length < 30;
      });
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  Future<void> _tap(AltNotification n) async {
    if (!n.read) {
      try {
        await widget.inbox.markRead(n.id);
      } catch (_) {}
      if (!mounted) return;
      setState(() => _items = _items!.map((x) => x.id == n.id ? x.markedRead() : x).toList());
    }
    widget.onOpen?.call(n);
  }

  static IconData _icon(String category) => switch (category) {
        'security' => Icons.shield_outlined,
        'ai' => Icons.psychology_alt_outlined,
        'transaction' => Icons.token_outlined,
        'moderation' => Icons.report_gmailerrorred_outlined,
        'social' => Icons.people_outline,
        _ => Icons.campaign_outlined,
      };

  static String _ago(DateTime t) {
    final d = DateTime.now().difference(t);
    if (d.inMinutes < 1) return 'now';
    if (d.inHours < 1) return '${d.inMinutes}m';
    if (d.inDays < 1) return '${d.inHours}h';
    return '${d.inDays}d';
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: const Text('ALT inbox'),
        actions: [
          TextButton(
            onPressed: () async {
              await widget.inbox.markAllRead();
              setState(() => _items = _items?.map((x) => x.markedRead()).toList());
            },
            child: const Text('Mark all read'),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _items == null
            ? ListView(children: [
                Padding(
                  padding: const EdgeInsets.all(32),
                  child: Center(child: _error != null ? Text(_error!) : const CircularProgressIndicator()),
                ),
              ])
            : _items!.isEmpty
                ? ListView(children: const [
                    Padding(padding: EdgeInsets.all(48), child: Center(child: Text('Nothing here yet.\nSecurity alerts and news about your AI appear here.', textAlign: TextAlign.center))),
                  ])
                : NotificationListener<ScrollNotification>(
                    onNotification: (s) {
                      if (s.metrics.pixels > s.metrics.maxScrollExtent - 200) _more();
                      return false;
                    },
                    child: ListView.separated(
                      itemCount: _items!.length + (_loadingMore ? 1 : 0),
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (context, i) {
                        if (i == _items!.length) return const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()));
                        final n = _items![i];
                        return ListTile(
                          onTap: () => _tap(n),
                          leading: CircleAvatar(
                            backgroundColor: (n.category == 'security' || n.category == 'moderation' ? scheme.errorContainer : scheme.primaryContainer),
                            child: Icon(_icon(n.category), size: 20),
                          ),
                          title: Text(n.title, style: TextStyle(fontWeight: n.read ? FontWeight.normal : FontWeight.w700)),
                          subtitle: Text([if (n.body != null) n.body!, '${n.platform.toUpperCase()} · ${_ago(n.createdAt)}'].join('\n')),
                          isThreeLine: n.body != null,
                          trailing: n.read ? null : Icon(Icons.circle, size: 10, color: scheme.primary),
                        );
                      },
                    ),
                  ),
      ),
    );
  }
}

/// A bell with the unread count, for app bars.
class AltInboxButton extends StatelessWidget {
  const AltInboxButton({super.key, required this.inbox, required this.onPressed, this.color});

  final AltInbox inbox;
  final VoidCallback onPressed;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<int>(
      valueListenable: inbox.unread,
      builder: (context, n, _) => IconButton(
        tooltip: 'ALT inbox',
        onPressed: onPressed,
        icon: Badge(
          isLabelVisible: n > 0,
          label: Text(n > 99 ? '99+' : '$n'),
          child: Icon(Icons.notifications_outlined, color: color),
        ),
      ),
    );
  }
}
