import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'client.dart';
import 'errors.dart';

/// One of ALT's policies (Terms of use, Privacy policy, AI content policy) as it stands for a person.
class AltPolicy {
  AltPolicy({required this.slug, required this.version, required this.title, required this.summary, required this.accepted, this.acceptedVersion});

  factory AltPolicy.fromJson(Map<String, dynamic> j) => AltPolicy(
        slug: j['slug'] as String,
        version: (j['version'] as num).toInt(),
        title: j['title'] as String,
        summary: j['summary'] as String,
        accepted: j['accepted'] as bool? ?? false,
        acceptedVersion: (j['acceptedVersion'] as num?)?.toInt(),
      );

  final String slug;
  final int version;
  final String title;
  final String summary;
  final bool accepted;

  /// The version they agreed to before, if any (so "updated" can be told apart from "new").
  final int? acceptedVersion;
}

/// ALT's policies through ALT Core (`/me/policies`). Every version is public at `<ALT>/legal/<slug>`.
class AltPolicies {
  AltPolicies(this.client);

  final AltAccountClient client;

  Uri pageFor(String slug) => Uri.parse('${client.apiUrl}/legal/$slug');

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

  /// The current policies this person hasn't agreed to yet.
  Future<List<AltPolicy>> pending() async {
    final body = await _json('GET', '/me/policies');
    return [for (final p in body['pending'] as List) AltPolicy.fromJson(Map<String, dynamic>.from(p as Map))];
  }

  /// Agrees to these versions; returns what is still pending.
  Future<List<AltPolicy>> accept(List<AltPolicy> policies) async {
    var left = <AltPolicy>[];
    for (final p in policies) {
      final body = await _json('POST', '/me/policies/accept', {'slug': p.slug, 'version': p.version});
      left = [for (final x in body['pending'] as List) AltPolicy.fromJson(Map<String, dynamic>.from(x as Map))];
    }
    return left;
  }
}
