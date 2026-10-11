import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:timeago/timeago.dart' as timeago;
import '../../theme/app_theme.dart';
import '../../providers/feed_provider.dart';
import '../../services/feed_service.dart';

class ModerationScreen extends ConsumerStatefulWidget {
  const ModerationScreen({super.key});

  @override
  ConsumerState<ModerationScreen> createState() => _ModerationScreenState();
}

class _ModerationScreenState extends ConsumerState<ModerationScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tab;
  bool _loading = true;
  Map<String, dynamic>? _compliance;
  List<FlaggedPost> _flagged = [];
  Set<String> _resolving = {};

  @override
  void initState() {
    super.initState();
    _tab = TabController(length: 3, vsync: this);
    _load();
  }

  @override
  void dispose() {
    _tab.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final svc = ref.read(feedServiceProvider);
    final results = await Future.wait([
      svc.getComplianceData(),
      svc.getFlaggedPosts(),
    ]);
    if (mounted) {
      setState(() {
        _compliance = results[0] as Map<String, dynamic>?;
        _flagged = results[1] as List<FlaggedPost>;
        _loading = false;
      });
    }
  }

  Future<void> _resolveAnomaly(String id) async {
    setState(() => _resolving.add(id));
    final ok = await ref.read(feedServiceProvider).resolveAnomaly(id);
    if (ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Anomaly flag marked as resolved'),
          backgroundColor: AppColors.success,
          behavior: SnackBarBehavior.floating,
        ),
      );
      _load();
    }
    setState(() => _resolving.remove(id));
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        backgroundColor: Theme.of(context).appBarTheme.backgroundColor,
        elevation: 0,
        title: const Text(
          'Moderation & Compliance',
          style: TextStyle(fontWeight: FontWeight.w700, fontSize: 17),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _load,
            tooltip: 'Refresh',
          ),
        ],
        bottom: TabBar(
          controller: _tab,
          labelColor: isDark ? AppColors.textDark : AppColors.primary,
          unselectedLabelColor:
              isDark ? AppColors.textSecondaryDark : AppColors.textSecondary,
          indicatorColor: AppColors.primary,
          tabs: const [
            Tab(text: 'Overview'),
            Tab(text: 'Flagged'),
            Tab(text: 'Activity'),
          ],
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.primary))
          : TabBarView(
              controller: _tab,
              children: [
                _buildOverview(),
                _buildFlagged(),
                _buildActivity(),
              ],
            ),
    );
  }

  // ─── Overview Tab ─────────────────────────────────────────────────────────
  Widget _buildOverview() {
    final comp = _compliance?['compliance'] as Map<String, dynamic>? ?? {};
    final anomalies = (_compliance?['anomalies'] as List? ?? []);
    final score = (comp['content_health_score'] as num?)?.toInt() ?? 100;
    final status = comp['status'] as String? ?? 'healthy';
    final Color statusColor = status == 'healthy'
        ? AppColors.success
        : status == 'caution'
            ? AppColors.warning
            : AppColors.error;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Health Score Card
        _GlassCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(Icons.shield_outlined, color: statusColor, size: 20),
                  const SizedBox(width: 8),
                  const Text(
                    'Content Health Score',
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                  ),
                  const Spacer(),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: statusColor.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: statusColor.withOpacity(0.3)),
                    ),
                    child: Text(
                      status.toUpperCase(),
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        color: statusColor,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              Center(
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    SizedBox(
                      width: 120,
                      height: 120,
                      child: CircularProgressIndicator(
                        value: score / 100,
                        strokeWidth: 10,
                        backgroundColor:
                            Theme.of(context).dividerColor.withOpacity(0.2),
                        color: statusColor,
                      ),
                    ),
                    Column(
                      children: [
                        Text(
                          '$score',
                          style: TextStyle(
                            fontSize: 36,
                            fontWeight: FontWeight.w900,
                            color: statusColor,
                          ),
                        ),
                        const Text(
                          'out of 100',
                          style: TextStyle(
                              fontSize: 11, color: AppColors.textSecondary),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  _StatPill(
                    label: 'Flagged',
                    value: '${comp['flagged_posts'] ?? 0}',
                    color: AppColors.error,
                    icon: Icons.flag_outlined,
                  ),
                  const SizedBox(width: 8),
                  _StatPill(
                    label: 'Reported',
                    value: '${comp['reported_posts'] ?? 0}',
                    color: AppColors.warning,
                    icon: Icons.report_outlined,
                  ),
                  const SizedBox(width: 8),
                  _StatPill(
                    label: 'Anomalies',
                    value: '${comp['anomaly_flags'] ?? 0}',
                    color: Colors.purple,
                    icon: Icons.warning_amber_outlined,
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Policy Info
        _GlassCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Row(
                children: [
                  Icon(Icons.policy_outlined,
                      size: 18, color: AppColors.primary),
                  SizedBox(width: 8),
                  Text('Content Policy Guidelines',
                      style:
                          TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
                ],
              ),
              const SizedBox(height: 12),
              _PolicyLine(
                  icon: Icons.check_circle_outline,
                  text: 'No hate speech, threats, or harmful content',
                  ok: true),
              _PolicyLine(
                  icon: Icons.check_circle_outline,
                  text: 'No spam or repetitive AI posting patterns',
                  ok: true),
              _PolicyLine(
                  icon: Icons.check_circle_outline,
                  text: 'AI posts must meet minimum content quality',
                  ok: true),
              _PolicyLine(
                  icon: Icons.check_circle_outline,
                  text: 'Daily rate limits enforced for AI personas',
                  ok: true),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Anomaly List (non-resolved)
        if (anomalies.isNotEmpty) ...[
          const Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: Text(
              'Active Anomaly Flags',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
            ),
          ),
          ...anomalies
              .where((a) => !(a['resolved'] as bool? ?? false))
              .map((a) => _AnomalyCard(
                    anomaly: a,
                    isResolving: _resolving.contains(a['id']),
                    onResolve: () => _resolveAnomaly(a['id']),
                  )),
        ],
      ],
    );
  }

  // ─── Flagged Posts Tab ────────────────────────────────────────────────────
  Widget _buildFlagged() {
    if (_flagged.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.verified_outlined,
                size: 64, color: AppColors.success.withOpacity(0.6)),
            const SizedBox(height: 16),
            const Text('No flagged content',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            const Text('All your content looks clean!',
                style: TextStyle(color: AppColors.textSecondary)),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _flagged.length,
      itemBuilder: (ctx, i) {
        final post = _flagged[i];
        return _FlaggedPostCard(post: post);
      },
    );
  }

  // ─── Activity Tab ─────────────────────────────────────────────────────────
  Widget _buildActivity() {
    final activity =
        (_compliance?['recent_activity'] as List? ?? []);

    if (activity.isEmpty) {
      return const Center(
        child: Text('No moderation activity yet',
            style: TextStyle(color: AppColors.textSecondary)),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: activity.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (ctx, i) {
        final item = activity[i] as Map<String, dynamic>;
        final action = item['action'] as String? ?? '';
        final ai = item['ai_username'] as String?;
        final ts = item['timestamp'] as String?;
        final parsed = ts != null ? DateTime.tryParse(ts) : null;

        IconData icon;
        Color color;
        String label;
        switch (action) {
          case 'post_approved':
            icon = Icons.check_circle_outline;
            color = AppColors.success;
            label = 'Post approved';
            break;
          case 'post_rejected':
            icon = Icons.cancel_outlined;
            color = AppColors.error;
            label = 'Post rejected';
            break;
          case 'post_reported':
            icon = Icons.report_outlined;
            color = AppColors.warning;
            label = 'Post reported';
            break;
          default:
            icon = Icons.article_outlined;
            color = AppColors.primary;
            label = 'Post created';
        }

        return ListTile(
          contentPadding: EdgeInsets.zero,
          leading: CircleAvatar(
            backgroundColor: color.withOpacity(0.1),
            child: Icon(icon, size: 18, color: color),
          ),
          title: Text(
            label,
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
          ),
          subtitle: Text(
            ai != null ? '@$ai' : 'Your account',
            style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
          ),
          trailing: parsed != null
              ? Text(
                  timeago.format(parsed),
                  style: const TextStyle(
                      fontSize: 11, color: AppColors.textTertiary),
                )
              : null,
        );
      },
    );
  }
}

// ─── Supporting Widgets ───────────────────────────────────────────────────────

class _GlassCard extends StatelessWidget {
  final Widget child;
  const _GlassCard({required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Theme.of(context).dividerColor),
      ),
      child: child,
    );
  }
}

class _StatPill extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  final IconData icon;

  const _StatPill({
    required this.label,
    required this.value,
    required this.color,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
        decoration: BoxDecoration(
          color: color.withOpacity(0.08),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: color.withOpacity(0.2)),
        ),
        child: Column(
          children: [
            Icon(icon, size: 16, color: color),
            const SizedBox(height: 4),
            Text(value,
                style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                    color: color)),
            Text(label,
                style: const TextStyle(
                    fontSize: 10, color: AppColors.textSecondary)),
          ],
        ),
      ),
    );
  }
}

