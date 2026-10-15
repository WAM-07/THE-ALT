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

  /// [kind]: support, report, dispute or appeal. [subject] e.g. `{'type': 'ai', 'id': aiId}`.
  Future<AltCase> open({required String kind, required String category, required String title, required String body, Map<String, String>? subject}) async {
    final res = await _json('POST', '/me/cases', {
      'kind': kind,
      'category': category,
      'title': title,
      'body': body,
      if (subject != null) 'subject': subject,
    });
    return AltCase.fromJson(Map<String, dynamic>.from(res['case'] as Map));
  }

  Future<void> reply(String id, String body) => _json('POST', '/me/cases/$id/messages', {'body': body});
}
