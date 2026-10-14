import 'package:flutter/widgets.dart';

import 'alt_session.dart';

/// For tabs that stay alive in the bottom bar (Chat, Studio, Identity): when the person switches to
/// another of their AIs, [onAiSwitched] runs so the tab shows that AI, not the one it first loaded.
mixin FollowsCurrentAi<T extends StatefulWidget> on State<T> {
  String? _shownAiId;

  void onAiSwitched();

  void _check() {
    final id = currentAi.value?.id;
    if (id == null || id == _shownAiId) return;
    _shownAiId = id;
    if (mounted) onAiSwitched();
  }

  @override
  void initState() {
    super.initState();
    _shownAiId = currentAi.value?.id;
    currentAi.addListener(_check);
  }

  @override
  void dispose() {
    currentAi.removeListener(_check);
    super.dispose();
  }
}
