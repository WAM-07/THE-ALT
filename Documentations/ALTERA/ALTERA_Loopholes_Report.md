# ALTERA App — Security & Architectural Loopholes Report

> **17 issues found** across 4 severity levels — each with a description, affected code, and solution.

| # | Title | File | Severity |
|---|-------|------|----------|
| 1 | Hardcoded Groq API Key | `lib/services/ai_service.dart` | 🔴 CRITICAL |
| 2 | Hardcoded Login Credentials | `lib/providers/auth_provider.dart` | 🔴 CRITICAL |
| 3 | Hardcoded localhost in MessagingService | `lib/services/messaging_service.dart` | 🔴 CRITICAL |
| 4 | No Token Expiry Check | `lib/services/auth_service.dart` | 🟠 HIGH |
| 5 | No Client-Side Input Validation | `lib/screens/auth/*.dart` | 🟠 HIGH |
| 6 | AI Post Author Not Verified | `lib/services/feed_service.dart` | 🟠 HIGH |
| 7 | No Error Handling in MessagingService | `lib/services/messaging_service.dart` | 🟠 HIGH |
| 8 | Debug `print()` in Production Code | `auth_service.dart`, `ai_service.dart` | 🟡 MEDIUM |
| 9 | No Search Debounce | `lib/screens/explore/explore_screen.dart` | 🟡 MEDIUM |
| 10 | No 401 Auto Token Refresh | All service files | 🟡 MEDIUM |
| 11 | Google Sign-In is Web-Only | `lib/services/auth_service.dart` | 🟡 MEDIUM |
| 12 | No Offline / No-Network Handling | All service files | 🟡 MEDIUM |
| 13 | Stale User Cache — No TTL | `lib/services/auth_service.dart` | 🟡 MEDIUM |
| 14 | HTTP Instead of HTTPS in Config | `lib/config/app_config.dart` | 🔵 LOW |
| 15 | Auth0 Partial Config Has No Guard | `lib/config/app_config.dart` | 🔵 LOW |
| 16 | FeedService Creates Its Own AuthService | `lib/services/feed_service.dart` | 🔵 LOW |
| 17 | Fragile Category Inference from Text | `lib/models/user_model.dart` | 🔵 LOW |

---

## 🔴 CRITICAL — Fix Before Any Demo or Deployment

---

### Issue 1 — Hardcoded Groq API Key

**File:** `lib/services/ai_service.dart`

**Problem:**
The Groq API key is stored as a plain string constant in the source code. Anyone who decompiles the APK, clones the repo, or views the source bundle can steal it and use it at your expense with no limit.

**Affected Code:**
```dart
static const String _apiKey = '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';
```

**Solution:**
Never store API keys on the client side. Move the AI generation call to your own backend — your Flutter app calls your server, your server calls Groq. If you need a quick workaround, use Flutter's `--dart-define` flag to inject keys at build time so they never exist in source code:

```bash
flutter run --dart-define=GEMINI_KEY=your_key_here
```

```dart
// In app_config.dart
static const String geminiApiKey = String.fromEnvironment('GEMINI_KEY');
```

---

### Issue 2 — Hardcoded Real Credentials in Auth Provider ✅ FIXED

**File:** `lib/providers/auth_provider.dart`

**Problem:**
In debug + web mode, if no token existed, the app automatically logged in using a real email address and a plain-text password hardcoded directly in source code. Anyone reading the code — including on GitHub — would have those credentials.

**Removed Code:**
```dart
// Auto-login for development on web if not logged in
if (!loggedIn && kDebugMode && kIsWeb) {
  print('DEBUG: Auto-logging in for web development...');
  await login('wamiq@altera.io', 'password123');
  return;
}
```

**Solution:**
This block has been removed from the file. For development convenience, use a Flutter mock auth provider that returns a fake user object without making any network call:

```dart
// dev_auth_provider.dart (never committed with real credentials)
if (kDebugMode) {
  state = state.copyWith(
    isLoggedIn: true,
    user: UserModel.mock(), // a hardcoded fake user with no real data
    isLoading: false,
  );
  return;
}
```

---

### Issue 3 — Hardcoded `localhost` in MessagingService

**File:** `lib/services/messaging_service.dart`

**Problem:**
`MessagingService` defines its own `_baseUrl = 'http://localhost:3000'` instead of reading from `AppConfig.baseUrl`. This means all messaging API calls silently fail on any physical device, emulator with a different IP, or any deployed environment — even when the rest of the app works fine.

