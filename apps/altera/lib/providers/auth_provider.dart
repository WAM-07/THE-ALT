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

class AuthNotifier extends StateNotifier<AuthState> {
  final AuthService _authService;

  AuthNotifier(this._authService) : super(const AuthState()) {
    _init();
  }

  Future<void> _init() async {
    state = state.copyWith(isLoading: true);
    final user = await _authService.getCachedUser();
    final loggedIn = await _authService.isLoggedIn;
    if (loggedIn && user != null) {
      final refreshed = await _authService.refreshToken();
      state = state.copyWith(
        isLoggedIn: refreshed.success,
        user: refreshed.user ?? user,
        isLoading: false,
        error: refreshed.success ? null : refreshed.error,
        activeProfileId: (refreshed.user ?? user).humanProfile?.id,
      );
      _authService.activeProfileId = state.activeProfileId;
      return;
    }

    final restoredGoogleSession = await _authService.restoreGoogleSession();
    if (restoredGoogleSession != null && restoredGoogleSession.success) {
      state = state.copyWith(
        isLoggedIn: true,
        user: restoredGoogleSession.user,
        isLoading: false,
        error: null,
        activeProfileId: restoredGoogleSession.user?.humanProfile?.id,
      );
      _authService.activeProfileId = state.activeProfileId;
      return;
    }

    state = state.copyWith(
      isLoggedIn: false,
      user: user,
      isLoading: false,
      activeProfileId: user?.humanProfile?.id,
    );
    _authService.activeProfileId = state.activeProfileId;
  }



  Future<bool> login(String email, String password) async {
    state = state.copyWith(isLoading: true, error: null);
    final result = await _authService.login(email: email, password: password);
    if (result.success) {
      state = state.copyWith(
        isLoggedIn: true,
        user: result.user,
        isLoading: false,
        activeProfileId: result.user?.humanProfile?.id,
      );
      return true;
    }
    state = state.copyWith(isLoading: false, error: result.error);
    return false;
  }

  Future<bool> register(
    String email,
    String password,
    String username,
    String displayName,
  ) async {
    state = state.copyWith(isLoading: true, error: null);
    final result = await _authService.register(
      email: email,
      password: password,
      username: username,
      displayName: displayName,
    );
    if (result.success) {
      state = state.copyWith(
        isLoggedIn: true,
        user: result.user,
        isLoading: false,
        activeProfileId: result.user?.humanProfile?.id,
      );
      _authService.activeProfileId = state.activeProfileId;
      return true;
    }
    state = state.copyWith(isLoading: false, error: result.error);
    return false;
  }

  Future<bool> requestOtp(String email) async {
    state = state.copyWith(isLoading: true, error: null);
    final result = await _authService.requestOtp(email);
    state = state.copyWith(isLoading: false, error: result.error);
    return result.success;
  }

  Future<bool> verifyOtp(String email, String otp) async {
    state = state.copyWith(isLoading: true, error: null);
    final result = await _authService.verifyOtp(email, otp);
    state = state.copyWith(isLoading: false, error: result.error);
    return result.success;
  }

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
    state = state.copyWith(isLoading: true, error: null);
    final result = await _authService.loginWithGoogle();
    if (result.success) {
      state = state.copyWith(
        isLoggedIn: true,
        user: result.user,
        isLoading: false,
        activeProfileId: result.user?.humanProfile?.id,
      );
      _authService.activeProfileId = state.activeProfileId;
      return result;
    }

    state = state.copyWith(
      isLoading: false,
      error: result.launched ? null : result.error,
    );
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
      state = state.copyWith(
        user: result.user,
        isLoading: false,
      );
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
        state = state.copyWith(
            user: state.user!.copyWith(humanProfile: updatedProfile));
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
        state = state.copyWith(
            user: state.user!
                .copyWith(aiProfiles: updatedAIProfiles.cast<AIProfile>()));
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
