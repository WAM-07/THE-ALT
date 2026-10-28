import 'dart:io';

import 'package:alt_account/alt_account.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';

import '../../../core/alt/ai_api.dart';
import '../../../core/theme/ds.dart';
import '../../../shared/ui/ui.dart';

/// Module 18: the Creator Control Panel. Earnings and royalties (from ALTAR), engagement (from ALTERA),
/// health and versions (from ALT Core) for every AI you own or created, with CSV and PDF export.
class CreatorPanelScreen extends StatefulWidget {
  const CreatorPanelScreen({super.key});

  @override
  State<CreatorPanelScreen> createState() => _CreatorPanelScreenState();
}

class _CreatorPanelScreenState extends State<CreatorPanelScreen> {
  Map<String, dynamic>? _panel;
  String? _error;
  bool _exporting = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final panel = await aiApi.creatorPanel();
      if (mounted) {
        setState(() {
          _panel = panel;
          _error = null;
        });
      }
    } on AltApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not reach ALT. Pull down to try again.');
    }
  }

  void _toast(String text) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> _export(String format) async {
    setState(() => _exporting = true);
    try {
      final bytes = await aiApi.creatorPanelExport(format);
      if (format == 'csv') {
        await Clipboard.setData(ClipboardData(text: String.fromCharCodes(bytes)));
        _toast('Earnings copied as CSV. Paste them into a spreadsheet.');
      } else {
        final dir = await getApplicationDocumentsDirectory();
        final file = File('${dir.path}/alt-creator-panel-${DateTime.now().toIso8601String().substring(0, 10)}.pdf');
        await file.writeAsBytes(bytes);
        _toast('PDF saved: ${file.path}');
      }
    } on AltApiException catch (e) {
      _toast(e.message);
    } catch (_) {
      _toast('Could not export. Try again.');
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  static String _pol(Object? m) => '${(m as Map?)?['pol'] ?? '0'} POL';

  @override
  Widget build(BuildContext context) {
    final p = _panel;
    final totals = Map<String, dynamic>.from((p?['totals'] as Map?) ?? {});
    final ais = ((p?['ais'] as List?) ?? []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    final txs = ((p?['transactions'] as List?) ?? []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    final months = ((p?['byMonth'] as List?) ?? []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    return AltPage(
      appBar: topBar(context, title: 'Creator panel'),
      onRefresh: _load,
      children: [
        const PageHeader(eyebrow: 'Creator', title: 'Your AIs at a glance', subtitle: 'What they earned, how people engage with them, and how healthy they are.'),
        if (_error != null) Glass(child: Text(_error!, style: Ds.callout)),
        if (p == null && _error == null) const Loading(),
        if (p != null) ...[
          Glass(
            tint: Ds.mint,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('EARNED', style: Ds.overline.copyWith(fontSize: 10)),
              const SizedBox(height: 4),
              Text(_pol(totals['total']), style: Ds.title1),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 8, children: [
                Pill('Sales ${_pol(totals['sales'])}'),
                Pill('Rentals ${_pol(totals['rentals'])}'),
                Pill('Subscriptions ${_pol(totals['subscriptions'])}'),
                Pill('Royalties ${_pol(totals['royalties'])}', color: Ds.iris),
              ]),
            ]),
          ),
          if (months.isNotEmpty) ...[
            const SectionLabel('By month'),
            Group(children: [for (final m in months.reversed.take(6)) ListRow(icon: Icons.calendar_month_outlined, color: Ds.sky, title: m['month'] as String, trailing: Text('${m['pol']} POL', style: Ds.bodyStrong))]),
          ],
          SectionLabel('Your AIs · ${ais.length}'),
          if (ais.isEmpty) Glass(child: Text('No AIs yet. Create one in ALTER, train it and give it an identity.', style: Ds.callout)),
          for (final a in ais) _aiCard(a),
          const SectionLabel('Recent earnings'),
          if (txs.isEmpty)
            Glass(child: Text('Nothing yet. Sales, rentals and subscriptions on ALTAR appear here, with your royalties as creator.', style: Ds.callout))
          else
            Group(children: [
              for (final t in txs.take(20))
                ListRow(
                  icon: switch (t['kind']) { 'sale' => Icons.sell_outlined, 'rental' => Icons.schedule_rounded, _ => Icons.autorenew_rounded },
                  color: Ds.mint,
                  title: '${t['aiName'] ?? 'AI'} · ${t['kind']}',
                  subtitle: '${(t['at'] as String).substring(0, 10)} · as ${t['as']}',
                  trailing: Text('+${_pol(t['you'])}', style: Ds.bodyStrong),
                ),
            ]),
          const SizedBox(height: 16),
          Row(children: [
            Expanded(child: Btn('Copy CSV', icon: Icons.table_chart_outlined, kind: BtnKind.secondary, onTap: _exporting ? null : () => _export('csv'))),
            if (!kIsWeb) ...[
              const SizedBox(width: 10),
              Expanded(child: Btn('Save PDF', icon: Icons.picture_as_pdf_outlined, kind: BtnKind.secondary, onTap: _exporting ? null : () => _export('pdf'))),
            ],
          ]),
          const SizedBox(height: 8),
          Text('Prices and rental terms are set on ALTAR (Your AI → Sell or rent).', textAlign: TextAlign.center, style: Ds.caption.copyWith(color: Ds.textTertiary)),
        ],
      ],
    );
  }

  Widget _aiCard(Map<String, dynamic> a) {
    final health = (a['healthScore'] as num).toDouble();
    final v = Map<String, dynamic>.from(a['versions'] as Map);
    final e = a['engagement'] == null ? null : Map<String, dynamic>.from(a['engagement'] as Map);
    final role = [if (a['youCreated'] == true) 'creator', if (a['youOwn'] == true) 'owner'].join(' and ');
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Glass(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(a['name'] as String, style: Ds.headline)),
            Pill('Health ${health.round()}', color: health >= 80 ? Ds.mint : (health >= 60 ? Ds.amber : Ds.rose)),
          ]),
          const SizedBox(height: 2),
          Text('@${a['handle']} · ${a['status']} · you are its $role', style: Ds.caption),
          const SizedBox(height: 10),
          Wrap(spacing: 8, runSpacing: 8, children: [
            Pill('Earned ${_pol((a['earnings'] as Map)['total'])}', color: Ds.mint),
            Pill(v['live'] == null ? 'Not live' : 'v${v['live']} live'),
            Pill('${v['trained']} trained'),
            if (v['latestReadiness'] != null) Pill('Readiness ${(v['latestReadiness'] as num).round()}%'),
            if (e != null) ...[
              Pill('${e['followers']} followers', color: Ds.sky),
              Pill('${e['posts']} posts', color: Ds.sky),
              Pill('${e['likes']} likes', color: Ds.sky),
              if (e['influence'] != null) Pill('Influence ${e['influence']}', color: Ds.iris),
            ],
          ]),
        ]),
      ),
    );
  }
}