**Affected Code:**
```dart
class MessagingService {
  static const String _baseUrl = 'http://localhost:3000'; // ❌ ignores AppConfig
}
```

**Solution:**
Replace the private constant with `AppConfig.baseUrl` — the same pattern already used in `FeedService` and `AuthService`:

```dart
class MessagingService {
  final String _baseUrl = AppConfig.baseUrl; // ✅ consistent with rest of app
}
```

---

## 🟠 HIGH — Causes Visible Bugs and Security Gaps

---

### Issue 4 — No Token Expiry Check

**File:** `lib/services/auth_service.dart`

**Problem:**
The `isLoggedIn` getter returns `true` if a token string exists in secure storage — regardless of whether that token is expired. A user with a token that expired days ago is treated as logged in until the first API call fails.

**Affected Code:**
```dart
Future<bool> get isLoggedIn async {
  final token = await getToken();
  return token != null; // ❌ does not check expiry
}
```

**Solution:**
Use the `jwt_decoder` package to check expiry before trusting the token:

```dart
// pubspec.yaml
// jwt_decoder: ^2.0.1

Future<bool> get isLoggedIn async {
  final token = await getToken();
  if (token == null) return false;
  return !JwtDecoder.isExpired(token); // ✅ checks actual expiry
}
```

---

### Issue 5 — No Client-Side Input Validation

**File:** `lib/screens/auth/signup_screen.dart`, `lib/screens/auth/login_screen.dart`

**Problem:**
There is no client-side validation on the signup or login forms. Empty strings, whitespace-only usernames, and malformed emails are sent directly to the backend, causing confusing raw server error messages.

**Affected Code:**
```dart
// No validator on any TextFormField — raw input sent directly to API
```

**Solution:**
Wrap fields in Flutter's `Form` widget and add validators:

```dart
TextFormField(
  controller: _emailController,
  validator: (val) {
    if (val == null || val.trim().isEmpty) return 'Email is required';
    if (!RegExp(r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$').hasMatch(val)) {
      return 'Enter a valid email';
    }
    return null;
  },
)

// In submit button:
if (_formKey.currentState!.validate()) {
  // proceed with API call
}
```

---

### Issue 6 — AI Post Author Not Verified Client-Side

**File:** `lib/services/feed_service.dart`

**Problem:**
When creating a post, `author_id` and `author_type` are sent as plain JSON fields from the client. A modified Flutter app could substitute another user's AI persona ID and post as them — the server currently trusts whatever the client sends.

**Affected Code:**
```dart
body: jsonEncode({
  'content': content,
  'author_id': authorId,   // ❌ client decides who the author is
  'author_type': authorType,
}),
```

**Solution:**
This must be fixed on the **backend**. The server should extract the author identity from the validated JWT token — not from the request body. The client should only send the post content:

```dart
// Client sends only:
body: jsonEncode({
  'content': content,
  'media_urls': mediaUrls,
  // author resolved server-side from JWT
}),

// Backend (Node/Express):
// const authorId = req.user.profileId; // from verified JWT middleware
```

---

### Issue 7 — MessagingService Has No Error Handling

**File:** `lib/services/messaging_service.dart`

**Problem:**
`getConversations()` and `getConversationMessages()` throw raw uncaught exceptions on non-200 responses. These are not caught anywhere in the provider, so any server error or network failure causes the messages screen to crash silently with no user feedback.

**Affected Code:**
```dart
if (res.statusCode != 200) {
  throw Exception('Failed to load conversations'); // ❌ unhandled — crashes screen
}
```

**Solution:**
Return a Result type instead of throwing — the same pattern used in `FeedService`:

```dart
Future<List<Conversation>> getConversations() async {
  try {
    final res = await http.get(...);
    if (res.statusCode != 200) return []; // ✅ graceful failure
    final data = jsonDecode(res.body);
    return (data['conversations'] as List)
        .map((c) => Conversation.fromJson(c))
        .toList();
  } catch (_) {
    return []; // ✅ network errors handled silently
  }
}
```

---

## 🟡 MEDIUM — UX and Reliability Problems

---

### Issue 8 — Debug `print()` Statements in Production Code

**Files:** `lib/services/auth_service.dart`, `lib/services/ai_service.dart`

**Problem:**
Multiple `print()` calls log sensitive data — user objects, token presence, and full API request bodies including the Groq API key — to the console. These logs appear in release builds too.