class _PolicyLine extends StatelessWidget {
  final IconData icon;
  final String text;
  final bool ok;

  const _PolicyLine({required this.icon, required this.text, required this.ok});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Icon(icon, size: 16, color: ok ? AppColors.success : AppColors.error),
          const SizedBox(width: 8),
          Expanded(
              child: Text(text,
                  style: const TextStyle(
                      fontSize: 12, color: AppColors.textSecondary))),
        ],
      ),
    );
  }
}

class _AnomalyCard extends StatelessWidget {
  final Map<String, dynamic> anomaly;
  final bool isResolving;
  final VoidCallback onResolve;

  const _AnomalyCard({
    required this.anomaly,
    required this.isResolving,
    required this.onResolve,
  });

  Color _severityColor(String? s) {
    if (s == 'high') return AppColors.error;
    if (s == 'medium') return AppColors.warning;
    return Colors.blue;
  }

  @override
  Widget build(BuildContext context) {
    final severity = anomaly['severity'] as String? ?? 'medium';
    final color = _severityColor(severity);
    final ai = anomaly['ai_display_name'] as String? ?? 'AI Persona';
    final type = anomaly['flag_type'] as String? ?? 'unknown';
    final desc = anomaly['description'] as String? ?? '';
    final ts = anomaly['created_at'] as String?;
    final parsed = ts != null ? DateTime.tryParse(ts) : null;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withOpacity(0.05),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.warning_amber_rounded, size: 16, color: color),
              const SizedBox(width: 6),
              Text(
                type.replaceAll('_', ' ').toUpperCase(),
                style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: color,
                    letterSpacing: 0.5),
              ),
              const Spacer(),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: color.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  severity,
                  style: TextStyle(
                      fontSize: 10, fontWeight: FontWeight.bold, color: color),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            ai,
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
          ),
          if (desc.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(desc,
                style: const TextStyle(
                    fontSize: 12, color: AppColors.textSecondary)),
          ],
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              if (parsed != null)
                Text(
                  timeago.format(parsed),
                  style: const TextStyle(
                      fontSize: 11, color: AppColors.textTertiary),
                ),
              TextButton.icon(
                onPressed: isResolving ? null : onResolve,
                icon: isResolving
                    ? const SizedBox(
                        width: 12,
                        height: 12,
                        child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.check_rounded, size: 14),
                label: const Text('Resolve', style: TextStyle(fontSize: 12)),
                style: TextButton.styleFrom(
                  foregroundColor: AppColors.success,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  minimumSize: Size.zero,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _FlaggedPostCard extends StatelessWidget {
  final FlaggedPost post;
  const _FlaggedPostCard({required this.post});

  @override
  Widget build(BuildContext context) {
    final isAI = post.authorType == 'ai';
    final hasReport = post.reportReason != null;
    final color = hasReport ? AppColors.warning : AppColors.error;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 14,
                backgroundColor: isAI
                    ? AppColors.badgeAI.withOpacity(0.15)
                    : AppColors.primary.withOpacity(0.1),
                child: Text(
                  isAI ? 'AI' : post.authorDisplayName[0].toUpperCase(),
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: isAI ? AppColors.badgeAI : AppColors.primary,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text('@${post.authorUsername}',
                  style: const TextStyle(
                      fontSize: 13, fontWeight: FontWeight.w600)),
              const Spacer(),
              if (post.isFlagged)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: AppColors.error.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Text('FLAGGED',
                      style: TextStyle(
                          fontSize: 9,
                          fontWeight: FontWeight.bold,
                          color: AppColors.error)),
                ),
              if (hasReport) ...[
                const SizedBox(width: 4),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: AppColors.warning.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Text('REPORTED',
                      style: TextStyle(
                          fontSize: 9,
                          fontWeight: FontWeight.bold,
                          color: AppColors.warning)),
                ),
              ],
            ],
          ),
          const SizedBox(height: 10),
          Text(
            post.content,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 13),
          ),
          const SizedBox(height: 8),
          if (post.flagReason != null)
            Text(
              '⚠ ${post.flagReason}',
              style: const TextStyle(
                  fontSize: 11,
                  color: AppColors.error,
                  fontStyle: FontStyle.italic),
            ),
          if (post.reportReason != null)
            Text(
              '📢 Reported: ${post.reportReason}',
              style: const TextStyle(
                  fontSize: 11, color: AppColors.warning),
            ),
          const SizedBox(height: 4),
          Text(
            timeago.format(post.createdAt),
            style: const TextStyle(
                fontSize: 11, color: AppColors.textTertiary),
          ),
        ],
      ),
    );
  }
}
