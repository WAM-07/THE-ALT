import 'dart:convert';

import 'package:alt_account/alt_account.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import 'alt_session.dart';

// Models for the personal AI as ALT Core describes it.

/// A link to a file ALT serves, made reachable from this device (see `altMediaUrl`).
String media(String url) => altMediaUrl(url, AltConfig.apiUrl);

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
  String? get avatarUrl => j['avatarUrl'] == null ? null : media(j['avatarUrl'] as String);
  String get status => j['status'] as String;
  bool get verified => j['verified'] == true;
  /// Module 7: 0–100, from how it behaves (see GET /ais/:id/health).
  double get healthScore => (j['healthScore'] as num?)?.toDouble() ?? 100;
  int? get currentVersion => (j['currentVersion'] as Map?)?['version'] as int?;
  AiToken? get token => j['token'] == null ? null : AiToken(Map<String, dynamic>.from(j['token'] as Map));
  Map<String, dynamic> get persona => Map<String, dynamic>.from(j['persona'] as Map? ?? const {});
  bool get ownerConfirmed => j['ownerConfirmed'] == true;
  Map<String, dynamic>? get latestVersion => j['latestVersion'] == null ? null : Map<String, dynamic>.from(j['latestVersion'] as Map);
  bool consent(String scope) => ((j['consents'] as Map?)?[scope] as Map?)?['granted'] == true;
  int count(String key) => ((j['counts'] as Map?)?[key] as num?)?.toInt() ?? 0;
}

/// An AI on the person's ALT account (the same list in ALTER, ALTERA and ALTAR): one they own, or
/// one they rent or subscribe to. [active] is false once a rental or subscription has ended; its
/// conversations stay readable, and renting or subscribing again carries them on.
class AccountAi extends AltAi {
  AccountAi(super.j);
  Map<String, dynamic> get _access => Map<String, dynamic>.from(j['access'] as Map);
  /// 'owner', 'renter' or 'subscriber'.
  String get role => _access['role'] as String;
  bool get owned => role == 'owner';
  bool get soldByMe => role == 'former_owner';
  bool get active => _access['active'] == true;
  DateTime? get until => _access['until'] == null ? null : DateTime.parse(_access['until'] as String);
  /// The person made it themselves (as opposed to buying it).
  bool get created => j['created'] == true;

  /// "Yours", "Bought", "Rented · 2 days left", "Subscribed · ended"…
  String get label {
    if (owned) return created ? 'Yours' : 'Bought';
    // An AI the person sold: their chats from when they owned it stay readable.
    if (soldByMe) return 'Sold · read only';
    final kind = role == 'subscriber' ? 'Subscribed' : 'Rented';
    final left = until?.difference(DateTime.now());
    if (!active || left == null || left.isNegative) return '$kind · ended';
    if (left.inHours < 1) return '$kind · ${left.inMinutes + 1} min left';
    if (left.inHours < 48) return '$kind · ${left.inHours} h left';
    return '$kind · ${left.inDays} days left';
  }
}

/// One of the person's conversations with an AI they rent or subscribe to.
class Conversation {
  Conversation(this.j);
  final Map<String, dynamic> j;
  String get id => j['id'] as String;
  String get title => (j['title'] as String?) ?? 'New conversation';
  DateTime get updatedAt => DateTime.parse(j['updatedAt'] as String);
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

  /// "Sounds like you" (0..1) from ALT's style-match model, on replies just written; null when not measured.
  double? get styleScore => ((j['style'] as Map?)?['score'] as num?)?.toDouble();
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
  String get manifestUrl => media(j['manifestUrl'] as String);
  bool get published => j['published'] == true;
  bool get current => j['current'] == true;
  String? get onchainTx => j['onchainTx'] as String?;
  int get datasets => (j['datasets'] as num?)?.toInt() ?? 0;
  int get memories => (j['memories'] as num?)?.toInt() ?? 0;
  DateTime? get createdAt => j['createdAt'] == null ? null : DateTime.parse(j['createdAt'] as String);

  /// `base` (persona on the base model) or `adapter` (trained); only a trained version can be verified.
  String get engine => j['engine'] as String? ?? 'base';
  bool get trained => engine == 'adapter';
  /// ALT's labelled stand-in for the real trainer.
  bool get simulated => j['simulated'] == true;
  /// `cloud` (ALT's trainer), `local` (the owner's own GPU) or `simulated`; null for base versions.
  String? get training => j['training'] as String?;
  double? get readiness => (j['readiness'] as num?)?.toDouble();
  /// The owner's verdict: `approved`, `rejected` (train again) or null.
  String? get verdict => j['verdict'] as String?;
}

/// The AI's Health Score (Module 7) and what makes it up.
class AiHealth {
  AiHealth(this.j);
  final Map<String, dynamic> j;
  double get score => (j['score'] as num).toDouble();
  /// safety, reports, readiness, rating, speed: 0–100, or null with no data yet.
  Map<String, double?> get parts => Map<String, dynamic>.from(j['parts'] as Map).map((k, v) => MapEntry(k, (v as num?)?.toDouble()));
  double get drift => (j['drift'] as num?)?.toDouble() ?? 0;
}

