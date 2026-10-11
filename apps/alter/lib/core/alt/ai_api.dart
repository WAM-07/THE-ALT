import 'dart:convert';

import 'package:alt_account/alt_account.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import 'alt_session.dart';

// Models for the personal AI as ALT Core describes it.

class AiToken {
  AiToken(this.j);
  final Map<String, dynamic> j;
  String get tokenId => '${j['tokenId']}';
  int get chainId => j['chainId'] as int;
  String get contract => j['contract'] as String;
  String get owner => j['owner'] as String;
  int get onchainVersion => (j['onchainVersion'] as num?)?.toInt() ?? 1;
  String? get explorer => j['explorer'] as String?;
  String get verifyUrl => j['verifyUrl'] as String;
}

class AltAi {
  AltAi(this.j);
  final Map<String, dynamic> j;
  String get id => j['id'] as String;
  String get handle => j['handle'] as String;
  String get name => j['name'] as String;
  String? get description => j['description'] as String?;
  String get status => j['status'] as String;
  bool get verified => j['verified'] == true;
  int? get currentVersion => (j['currentVersion'] as Map?)?['version'] as int?;
  AiToken? get token => j['token'] == null ? null : AiToken(Map<String, dynamic>.from(j['token'] as Map));
  Map<String, dynamic> get persona => Map<String, dynamic>.from(j['persona'] as Map? ?? const {});
  bool get ownerConfirmed => j['ownerConfirmed'] == true;
  Map<String, dynamic>? get latestVersion => j['latestVersion'] == null ? null : Map<String, dynamic>.from(j['latestVersion'] as Map);
  bool consent(String scope) => ((j['consents'] as Map?)?[scope] as Map?)?['granted'] == true;
  int count(String key) => ((j['counts'] as Map?)?[key] as num?)?.toInt() ?? 0;
}

class DatasetEntry {
  DatasetEntry(this.j);
  final Map<String, dynamic> j;
  String get id => j['id'] as String;
  String get kind => j['kind'] as String;
  String get title => j['title'] as String;
  String? get fileName => j['fileName'] as String?;
  int get sizeBytes => (j['sizeBytes'] as num).toInt();
  String get category => j['category'] as String;
  bool get included => j['included'] == true;
  bool get usableAsText => j['usableAsText'] == true;
  DateTime get createdAt => DateTime.parse(j['createdAt'] as String);
}

class ChatMsg {
  ChatMsg(this.j);
  final Map<String, dynamic> j;
  String get role => j['role'] as String;
  String get content => j['content'] as String;
  bool get flagged => j['flagged'] == true;
  bool get mine => role == 'user';
}

class ClearanceCheck {
  ClearanceCheck(this.j);
  final Map<String, dynamic> j;
  String get id => j['id'] as String;
  String get label => j['label'] as String;
  bool get passed => j['passed'] == true;
  String? get detail => j['detail'] as String?;
}

class AiVersionInfo {
  AiVersionInfo(this.j);
  final Map<String, dynamic> j;
  String get id => j['id'] as String;
  int get version => j['version'] as int;
  String get manifestCid => j['manifestCid'] as String;
  String get manifestUrl => j['manifestUrl'] as String;
  bool get published => j['published'] == true;
  bool get current => j['current'] == true;
}

/// What each consent means (the same wording ALT Core records).
const consentScopes = <String, String>{
  'persona_training': 'Use the information and files I add to build my personal AI.',
  'third_party_processing': 'Send my messages and the relevant parts of my data to an external AI provider (Groq) to generate my AI’s replies.',
  'public_deployment': 'When I choose to deploy my AI, it may appear on ALTERA and ALTAR under its own identity token.',
  'interaction_learning': 'My AI may suggest things to remember from our chats; nothing is kept unless I approve it.',
};

/// The personal-AI part of ALT Core's API.
class AiApi {
  const AiApi();

  Future<dynamic> _call(String method, String path, {Object? body}) async {
    final res = await altAccount.authorizedSend(method, Uri.parse('${altAccount.coreUrl}$path'), body: body);
    final decoded = res.body.isEmpty ? null : jsonDecode(res.body);
    if (res.statusCode >= 400) throw AltApiException.fromBody(res.statusCode, decoded);
    return decoded;
  }

  Future<List<AltAi>> myAis() async => (await _call('GET', '/ais') as List).map((e) => AltAi(Map<String, dynamic>.from(e as Map))).toList();

  Future<AltAi> get(String id) async => AltAi(Map<String, dynamic>.from(await _call('GET', '/ais/$id') as Map));

  Future<AltAi> create({
    required String name,
    required String handle,
    required Map<String, dynamic> onboarding,
    required Map<String, bool> consents,
  }) async =>
      AltAi(Map<String, dynamic>.from(await _call('POST', '/ais', body: {
        'name': name,
        'handle': handle,
        'onboarding': onboarding,
        'consents': consents,
      }) as Map));

  Future<AltAi> updatePersona(String id, Map<String, dynamic> persona) async =>
      AltAi(Map<String, dynamic>.from(await _call('PATCH', '/ais/$id', body: {'persona': persona}) as Map));

