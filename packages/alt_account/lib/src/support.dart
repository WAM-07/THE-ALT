import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'client.dart';
import 'errors.dart';

/// A request to ALT staff or a report a person made: a case in ALT's queue, handled in the ALT
/// Command Centre. The same cases show in every ALT app and on ALTAR.
class AltCase {
  AltCase({
    required this.id,
    required this.number,
    required this.kind,
    required this.status,
    required this.category,
    required this.title,
    required this.platform,
    required this.updatedAt,
    this.resolution,
  });

  factory AltCase.fromJson(Map<String, dynamic> j) => AltCase(
        id: j['id'] as String,
        number: (j['number'] as num).toInt(),
        kind: j['kind'] as String,
        status: j['status'] as String,
        category: j['category'] as String,
        title: j['title'] as String,
        platform: j['platform'] as String,
        updatedAt: DateTime.parse(j['updatedAt'] as String),
        resolution: j['resolution'] as String?,
      );

  final String id;
  final int number;
  final String kind;
  final String status;
  final String category;
  final String title;
  final String platform;
  final DateTime updatedAt;
  final String? resolution;

  /// "#0042"
  String get label => '#${number.toString().padLeft(4, '0')}';
  bool get closed => status == 'resolved' || status == 'dismissed';
  bool get waitingForYou => status == 'waiting';

  String get statusLabel => switch (status) {
        'open' => 'Received',
        'in_progress' => 'Being looked at',
        'waiting' => 'Waiting for you',
        'resolved' => 'Resolved',
        'dismissed' => 'Closed',
        _ => status,
      };

  String get kindLabel => switch (kind) {
        'support' => 'Request',
        'report' => 'Report',
        'dispute' => 'Dispute',
        'appeal' => 'Appeal',
        _ => kind,
      };
}

/// One line of a case as its person sees it: their own words, or ALT's (never a staff name).
class AltCaseMessage {
  AltCaseMessage({required this.id, required this.at, required this.fromYou, required this.kind, this.body});

  factory AltCaseMessage.fromJson(Map<String, dynamic> j) => AltCaseMessage(
        id: j['id'] as String,
        at: DateTime.parse(j['at'] as String),
        fromYou: j['from'] == 'you',
        kind: j['kind'] as String,
        body: j['body'] as String?,
      );

  final String id;
  final DateTime at;
  final bool fromYou;
  final String kind;
  final String? body;
}

/// A staff decision about the person, their AI or their content: something they can appeal.
class AltDecision {
  AltDecision({required this.caseNumber, required this.label, required this.reason, required this.at, required this.appealed});

  factory AltDecision.fromJson(Map<String, dynamic> j) => AltDecision(
        caseNumber: (j['caseNumber'] as num).toInt(),
        label: j['label'] as String,
        reason: j['reason'] as String? ?? '',
        at: DateTime.parse(j['at'] as String),
        appealed: j['appealed'] as bool? ?? false,
      );

  final int caseNumber;
  final String label;
  final String reason;
  final DateTime at;
  final bool appealed;
}

/// One of the person's ALTAR payments, for a dispute.
class AltPayment {
  AltPayment({required this.txHash, required this.summary, required this.at});

  factory AltPayment.fromJson(Map<String, dynamic> j) {
    const role = {
      'bought': 'You bought',
      'rented': 'You rented',
      'subscribed': 'You subscribed to',
      'sold': 'You sold',
      'rented_out': 'You rented out',
      'subscribed_out': 'Subscription to',
      'royalty': 'Royalty from',
    };
    final ai = (j['ai'] as Map?)?['name'] ?? 'an AI';
    final pol = (j['amount'] as Map?)?['pol'] ?? '?';
    return AltPayment(txHash: j['txHash'] as String, summary: '${role[j['role']] ?? j['role']} $ai · $pol POL', at: DateTime.parse(j['occurredAt'] as String));
  }

  final String txHash;
  final String summary;
  final DateTime at;
}

/// Help & support through ALT Core (`/me/cases`).
class AltSupport {
  AltSupport(this.client);

  final AltAccountClient client;

  Future<Map<String, dynamic>> _json(String method, String path, [Object? body]) async {
    http.Response res;
    try {
      res = await client.authorizedSend(method, Uri.parse('${client.coreUrl}$path'), body: body).timeout(const Duration(seconds: 20));
    } on AltApiException {
      rethrow;
    } catch (e) {
      throw AltApiException.network(e);
    }
    final decoded = res.body.isEmpty ? <String, dynamic>{} : jsonDecode(res.body);
    if (res.statusCode >= 400) throw AltApiException.fromBody(res.statusCode, decoded);
    return Map<String, dynamic>.from(decoded as Map);
  }

  Future<List<AltCase>> mine() async {
    final body = await _json('GET', '/me/cases');
    return [for (final c in body['items'] as List) AltCase.fromJson(Map<String, dynamic>.from(c as Map))];
  }

  Future<(AltCase, List<AltCaseMessage>)> get(String id) async {
    final body = await _json('GET', '/me/cases/$id');
    return (
      AltCase.fromJson(Map<String, dynamic>.from(body['case'] as Map)),
      [for (final e in body['events'] as List) AltCaseMessage.fromJson(Map<String, dynamic>.from(e as Map))],
    );
  }

  /// [kind]: support, report, dispute or appeal. [subject] e.g. `{'type': 'ai', 'id': aiId}`, or a
  /// payment for a dispute (`{'type': 'transaction', 'id': txHash}`); [appealOf]: the decision's case number.
  Future<AltCase> open({required String kind, required String category, required String title, required String body, Map<String, String>? subject, int? appealOf}) async {
    final res = await _json('POST', '/me/cases', {
      'kind': kind,
      'category': category,
      'title': title,
      'body': body,
      if (subject != null) 'subject': subject,
      if (appealOf != null) 'appealOf': appealOf,
    });
    return AltCase.fromJson(Map<String, dynamic>.from(res['case'] as Map));
  }

  Future<void> reply(String id, String body) => _json('POST', '/me/cases/$id/messages', {'body': body});

  /// What ALT staff decided about this person (what they can appeal).
  Future<List<AltDecision>> decisions() async {
    final body = await _json('GET', '/me/decisions');
    return [for (final d in body['items'] as List) AltDecision.fromJson(Map<String, dynamic>.from(d as Map))];
  }

  /// Their ALTAR payments (bought, rented, subscribed, sold...), for a dispute.
  Future<List<AltPayment>> payments() async {
    http.Response res;
    try {
      res = await client.authorizedSend('GET', Uri.parse('${client.apiUrl}/altar/me/activity')).timeout(const Duration(seconds: 20));
    } on AltApiException {
      rethrow;
    } catch (e) {
      throw AltApiException.network(e);
    }
    final decoded = res.body.isEmpty ? <dynamic>[] : jsonDecode(res.body);
    if (res.statusCode >= 400) throw AltApiException.fromBody(res.statusCode, decoded);
    return [for (final p in decoded as List) AltPayment.fromJson(Map<String, dynamic>.from(p as Map))];
  }
}