/// A question with the owner's own answer (the evaluation set, Module 9 FE-2).
class EvalItem {
  EvalItem(this.j);
  final Map<String, dynamic> j;
  String get id => j['id'] as String;
  String get question => j['question'] as String;
  String get answer => j['answer'] as String;
}

/// A version's answers to the owner's questions, scored (readiness, 0–100).
class AiEvaluation {
  AiEvaluation(this.j);
  final Map<String, dynamic> j;
  String get status => j['status'] as String;
  double? get readiness => (j['readiness'] as num?)?.toDouble();
  bool get safe => j['safe'] != false;
  bool get finished => status == 'completed' || status == 'failed';
  List<Map<String, dynamic>> get items => (j['items'] as List? ?? []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
}

/// One training of an AI (Module 9) with its live progress.
class AiTraining {
  AiTraining(this.j);
  final Map<String, dynamic> j;
  String get id => j['id'] as String;
  String get status => j['status'] as String;
  String? get stage => j['stage'] as String?;
  int get progress => (j['progress'] as num?)?.toInt() ?? 0;
  bool get simulated => j['simulated'] == true;
  String? get error => j['error'] as String?;
  bool get finished => status == 'completed' || status == 'failed';
}

/// Something the AI remembers about its owner, or a suggestion waiting for approval.
class AiMemory {
  AiMemory(this.j);
  final Map<String, dynamic> j;
  String get id => j['id'] as String;
  String get content => j['content'] as String;
  /// 'owner' (you taught it) or 'chat' (it suggested it while you talked).
  String get source => j['source'] as String;
  /// 'proposed', 'approved' or 'discarded'.
  String get status => j['status'] as String;
  DateTime? get createdAt => j['createdAt'] == null ? null : DateTime.parse(j['createdAt'] as String);
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

  /// Module 18: earnings, royalties, engagement, health and versions of your AIs in one place.
  Future<Map<String, dynamic>> creatorPanel() async => Map<String, dynamic>.from(await _call('GET', '/me/creator-panel') as Map);

  /// The panel's export: `csv` (every earning) or `pdf` (a one-page summary).
  Future<List<int>> creatorPanelExport(String format) async {
    final res = await altAccount.authorizedSend('GET', Uri.parse('${altAccount.coreUrl}/me/creator-panel/export?format=$format'));
    if (res.statusCode >= 400) throw AltApiException.fromBody(res.statusCode, res.body.isEmpty ? null : jsonDecode(res.body));
    return res.bodyBytes;
  }

  /// Every AI on the account: owned, rented and subscribed (active first, then ended).
  Future<List<AccountAi>> accountAis() async =>
      (await _call('GET', '/me/ais') as List).map((e) => AccountAi(Map<String, dynamic>.from(e as Map))).toList();

  /// A verified AI's public profile (about, traits, owner and creator), as every ALT app shows it.
  Future<Map<String, dynamic>> publicProfile(String handle) async =>
      Map<String, dynamic>.from(await _call('GET', '/public/ais/${Uri.encodeComponent(handle)}?platform=alter') as Map);

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

  /// Edits name and bio (shown on ALTERA straight away) and, optionally, the persona (needs a new version).
  Future<AltAi> update(String id, {String? name, String? description, Map<String, dynamic>? persona}) async =>
      AltAi(Map<String, dynamic>.from(await _call('PATCH', '/ais/$id', body: {
        if (name != null) 'name': name,
        if (description != null) 'description': description.isEmpty ? null : description,
        if (persona != null) 'persona': persona,
      }) as Map));

  Future<AltAi> uploadAvatar(String id, {required List<int> bytes, required String fileName, required String mimeType}) async {
    final token = await altAccount.accessToken();
    final req = http.MultipartRequest('POST', Uri.parse('${altAccount.coreUrl}/ais/$id/avatar'))
      ..headers['authorization'] = 'Bearer $token'
      ..files.add(http.MultipartFile.fromBytes('file', bytes, filename: fileName, contentType: MediaType.parse(mimeType)));
    final res = await http.Response.fromStream(await req.send());
    final body = res.body.isEmpty ? null : jsonDecode(res.body);
    if (res.statusCode >= 400) throw AltApiException.fromBody(res.statusCode, body);
    return AltAi(Map<String, dynamic>.from(body as Map));
  }

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

  /// Module 9 (E4): an adapter trained on the owner's own GPU (.safetensors or .gguf), sent from disk.
  Future<void> uploadAdapter(String id, {String? path, List<int>? bytes, required String fileName, String? baseModel}) async {
    final token = await altAccount.accessToken();
    final req = http.MultipartRequest('POST', Uri.parse('${altAccount.coreUrl}/ais/$id/trainings/local'))
      ..headers['authorization'] = 'Bearer $token'
      ..fields['baseModel'] = baseModel ?? '';
    req.files.add(path != null
        ? await http.MultipartFile.fromPath('file', path, filename: fileName)
        : http.MultipartFile.fromBytes('file', bytes!, filename: fileName));
    final res = await http.Response.fromStream(await req.send());
    if (res.statusCode >= 400) throw AltApiException.fromBody(res.statusCode, res.body.isEmpty ? null : jsonDecode(res.body));
  }

