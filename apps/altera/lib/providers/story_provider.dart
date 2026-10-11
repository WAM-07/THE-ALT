import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/story_model.dart';
import '../services/story_service.dart';

final storyServiceProvider = Provider((ref) => StoryService());

final storiesProvider = StateNotifierProvider<StoriesNotifier, AsyncValue<List<StoryGroup>>>((ref) {
  return StoriesNotifier(ref.watch(storyServiceProvider));
});

class StoriesNotifier extends StateNotifier<AsyncValue<List<StoryGroup>>> {
  final StoryService _service;

  StoriesNotifier(this._service) : super(const AsyncValue.loading()) {
    fetchStories();
  }

  Future<void> fetchStories() async {
    state = const AsyncValue.loading();
    try {
      final stories = await _service.getStories();
      state = AsyncValue.data(stories);
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  Future<bool> uploadStory({
    String? mediaUrl,
    String mediaType = 'image',
    String? textContent,
    String? backgroundColor,
  }) async {
    final success = await _service.uploadStory(
      mediaUrl: mediaUrl,
      mediaType: mediaType,
      textContent: textContent,
      backgroundColor: backgroundColor,
    );
    if (success) {
      fetchStories();
    }
    return success;
  }

  Future<void> markStoryViewed(String storyId) async {
    await _service.markStoryViewed(storyId);
  }

  Future<List<StoryViewer>> getStoryViewers(String storyId) async {
    return await _service.getStoryViewers(storyId);
  }
}
