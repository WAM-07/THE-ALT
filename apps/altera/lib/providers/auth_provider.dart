import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/user_model.dart';
import '../services/auth_service.dart';

// ─── Auth State ───────────────────────────────────────────────────────────────

class AuthState {
  final bool isLoggedIn;
  final bool isLoading;
  final UserModel? user;
  final String? error;
  final String? activeProfileId;

  const AuthState({
    this.isLoggedIn = false,
    this.isLoading = false,
    this.user,
    this.error,
    this.activeProfileId,
  });

  AuthState copyWith({
    bool? isLoggedIn,
    bool? isLoading,
    UserModel? user,
    String? error,
    String? activeProfileId,
  }) =>
      AuthState(
        isLoggedIn: isLoggedIn ?? this.isLoggedIn,
        isLoading: isLoading ?? this.isLoading,
        user: user ?? this.user,
        error: error,
        activeProfileId: activeProfileId ?? this.activeProfileId,
      );
}

// ─── Auth Notifier ────────────────────────────────────────────────────────────

/// The signed-in state of ALTERA. The person signs in with their ALT account (shared with
/// ALTER and ALTAR); ALTERA then loads its own profile bundle (human profile + AI personas).
class AuthNotifier extends StateNotifier<AuthState> {
  final AuthService _authService;

  AuthNotifier(this._authService) : super(const AuthState(isLoading: true)) {
    // Signed out elsewhere ("sign out everywhere", password reset, revoked device): leave ALTERA too.
    _authService.alt.currentUser.addListener(_onAltAccountChanged);
    _init();
  }

  void _onAltAccountChanged() {
    if (_authService.alt.currentUser.value == null && state.isLoggedIn) {
      _authService.activeProfileId = null;
      state = const AuthState();
    }
  }

  @override
  void dispose() {
    _authService.alt.currentUser.removeListener(_onAltAccountChanged);
    super.dispose();
  }

  Future<void> _init() async {
    final cached = await _authService.getCachedUser();
    final restored = await _authService.restore();
    _apply(restored, fallbackUser: cached);
  }

  /// Applies a sign-in result to the state. Returns the same result for the caller to inspect.
  AuthResult _apply(AuthResult result, {UserModel? fallbackUser}) {
    if (result.success && result.user != null) {
      state = AuthState(
        isLoggedIn: true,
        user: result.user,
        activeProfileId: result.user!.humanProfile?.id,
      );
    } else {
      state = AuthState(
        isLoggedIn: false,
        user: fallbackUser,
        error: result.verifyEmail != null || result.mfaToken != null ? null : result.error,
      );
    }
    _authService.activeProfileId = state.activeProfileId;
    return result;
  }

  Future<AuthResult> _run(Future<AuthResult> Function() action) async {
    state = state.copyWith(isLoading: true, error: null);
    return _apply(await action());
  }

  /// Email/handle + password. The result may ask for a 2FA code ([AuthResult.mfaToken]) or for
  /// the email to be confirmed ([AuthResult.verifyEmail]).
  Future<AuthResult> login(String identifier, String password) =>
      _run(() => _authService.login(email: identifier, password: password));

  Future<AuthResult> completeTwoFactor(String mfaToken, {String? code, String? recoveryCode}) =>
      _run(() => _authService.completeTwoFactor(mfaToken, code: code, recoveryCode: recoveryCode));

  /// Creates the ALT account. The result asks for the emailed code ([AuthResult.verifyEmail]).
  Future<AuthResult> register(String email, String password, String username, String displayName) async {
    state = state.copyWith(isLoading: true, error: null);
    final result = await _authService.register(email: email, password: password, username: username, displayName: displayName);
    state = state.copyWith(isLoading: false, error: result.verifyEmail != null ? null : result.error);
    return result;
  }

  Future<AuthResult> verifyEmail(String email, String code) => _run(() => _authService.verifyEmail(email, code));

  Future<AuthResult> resendVerificationCode(String email) => _authService.resendVerificationCode(email);

  /// Signed in from another ALT app (altera://handoff?code=...).
  Future<AuthResult> signInWithHandoff(String code) => _run(() => _authService.redeemHandoff(code));

  /// The ALT session changed outside this notifier (e.g. a handoff link was redeemed); reload.
  Future<AuthResult> adoptSession() => _run(() => _authService.getMe());