  Future<String> datasetText(String id, String datasetId) async {
    final res = await altAccount.authorizedSend('GET', Uri.parse('${altAccount.coreUrl}/ais/$id/datasets/$datasetId/content?as=text'));
    if (res.statusCode >= 400) throw AltApiException.fromBody(res.statusCode, null);
    return utf8.decode(res.bodyBytes, allowMalformed: true);
  }

  Future<void> setIncluded(String id, String datasetId, bool included) => _call('PATCH', '/ais/$id/datasets/$datasetId', body: {'included': included});
  Future<void> deleteDataset(String id, String datasetId) => _call('DELETE', '/ais/$id/datasets/$datasetId');

  // memories
  Future<List<AiMemory>> memories(String id, {String? status}) async =>
      (await _call('GET', '/ais/$id/memories${status != null ? '?status=$status' : ''}') as List).map((e) => AiMemory(Map<String, dynamic>.from(e as Map))).toList();
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
      ChatMsg({...Map<String, dynamic>.from(body['reply'] as Map), 'style': body['style']}),
      body['proposedMemory'] == null ? null : Map<String, dynamic>.from(body['proposedMemory'] as Map),
    );
  }

  // Talking to an AI you rent or subscribe to: the same conversations as on ALTAR and ALTERA.
  /// Your conversations with it, newest first, and whether you may still talk (role and until).
  Future<(List<Conversation>, bool canTalk)> conversations(String id) async {
    final body = Map<String, dynamic>.from(await _call('GET', '/ais/$id/conversations') as Map);
    final list = (body['conversations'] as List).map((e) => Conversation(Map<String, dynamic>.from(e as Map))).toList();
    return (list, (body['access'] as Map)['role'] != null);
  }

  Future<String> startConversation(String id) async => ((await _call('POST', '/ais/$id/conversations', body: <String, dynamic>{})) as Map)['id'] as String;

  Future<List<ChatMsg>> conversationMessages(String id, String conversationId) async =>
      (await _call('GET', '/ais/$id/conversations/$conversationId/messages') as List).map((e) => ChatMsg(Map<String, dynamic>.from(e as Map))).toList();

  /// Returns the AI's reply.
  Future<ChatMsg> say(String id, String conversationId, String content) async {
    final body = Map<String, dynamic>.from(await _call('POST', '/ais/$id/conversations/$conversationId/messages', body: {'content': content}) as Map);
    return ChatMsg(Map<String, dynamic>.from(body['reply'] as Map));
  }

  // lifecycle
  Future<AiVersionInfo> buildVersion(String id) async => AiVersionInfo(Map<String, dynamic>.from(await _call('POST', '/ais/$id/versions') as Map));
  Future<AiTraining> startTraining(String id) async => AiTraining(Map<String, dynamic>.from(await _call('POST', '/ais/$id/trainings') as Map));
  /// Module 8: the consent record as a PDF (every consent given or withdrawn).
  Future<List<int>> consentRecordPdf(String id) async {
    final res = await altAccount.authorizedSend('GET', Uri.parse('${altAccount.coreUrl}/ais/$id/consents/record?format=pdf'));
    if (res.statusCode >= 400) throw AltApiException.fromBody(res.statusCode, res.body.isEmpty ? null : jsonDecode(res.body));
    return res.bodyBytes;
  }

  /// Module 6: what changed in a version since the previous one.
  Future<Map<String, dynamic>> versionDiff(String id, String versionId) async =>
      Map<String, dynamic>.from(await _call('GET', '/ais/$id/versions/$versionId/diff') as Map);

  Future<AiHealth> health(String id) async => AiHealth(Map<String, dynamic>.from(await _call('GET', '/ais/$id/health') as Map));
  Future<List<EvalItem>> evaluationSet(String id) async =>
      (await _call('GET', '/ais/$id/evaluation-set') as List).map((e) => EvalItem(Map<String, dynamic>.from(e as Map))).toList();
  Future<void> addEvalItem(String id, String question, String answer) => _call('POST', '/ais/$id/evaluation-set', body: {'question': question, 'answer': answer});
  Future<void> deleteEvalItem(String id, String itemId) => _call('DELETE', '/ais/$id/evaluation-set/$itemId');
  Future<void> evaluate(String id, String versionId) => _call('POST', '/ais/$id/versions/$versionId/evaluate');
  Future<AiEvaluation?> evaluation(String id, String versionId) async {
    try {
      return AiEvaluation(Map<String, dynamic>.from(await _call('GET', '/ais/$id/versions/$versionId/evaluation') as Map));
    } on AltApiException catch (e) {
      if (e.status == 404) return null;
      rethrow;
    }
  }

  Future<void> verdict(String id, String versionId, bool approved) => _call('POST', '/ais/$id/versions/$versionId/verdict', body: {'approved': approved});
  Future<List<AiTraining>> trainings(String id) async =>
      (await _call('GET', '/ais/$id/trainings') as List).map((e) => AiTraining(Map<String, dynamic>.from(e as Map))).toList();
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