  Future<void> setConsent(String id, String scope, bool granted) => _call('PUT', '/ais/$id/consents/$scope', body: {'granted': granted});

  // datasets
  Future<List<DatasetEntry>> datasets(String id) async =>
      (await _call('GET', '/ais/$id/datasets') as List).map((e) => DatasetEntry(Map<String, dynamic>.from(e as Map))).toList();

  Future<void> addText(String id, String title, String text, String category) =>
      _call('POST', '/ais/$id/datasets', body: {'title': title, 'text': text, 'category': category});

  Future<void> uploadFile(String id, {required List<int> bytes, required String fileName, required String mimeType, String? title}) async {
    final token = await altAccount.accessToken();
    final req = http.MultipartRequest('POST', Uri.parse('${altAccount.coreUrl}/ais/$id/datasets/upload'))
      ..headers['authorization'] = 'Bearer $token'
      ..fields['title'] = title ?? fileName
      ..files.add(http.MultipartFile.fromBytes('file', bytes, filename: fileName, contentType: MediaType.parse(mimeType)));
    final res = await http.Response.fromStream(await req.send());
    if (res.statusCode >= 400) throw AltApiException.fromBody(res.statusCode, res.body.isEmpty ? null : jsonDecode(res.body));
  }

  Future<String> datasetText(String id, String datasetId) async {
    final res = await altAccount.authorizedSend('GET', Uri.parse('${altAccount.coreUrl}/ais/$id/datasets/$datasetId/content'));
    if (res.statusCode >= 400) throw AltApiException.fromBody(res.statusCode, null);
    return utf8.decode(res.bodyBytes, allowMalformed: true);
  }

  Future<void> setIncluded(String id, String datasetId, bool included) => _call('PATCH', '/ais/$id/datasets/$datasetId', body: {'included': included});
  Future<void> deleteDataset(String id, String datasetId) => _call('DELETE', '/ais/$id/datasets/$datasetId');

  // memories
  Future<List<Map<String, dynamic>>> memories(String id, {String? status}) async =>
      (await _call('GET', '/ais/$id/memories${status != null ? '?status=$status' : ''}') as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  Future<void> addMemory(String id, String content) => _call('POST', '/ais/$id/memories', body: {'content': content});
  Future<void> decideMemory(String id, String memoryId, bool approve) =>
      _call('PATCH', '/ais/$id/memories/$memoryId', body: {'status': approve ? 'approved' : 'discarded'});

  // chat
  Future<String> latestOrNewSession(String id) async {
    final sessions = await _call('GET', '/ais/$id/chat/sessions') as List;
    if (sessions.isNotEmpty) return (sessions.first as Map)['id'] as String;
    return ((await _call('POST', '/ais/$id/chat/sessions', body: <String, dynamic>{})) as Map)['id'] as String;
  }

  Future<List<ChatMsg>> messages(String id, String sessionId) async =>
      (await _call('GET', '/ais/$id/chat/sessions/$sessionId/messages') as List).map((e) => ChatMsg(Map<String, dynamic>.from(e as Map))).toList();

  /// Returns (my message, the AI's reply, a suggested memory or null).
  Future<(ChatMsg, ChatMsg, Map<String, dynamic>?)> send(String id, String sessionId, String content, {bool current = false}) async {
    final body = Map<String, dynamic>.from(await _call('POST', '/ais/$id/chat/sessions/$sessionId/messages',
        body: {'content': content, 'version': current ? 'current' : 'draft'}) as Map);
    return (
      ChatMsg(Map<String, dynamic>.from(body['message'] as Map)),
      ChatMsg(Map<String, dynamic>.from(body['reply'] as Map)),
      body['proposedMemory'] == null ? null : Map<String, dynamic>.from(body['proposedMemory'] as Map),
    );
  }

  // lifecycle
  Future<AiVersionInfo> buildVersion(String id) async => AiVersionInfo(Map<String, dynamic>.from(await _call('POST', '/ais/$id/versions') as Map));
  Future<List<AiVersionInfo>> versions(String id) async =>
      (await _call('GET', '/ais/$id/versions') as List).map((e) => AiVersionInfo(Map<String, dynamic>.from(e as Map))).toList();
  Future<(bool, List<ClearanceCheck>)> clearance(String id) async {
    final body = Map<String, dynamic>.from(await _call('GET', '/ais/$id/clearance') as Map);
    return (body['passed'] == true, (body['checks'] as List).map((c) => ClearanceCheck(Map<String, dynamic>.from(c as Map))).toList());
  }

  Future<void> confirm(String id, bool confirmed) => _call('POST', '/ais/$id/confirm', body: {'confirmed': confirmed});
  Future<Map<String, dynamic>> deployPreview(String id) async => Map<String, dynamic>.from(await _call('GET', '/ais/$id/deploy/preview') as Map);
  Future<void> deploy(String id) => _call('POST', '/ais/$id/deploy');
  Future<void> publish(String id, String versionId) => _call('POST', '/ais/$id/versions/$versionId/publish');
}

const aiApi = AiApi();
