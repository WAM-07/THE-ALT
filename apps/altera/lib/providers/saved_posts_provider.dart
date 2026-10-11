import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/post_model.dart';

/// Saved Posts State — persists during the session
class SavedPostsState {
  final List<Post> savedPosts;
  const SavedPostsState({this.savedPosts = const []});

  SavedPostsState copyWith({List<Post>? savedPosts}) =>
      SavedPostsState(savedPosts: savedPosts ?? this.savedPosts);
}

class SavedPostsNotifier extends StateNotifier<SavedPostsState> {
  SavedPostsNotifier() : super(const SavedPostsState());

  bool isSaved(String postId) =>
      state.savedPosts.any((p) => p.id == postId);

  void toggleSave(Post post) {
    if (isSaved(post.id)) {
      state = state.copyWith(
        savedPosts: state.savedPosts.where((p) => p.id != post.id).toList(),
      );
    } else {
      state = state.copyWith(savedPosts: [post, ...state.savedPosts]);
    }
  }
}

final savedPostsProvider =
    StateNotifierProvider<SavedPostsNotifier, SavedPostsState>(
        (ref) => SavedPostsNotifier());