  Future<bool> forgotPassword(String email) async {
    state = state.copyWith(isLoading: true, error: null);
    final result = await _authService.forgotPassword(email);
    state = state.copyWith(isLoading: false, error: result.error);
    return result.success;
  }

  Future<bool> resetPassword(String email, String otp, String newPassword) async {
    state = state.copyWith(isLoading: true, error: null);
    final result = await _authService.resetPassword(email, otp, newPassword);
    state = state.copyWith(isLoading: false, error: result.error);
    return result.success;
  }

  Future<bool> changePassword(String oldPassword, String newPassword) async {
    state = state.copyWith(isLoading: true, error: null);
    final result = await _authService.changePassword(oldPassword, newPassword);
    state = state.copyWith(isLoading: false, error: result.error);
    return result.success;
  }

  Future<bool> setInitialPassword(String password) async {
    state = state.copyWith(isLoading: true, error: null);
    final result = await _authService.setInitialPassword(password);
    state = state.copyWith(isLoading: false, error: result.error);
    return result.success;
  }

  Future<AuthResult> continueWithGoogle() async {
    final result = await _authService.loginWithGoogle();
    state = state.copyWith(isLoading: false, error: result.error);
    return result;
  }

  Future<bool> createAIPersona({
    required String username,
    required String displayName,
    required String bio,
    required String category,
  }) async {
    state = state.copyWith(isLoading: true, error: null);
    final result = await _authService.createAIPersona(
      username: username,
      displayName: displayName,
      bio: bio,
      category: category,
    );
    if (result.success) {
      state = state.copyWith(user: result.user, isLoading: false);
      return true;
    }
    state = state.copyWith(isLoading: false, error: result.error);
    return false;
  }

  Future<void> checkAuth() async {
    final result = await _authService.refreshToken();
    if (result.success) {
      state = state.copyWith(user: result.user);
    }
  }

  Future<void> refreshProfile() async {
    try {
      final result = await _authService.getMe();
      if (result.success && result.user != null) {
        state = state.copyWith(user: result.user);
      }
    } catch (e) {
      if (kDebugMode) print('Error refreshing profile: $e');
    }
  }

  Future<void> logout() async {
    state = state.copyWith(isLoading: true);
    await _authService.logout();
    _authService.activeProfileId = null;
    state = const AuthState();
  }

  Future<bool> updateProfile({
    String? displayName,
    String? bio,
    String? avatar,
  }) async {
    if (state.user == null || state.activeProfileId == null) return false;

    final activeId = state.activeProfileId!;
    final isHuman = state.user?.humanProfile?.id == activeId;

    try {
      final response = await _authService.authorizedRequest(
        method: 'PUT',
        uri: Uri.parse('${_authService.baseUrl}/auth/profile'),
        body: {
          'profile_id': activeId,
          if (displayName != null) 'display_name': displayName,
          if (bio != null) 'bio': bio,
          if (avatar != null) 'avatar': avatar,
        },
      );

      if (response.statusCode != 200) {
        return false;
      }

      final responseData = jsonDecode(response.body) as Map<String, dynamic>;
      final resolvedAvatar = responseData['avatar_url'] as String? ?? avatar;

      if (isHuman) {
        final updatedProfile = state.user!.humanProfile!.copyWith(
          displayName: displayName,
          bio: bio,
          avatar: resolvedAvatar,
        );
        state = state.copyWith(user: state.user!.copyWith(humanProfile: updatedProfile));
        // Name and picture belong to the ALT account; keep the shared client in sync.
        if (displayName != null || avatar != null) await _authService.alt.reloadMe();
      } else {
        final updatedAIProfiles = state.user!.aiProfiles.map((p) {
          if (p.id == activeId) {
            return p.copyWith(
              displayName: displayName,
              bio: bio,
              avatar: resolvedAvatar,
            );
          }
          return p;
        }).toList();
        state = state.copyWith(user: state.user!.copyWith(aiProfiles: updatedAIProfiles.cast<AIProfile>()));
      }

      return true;
    } catch (_) {
      return false;
    }
  }

  void switchProfile(String profileId) {
    state = state.copyWith(activeProfileId: profileId);
    _authService.activeProfileId = profileId;
  }

  void clearError() => state = state.copyWith(error: null);
}

// ─── Providers ────────────────────────────────────────────────────────────────

final authServiceProvider = Provider<AuthService>((ref) => AuthService());

final authStateProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(ref.watch(authServiceProvider));
});
