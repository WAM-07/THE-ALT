import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../theme/app_theme.dart';
import '../../providers/auth_provider.dart';
import '../../providers/feed_provider.dart';
import '../../services/account_ai_service.dart';
import '../../services/ai_service.dart';
import '../../widgets/avatar_widget.dart';
import 'dart:io';
import 'dart:convert';
import 'package:image_picker/image_picker.dart';
import 'package:permission_handler/permission_handler.dart';
import '../../services/image_service.dart';

class PostComposerScreen extends ConsumerStatefulWidget {
  const PostComposerScreen({super.key});

  @override
  ConsumerState<PostComposerScreen> createState() => _PostComposerScreenState();
}

class _PostComposerScreenState extends ConsumerState<PostComposerScreen>
    with SingleTickerProviderStateMixin {
  final _contentCtrl = TextEditingController();
  final List<String> _mediaUrls = [];
  bool _isScheduled = false;
  DateTime? _scheduledAt;
  bool _isPosting = false;
  bool _isAIGenerating = false;
  bool _hasAIGeneratedContent = false;
  // An AI on the ALT account (owned, rented or subscribed) that drafted this post: "posted with".
  AccountAi? _assistedBy;
  bool get _postingAsAi {
    final auth = ref.read(authStateProvider);
    return auth.activeProfileId != auth.user?.humanProfile?.id;
  }
  int get _charCount => _contentCtrl.text.length;
  static const int _maxChars = 5000;

  final _suggestedTags = [
    '#AIT', '#AIPersonas', '#Web3Social', '#ALTERA',
    '#BlockchainID', '#AutonomousAI', '#LLaMA3', '#DeFi',
  ];

  @override
  void dispose() {
    _contentCtrl.dispose();
    super.dispose();
  }

  void _addMedia() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Theme.of(context).cardColor,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
      ),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_library_outlined, color: AppColors.primary),
              title: const Text('Pick from Gallery'),
              onTap: () async {
                Navigator.pop(ctx);
                final picker = ImagePicker();
                final picked = await picker.pickImage(source: ImageSource.gallery);
                if (picked != null) {
                  final imageService = ImageService();
                  final base64Image = await imageService.uploadImage(picked);
                  if (base64Image != null) {
                    setState(() {
                      _mediaUrls.add(base64Image);
                    });
                  }
                }
              },
            ),
            ListTile(
              leading: const Icon(Icons.camera_alt_outlined, color: AppColors.secondary),
              title: const Text('Take Photo'),
              onTap: () async {
                Navigator.pop(ctx);
                final picker = ImagePicker();
                final picked = await picker.pickImage(source: ImageSource.camera);
                if (picked != null) {
                  final imageService = ImageService();
                  final base64Image = await imageService.uploadImage(picked);
                  if (base64Image != null) {
                    setState(() {
                      _mediaUrls.add(base64Image);
                    });
                  }
                }
              },
            ),
            ListTile(
              leading: const Icon(Icons.link_rounded, color: AppColors.textTertiary),
              title: const Text('Add Image URL'),
              onTap: () {
                Navigator.pop(ctx);
                _showUrlDialog();
              },
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  void _showUrlDialog() {
    showDialog(
      context: context,
      builder: (ctx) {
        final urlCtrl = TextEditingController();
        return AlertDialog(
          title: const Text('Add Image URL'),
          content: TextField(
            controller: urlCtrl,
            decoration: const InputDecoration(hintText: 'https://example.com/image.jpg'),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
            TextButton(
              onPressed: () {
                if (urlCtrl.text.isNotEmpty) {
                  setState(() {
                    _mediaUrls.add(urlCtrl.text);
                  });
                }
                Navigator.pop(ctx);
              },
              child: const Text('Add'),
            ),
          ],
        );
      },
    );
  }

  Future<void> _post() async {
    final content = _contentCtrl.text.trim();
    if (content.isEmpty && _mediaUrls.isEmpty) return;
    setState(() => _isPosting = true);

    final auth = ref.read(authStateProvider);
    final activeId = auth.activeProfileId;
    final isAI = activeId != auth.user?.humanProfile?.id;

    if (activeId != null) {
      final post = await ref.read(feedServiceProvider).createPost(
        content: content,
        authorId: activeId,
        authorType: isAI ? 'ai' : 'human',
        mediaUrls: _mediaUrls,
        scheduledAt: _isScheduled ? _scheduledAt : null,
        aiGenerated: isAI && _hasAIGeneratedContent,
        assistedByAiId: isAI ? null : _assistedBy?.id,
      );

      if (post != null && post.success) {
        if (!_isScheduled && post.status == 'published') {
          await ref.read(feedProvider.notifier).loadFeed(refresh: true);
        }
        await ref.read(authStateProvider.notifier).refreshProfile();
        
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Row(children: [
              const Icon(Icons.check_circle_rounded, color: Colors.white, size: 18),
              const SizedBox(width: 8),
              Text(post.message ?? 'Post created'),
            ]),
            backgroundColor: AppColors.primary,
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            duration: const Duration(seconds: 3),
          ));
          context.pop();
        }
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(post?.error ?? 'Failed to create post'),
              backgroundColor: AppColors.error,
              behavior: SnackBarBehavior.floating,
            ),
          );
        }
        setState(() => _isPosting = false);
        return;
      }
    }
    setState(() => _isPosting = false);
  }


  /// "Write with your AI": an AI the person owns, rents or subscribes to drafts the post for their
  /// own profile. They can edit it; it is published "posted with" that AI.
  Future<void> _writeWithAccountAi() async {
    final service = ref.read(accountAiServiceProvider);
    List<AccountAi> ais;
    try {
      ais = (await service.accountAis()).where((a) => a.active).toList();
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not reach ALT. Try again.')));
      return;
    }
    if (!mounted) return;
    if (ais.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('No AIs on your account yet. Make one in ALTER, or rent or subscribe on ALTAR.')));
      return;
    }
    var chosen = _assistedBy != null && ais.any((a) => a.id == _assistedBy!.id) ? ais.firstWhere((a) => a.id == _assistedBy!.id) : ais.first;
    final brief = TextEditingController();
    final go = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => Padding(
          padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.of(ctx).viewInsets.bottom),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const Text('Write with your AI', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            const SizedBox(height: 4),
            Text('It drafts a post for your profile. You can edit it before posting; it shows “posted with” the AI.',
                style: TextStyle(color: Theme.of(ctx).colorScheme.onSurface.withValues(alpha: 0.6))),
            const SizedBox(height: 14),
            SizedBox(
              height: 92,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: ais.length,
                separatorBuilder: (_, __) => const SizedBox(width: 12),
                itemBuilder: (_, i) {
                  final a = ais[i];
                  final on = a.id == chosen.id;
                  return InkWell(
                    borderRadius: BorderRadius.circular(14),
                    onTap: () => set(() => chosen = a),
                    child: SizedBox(
                      width: 70,
                      child: Column(children: [
                        Container(
                          padding: const EdgeInsets.all(2),
                          decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: on ? AppColors.primary : Colors.transparent, width: 2)),
                          child: AvatarWidget(avatarUrl: a.avatarUrl, displayName: a.name, radius: 24, isAI: true),
                        ),
                        const SizedBox(height: 4),
                        Text(a.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11.5, fontWeight: on ? FontWeight.w700 : FontWeight.w500)),
                        Text(a.owned ? (a.created ? 'Yours' : 'Bought') : a.role == 'subscriber' ? 'Subscribed' : 'Rented', style: const TextStyle(fontSize: 10.5, color: AppColors.textTertiary)),
                      ]),
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: brief,
              autofocus: true,
              maxLines: 3,
              decoration: InputDecoration(
                hintText: 'What should the post be about?',
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
              ),
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: () => Navigator.pop(ctx, true),
              icon: const Icon(Icons.auto_awesome_rounded),
              label: const Text('Draft it'),
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
            ),
          ]),
        ),
      ),
    );
    if (go != true || brief.text.trim().length < 3 || !mounted) return;
    setState(() => _isAIGenerating = true);
    try {
      final text = await service.draftWith(chosen.id, brief.text.trim());
      setState(() {
        _contentCtrl.text = text;
        _assistedBy = chosen;
      });
      _contentCtrl.selection = TextSelection.fromPosition(TextPosition(offset: text.length));
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString().replaceFirst('Exception: ', '')), backgroundColor: AppColors.error));
      }
    }
    if (mounted) setState(() => _isAIGenerating = false);
  }

  Future<void> _generateWithAI() async {
    final promptCtrl = TextEditingController();
    final instruction = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('AI Post Assistant'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('What would you like your post to be about?', style: TextStyle(fontSize: 14)),
            const SizedBox(height: 12),
            TextField(
              controller: promptCtrl,
              maxLines: 3,
              decoration: InputDecoration(
                hintText: 'e.g. A post about the future of AI social networks...',
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, promptCtrl.text),
            child: const Text('Generate', style: TextStyle(fontWeight: FontWeight.bold, color: AppColors.badgeAI)),
          ),
        ],
      ),
    );

    if (instruction == null || instruction.trim().isEmpty) return;

    setState(() => _isAIGenerating = true);
    try {
      final result = await AIService(
        ref.read(authServiceProvider),
      ).generatePost(instruction: instruction, profileId: ref.read(authStateProvider).activeProfileId);
      setState(() {
        _contentCtrl.text = result;
        _hasAIGeneratedContent = true;
      });
      _contentCtrl.selection = TextSelection.fromPosition(TextPosition(offset: result.length));
    } catch (e) {
      final message = e.toString().replaceFirst('Exception: ', '').trim();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(message.isNotEmpty ? message : 'Failed to generate post.'),
            backgroundColor: AppColors.error,
          ),
        );
      }
    }
    setState(() => _isAIGenerating = false);
  }

  Future<void> _selectSchedule() async {
    final date = await showDatePicker(
      context: context,
      initialDate: DateTime.now().add(const Duration(hours: 1)),
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 30)),
    );
    if (date != null) {
      final time = await showTimePicker(
        context: context,
        initialTime: TimeOfDay.now(),
      );
      if (time != null) {
        setState(() {
          _isScheduled = true;
          _scheduledAt = DateTime(date.year, date.month, date.day, time.hour, time.minute);
        });
      }
    }
  }

  void _appendTag(String tag) {
    final current = _contentCtrl.text;
    final hasSpace = current.isEmpty || current.endsWith(' ') || current.endsWith('\n');
    _contentCtrl.text = hasSpace ? '$current$tag ' : '$current $tag ';
    _contentCtrl.selection = TextSelection.fromPosition(
        TextPosition(offset: _contentCtrl.text.length));
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authStateProvider);
    final activeId = auth.activeProfileId;
    final dynamic profile = auth.user?.humanProfile?.id == activeId 
        ? auth.user?.humanProfile 
        : auth.user?.aiProfiles.firstWhere((p) => p.id == activeId, orElse: () => auth.user!.aiProfiles.first);

    final canPost = (_contentCtrl.text.trim().isNotEmpty || _mediaUrls.isNotEmpty) && _charCount <= _maxChars;
    final progress = _charCount / _maxChars;
    final isNearLimit = _charCount > _maxChars * 0.85;

    return Scaffold(
      resizeToAvoidBottomInset: false,
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        backgroundColor: Theme.of(context).appBarTheme.backgroundColor,
        elevation: 0,
        leading: IconButton(
          icon: Icon(Icons.close_rounded, color: Theme.of(context).iconTheme.color),
          onPressed: () => context.pop(),
        ),
        title: Text('Create Post',
            style: TextStyle(fontWeight: FontWeight.w700, color: Theme.of(context).colorScheme.onSurface, fontSize: 17)),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 14),
            child: Center(
              child: FilledButton(
                onPressed: (canPost && !_isPosting) ? _post : null,
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 10),
                  minimumSize: Size.zero,
                ),
                child: _isPosting
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                    : Text(_isScheduled ? 'Schedule' : 'Post', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
              ),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          if (_isAIGenerating)
            LinearProgressIndicator(backgroundColor: AppColors.badgeAI.withOpacity(0.1), color: AppColors.badgeAI),
          if (_assistedBy != null && !_postingAsAi)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
              child: Align(
                alignment: Alignment.centerLeft,
                child: InputChip(
                  avatar: const Icon(Icons.auto_awesome_rounded, size: 16, color: AppColors.badgeAI),
                  label: Text('Posted with ${_assistedBy!.name}'),
                  tooltip: 'Remove to post without the AI tag',
                  onDeleted: () => setState(() => _assistedBy = null),
                ),
              ),
            ),
          
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      AvatarWidget(avatarUrl: profile?.avatar, displayName: profile?.displayName ?? '', radius: 20),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: _contentCtrl,
                          onChanged: (_) => setState(() {}),
                          maxLines: null,
                          decoration: const InputDecoration(
                            hintText: "What's on your mind?",
                            border: InputBorder.none,
                          ),
                          style: const TextStyle(fontSize: 16, height: 1.5),
                        ),
                      ),
                    ],
                  ),
                  
                  if (_mediaUrls.isNotEmpty)
                    Container(
                      height: 200,
                      margin: const EdgeInsets.only(top: 16),
                      child: ListView.builder(
                        scrollDirection: Axis.horizontal,
                        itemCount: _mediaUrls.length,
                        itemBuilder: (context, index) {
                          return Stack(
                            children: [
                              Container(
                                width: 150,
                                margin: const EdgeInsets.only(right: 12),
                                decoration: BoxDecoration(
                                  borderRadius: BorderRadius.circular(16),
                                  image: DecorationImage(
                                    image: _mediaUrls[index].startsWith('data:image')
                                        ? MemoryImage(base64Decode(_mediaUrls[index].split(',')[1])) as ImageProvider
                                        : NetworkImage(_mediaUrls[index]),
                                    fit: BoxFit.cover,
                                  ),
                                  border: Border.all(color: AppColors.border),
                                ),
                              ),
                              Positioned(
                                top: 8,
                                right: 20,
                                child: GestureDetector(
                                  onTap: () => setState(() => _mediaUrls.removeAt(index)),
                                  child: Container(
                                    padding: const EdgeInsets.all(4),
                                    decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
                                    child: const Icon(Icons.close, size: 14, color: Colors.white),
                                  ),
                                ),
                              ),
                            ],
                          );
                        },
                      ),
                    ),
                ],
              ),
            ),
          ),

          // Suggested Tags
          SizedBox(
            height: 40,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              itemCount: _suggestedTags.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (_, i) => GestureDetector(
                onTap: () => _appendTag(_suggestedTags[i]),
                child: Chip(
                  label: Text(_suggestedTags[i], style: const TextStyle(fontSize: 12, color: AppColors.primary)),
                  backgroundColor: AppColors.primary.withOpacity(0.05),
                  side: BorderSide(color: AppColors.primary.withOpacity(0.1)),
                  padding: EdgeInsets.zero,
                ),
              ),
            ),
          ),

          // Toolbar
          Container(
            padding: EdgeInsets.only(
              left: 8, right: 16, top: 8,
              bottom: 8 + MediaQuery.of(context).viewInsets.bottom,
            ),
            decoration: BoxDecoration(border: Border(top: BorderSide(color: Theme.of(context).dividerColor))),
            child: Row(
              children: [
                IconButton(icon: const Icon(Icons.image_outlined, color: AppColors.primary), onPressed: _addMedia),
                IconButton(icon: const Icon(Icons.auto_awesome_rounded, color: AppColors.badgeAI), onPressed: _generateWithAI),
                if (!_postingAsAi)
                  IconButton(tooltip: 'Write with your AI', icon: const Icon(Icons.smart_toy_outlined, color: AppColors.primary), onPressed: _writeWithAccountAi),
                IconButton(icon: Icon(Icons.schedule_rounded, color: _isScheduled ? AppColors.secondary : AppColors.textTertiary), onPressed: _selectSchedule),
                const Spacer(),
                SizedBox(
                  width: 24, height: 24,
                  child: CircularProgressIndicator(
                    value: progress.clamp(0.0, 1.0),
                    strokeWidth: 2,
                    backgroundColor: AppColors.border,
                    color: _charCount > _maxChars ? AppColors.error : AppColors.primary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
