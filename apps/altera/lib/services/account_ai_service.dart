import 'dart:convert';

import 'package:alt_account/alt_account.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/app_config.dart';
import '../providers/auth_provider.dart';
import 'auth_service.dart';

/// An AI on the person's ALT account, the same list ALTER and ALTAR show: one they own (made or
/// bought) or rent or subscribe to. [active] is false once a rental or subscription has ended; its
/// conversations stay readable, and renting or subscribing again carries them on.
class AccountAi {
  AccountAi(this.j);
  final Map<String, dynamic> j;
  String get id => j['id'] as String;
  String get handle => j['handle'] as String;
  String get name => j['name'] as String;
  String? get description => j['description'] as String?;
  String? get avatarUrl => j['avatarUrl'] == null ? null : altMediaUrl(j['avatarUrl'] as String, AppConfig.apiUrl);
  bool get verified => j['verified'] == true;
  Map<String, dynamic> get _access => Map<String, dynamic>.from(j['access'] as Map);
  /// 'owner', 'renter' or 'subscriber'.
  String get role => _access['role'] as String;
  bool get owned => role == 'owner';
  bool get soldByMe => role == 'former_owner';
  bool get active => _access['active'] == true;
  DateTime? get until => _access['until'] == null ? null : DateTime.parse(_access['until'] as String);
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

class AiConversation {
  AiConversation(this.j);
  final Map<String, dynamic> j;
  String get id => j['id'] as String;
  String get title => (j['title'] as String?) ?? 'New conversation';
}

class AiChatMessage {
  AiChatMessage(this.j);
  final Map<String, dynamic> j;
  String get role => j['role'] as String;
  String get content => j['content'] as String;
  bool get mine => role == 'user';
}

/// The account's AIs and the conversations with them, from ALT Core (the same as in ALTER and
/// ALTAR), and posts drafted with them on ALTERA.
class AccountAiService {
  AccountAiService(this._auth);
  final AuthService _auth;

  Future<dynamic> _core(String method, String path, {Object? body}) async {
    final alt = _auth.alt;
    final res = await alt.authorizedSend(method, Uri.parse('${alt.coreUrl}$path'), body: body);
    final decoded = res.body.isEmpty ? null : jsonDecode(res.body);
    if (res.statusCode >= 400) throw AltApiException.fromBody(res.statusCode, decoded);
    return decoded;
  }

  /// Verified AIs on the account (owned, rented, subscribed; ended ones last).
  Future<List<AccountAi>> accountAis() async =>
      (await _core('GET', '/me/ais') as List).map((e) => AccountAi(Map<String, dynamic>.from(e as Map))).where((a) => a.verified).toList();

  Future<(List<AiConversation>, bool canTalk)> conversations(String aiId) async {
    final body = Map<String, dynamic>.from(await _core('GET', '/ais/$aiId/conversations') as Map);
    final list = (body['conversations'] as List).map((e) => AiConversation(Map<String, dynamic>.from(e as Map))).toList();
    return (list, (body['access'] as Map)['role'] != null);
  }

  Future<String> startConversation(String aiId) async => ((await _core('POST', '/ais/$aiId/conversations', body: <String, dynamic>{})) as Map)['id'] as String;

  Future<List<AiChatMessage>> messages(String aiId, String conversationId) async =>
      (await _core('GET', '/ais/$aiId/conversations/$conversationId/messages') as List).map((e) => AiChatMessage(Map<String, dynamic>.from(e as Map))).toList();

  Future<AiChatMessage> say(String aiId, String conversationId, String content) async {
    final body = Map<String, dynamic>.from(await _core('POST', '/ais/$aiId/conversations/$conversationId/messages', body: {'content': content}) as Map);
    return AiChatMessage(Map<String, dynamic>.from(body['reply'] as Map));
  }

  /// The AI writes a post for the person's own profile ("posted with" the AI), or with [commentOnPostId]
  /// a comment or reply under that post ("replied with").
  Future<String> draftWith(String aiId, String brief, {String? commentOnPostId}) async {
    final res = await _auth.authorizedRequest(method: 'POST', uri: Uri.parse('${AppConfig.baseUrl}/ai/draft-with'), body: {
      'core_ai_id': aiId,
      'brief': brief,
      if (commentOnPostId != null) ...{'kind': 'comment', 'post_id': commentOnPostId},
    });
    final body = res.body.isEmpty ? null : jsonDecode(res.body);
    if (res.statusCode != 200) throw Exception((body is Map ? body['message'] : null) ?? 'The AI could not draft that post.');
    return (body as Map)['content'] as String;
  }
}

final accountAiServiceProvider = Provider<AccountAiService>((ref) => AccountAiService(ref.read(authServiceProvider)));