**Affected Code:**
```dart
print('Groq API Request Body: ${jsonEncode({...})}');
print('DEBUG getMe: parsed user counts...');
```

**Solution:**
Replace all `print()` calls with a logging package that suppresses output in release mode:

```dart
// pubspec.yaml: logger: ^2.0.2

import 'package:logger/logger.dart';
final _log = Logger();

// Replace print() with:
_log.d('getMe: $userData'); // only shows in debug builds
```

Or as a quick fix, wrap every `print()` with:
```dart
if (kDebugMode) print('...');
```

---

### Issue 9 — No Debounce on Search Input

**File:** `lib/screens/explore/explore_screen.dart`

**Problem:**
The explore screen fires `searchPosts()` and `searchProfiles()` API calls on every character the user types with no delay. Typing 10 characters fires 10 requests simultaneously, hammering the server and producing slow, jumpy results.

**Solution:**
Add a `Timer`-based debounce in the search handler:

```dart
Timer? _debounce;

void _onSearchChanged(String query) {
  _debounce?.cancel();
  _debounce = Timer(const Duration(milliseconds: 400), () {
    // only fires 400ms after user stops typing
    ref.read(exploreProvider.notifier).search(query);
  });
}
```

---

### Issue 10 — 401 Responses Do Not Trigger Token Refresh

**Files:** All service files

**Problem:**
When any API call returns HTTP 401 (token expired), no service class attempts a token refresh and retry. The user sees a generic error or blank screen without understanding why, and must manually log out and back in.

**Solution:**
Create a shared authenticated HTTP wrapper that intercepts 401s:

```dart
Future<http.Response> _authenticatedGet(Uri uri) async {
  var res = await http.get(uri, headers: await getHeaders());
  if (res.statusCode == 401) {
    final refreshed = await _auth.refreshToken();
    if (refreshed.success) {
      res = await http.get(uri, headers: await getHeaders()); // retry once
    } else {
      // Token refresh failed — force logout
      ref.read(authStateProvider.notifier).logout();
    }
  }
  return res;
}
```

---

### Issue 11 — Google Sign-In is Web-Only

**File:** `lib/services/auth_service.dart`

**Problem:**
`loginWithGoogle()` has an explicit check that blocks Google sign-in on all non-web platforms. If ALTERA targets iOS or Android, this permanently disables a key authentication feature.

**Affected Code:**
```dart
if (!kIsWeb) {
  return AuthResult.failure(
    'Auth0 Google sign-in is currently configured for Flutter web only.',
  );
}
```

**Solution:**
Integrate the `auth0_flutter` package for native mobile:

```yaml
# pubspec.yaml
auth0_flutter: ^1.4.0
```

```dart
// For native platforms, use Auth0 mobile flow:
final auth0 = Auth0('YOUR_DOMAIN', 'YOUR_CLIENT_ID');
final credentials = await auth0.webAuthentication().login();
```

Also add redirect scheme in `android/app/build.gradle` and `ios/Runner/Info.plist` per Auth0 Flutter docs.

---

### Issue 12 — No Offline / No-Network State Handling

**Files:** All service files

**Problem:**
All `catch` blocks silently return empty lists or `false` on network errors. The user cannot distinguish between "no data exists" and "no internet connection," leading to confusing blank screens.

**Affected Code:**
```dart
} catch (_) {
  return []; // ❌ no indication of why — data or network?
}
```

**Solution:**
Use `connectivity_plus` to detect network state and surface meaningful errors:

```dart
// pubspec.yaml: connectivity_plus: ^5.0.2

final connectivity = await Connectivity().checkConnectivity();
if (connectivity == ConnectivityResult.none) {
  state = state.copyWith(error: 'No internet connection');
  return;
}
```

Show a clear offline banner in the UI when `error` contains a network message.

---

### Issue 13 — Cached User Data Has No Expiry (Stale Cache)

**File:** `lib/services/auth_service.dart`

**Problem:**
`getCachedUser()` reads from secure storage with no timestamp or TTL. A user launching the app offline after days of inactivity sees outdated profile data (old bio, old avatar, old follower counts) with no indication it's stale.

**Solution:**
Store a `cached_at` timestamp alongside the user object:

```dart
// When saving:
await _storage.write(key: _userKey, value: jsonEncode(data['user']));
await _storage.write(key: 'user_cached_at', value: DateTime.now().millisecondsSinceEpoch.toString());

// When reading:
Future<UserModel?> getCachedUser() async {
  final cachedAt = await _storage.read(key: 'user_cached_at');
  if (cachedAt != null) {
    final age = DateTime.now().millisecondsSinceEpoch - int.parse(cachedAt);
    if (age > const Duration(hours: 1).inMilliseconds) return null; // treat as stale
  }
  final raw = await _storage.read(key: _userKey);
  if (raw == null) return null;
  return UserModel.fromJson(jsonDecode(raw));
}
```

---

## 🔵 LOW — Code Quality and Maintainability

---

### Issue 14 — AppConfig Uses HTTP, Not HTTPS

**File:** `lib/config/app_config.dart`

**Problem:**
`AppConfig.baseUrl` is set to `http://localhost:3000`. If not updated before deployment, all API traffic — including tokens and user data — will be sent unencrypted.

**Affected Code:**
```dart
static const String baseUrl = 'http://localhost:3000'; // ❌ plain HTTP
```

**Solution:**
Use `--dart-define` to inject the base URL per environment:

```bash
# Development
flutter run --dart-define=API_URL=http://localhost:3000

# Production
flutter build apk --dart-define=API_URL=https://api.altera.io
```

```dart
static const String baseUrl = String.fromEnvironment(
  'API_URL',
  defaultValue: 'http://localhost:3000',
);
```

---

### Issue 15 — Auth0 Config Has No Guard for Partial Setup

**File:** `lib/config/app_config.dart`

**Problem:**
Auth0 domain and client ID are both empty strings. The `isAuth0Configured` guard checks both, but there is no warning if a developer fills in only one — which could cause a misconfigured Auth0 call to slip through.

**Affected Code:**
```dart
static const String auth0Domain = '';
static const String auth0ClientId = '';
```

**Solution:**
Add a development-time assertion to catch partial configuration immediately:

```dart
static bool get isAuth0Configured {
  final bothSet = auth0Domain.isNotEmpty && auth0ClientId.isNotEmpty;
  final neitherSet = auth0Domain.isEmpty && auth0ClientId.isEmpty;
  assert(bothSet || neitherSet,
    'Auth0 domain and clientId must both be set or both be empty');
  return bothSet;
}
```

---

### Issue 16 — FeedService Creates Its Own AuthService Instance

**File:** `lib/services/feed_service.dart`

**Problem:**
`FeedService` instantiates its own `AuthService()` instead of using the Riverpod-provided singleton. This means token reads are uncoordinated and could return stale data if tokens are refreshed mid-session.

**Affected Code:**
```dart
class FeedService {
  final AuthService _auth = AuthService(); // ❌ bypasses Riverpod DI
}
```

**Solution:**
Pass `AuthService` as a constructor dependency and inject it via the provider:

```dart
class FeedService {
  final AuthService _auth;
  FeedService(this._auth); // ✅ injected externally
}

// In providers:
final feedServiceProvider = Provider<FeedService>((ref) {
  return FeedService(ref.watch(authServiceProvider)); // ✅ shared singleton
});
```

---

### Issue 17 — `resolvedCategory` Uses Fragile Text Inference

**File:** `lib/models/user_model.dart`

**Problem:**
`AIProfile.resolvedCategory` falls back to keyword-matching on `displayName`, `username`, and `bio` strings when `category` is null. An AI persona with "market analysis" in the bio gets unexpectedly tagged as "technical." This produces wrong category labels and wrong default model identities.

**Affected Code:**
```dart
final source = '${displayName.toLowerCase()} ${username.toLowerCase()} ${bio}';
if (source.contains('technical') || source.contains('market')) {
  return 'technical'; // ❌ fragile — infers from text
}
```

**Solution:**
Make `category` a required selection during AI persona creation — add a dropdown in `create_ai_screen.dart`:

```dart
// create_ai_screen.dart
DropdownButtonFormField<String>(
  items: ['companion', 'creative', 'technical', 'general']
    .map((c) => DropdownMenuItem(value: c, child: Text(c)))
    .toList(),
  onChanged: (val) => setState(() => _category = val),
  validator: (val) => val == null ? 'Please select a category' : null,
  decoration: const InputDecoration(labelText: 'AI Category'),
)
```

Remove the keyword inference fallback entirely, or replace it with `'general'` as the safe default.

---

*Report generated from source code review of ALTERA Flutter app (FYP 2nd / altera_app)*
