import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:just_audio/just_audio.dart';
import 'package:record/record.dart';
import 'package:video_player/video_player.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:path_provider/path_provider.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../../config/app_config.dart';
import '../../models/message_model.dart';
import '../../providers/auth_provider.dart';
import '../../providers/messaging_provider.dart';
import '../../widgets/avatar_widget.dart';
import '../../theme/app_theme.dart';

bool _isAudioMediaUrl(String url) {
  return url.startsWith('data:audio/') ||
      RegExp(r'\.(mp3|wav|m4a|aac|ogg)$', caseSensitive: false).hasMatch(url);
}

bool _isVideoMediaUrl(String url) {
  return url.startsWith('data:video/') ||
      RegExp(r'\.(mp4|mov|m4v|webm)$', caseSensitive: false).hasMatch(url);
}

bool _isAudioMediaType(String? mediaType) => mediaType == 'audio';
bool _isVideoMediaType(String? mediaType) => mediaType == 'video';

class ChatDetailScreen extends ConsumerStatefulWidget {
  final String conversationId;
  final Conversation conversation;

  const ChatDetailScreen({
    super.key,
    required this.conversationId,
    required this.conversation,
  });

  @override
  ConsumerState<ChatDetailScreen> createState() => _ChatDetailScreenState();
}

class _ChatDetailScreenState extends ConsumerState<ChatDetailScreen> {
  final _messageCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();
  bool _isSending = false;

  // Voice recording
  final AudioRecorder _recorder = AudioRecorder();
  bool _isRecording = false;
  String? _recordingPath;
  Duration _recordingDuration = Duration.zero;
  Timer? _recordingTimer;

  // Selection mode
  bool _isSelectionMode = false;
  final Set<String> _selectedMessageIds = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final notifier = ref.read(messagingProvider.notifier);
      notifier.reconnectSocket();
      notifier.setActiveConversation(widget.conversation.id);
      notifier.loadConversationMessages(widget.conversationId);
    });
  }

  @override
  void dispose() {
    ref.read(messagingProvider.notifier).setActiveConversation('');
    _messageCtrl.dispose();
    _scrollCtrl.dispose();
    _recorder.dispose();
    _recordingTimer?.cancel();
    super.dispose();
  }

  Future<void> _sendMessage() async {
    if (_messageCtrl.text.trim().isEmpty) return;

    setState(() => _isSending = true);

    try {
      await ref.read(messagingProvider.notifier).sendMessage(
            widget.conversation,
            _messageCtrl.text.trim(),
          );
      _messageCtrl.clear();

      Future.delayed(const Duration(milliseconds: 200), () {
        if (_scrollCtrl.hasClients) {
          _scrollCtrl.animateTo(
            _scrollCtrl.position.maxScrollExtent,
            duration: const Duration(milliseconds: 300),
            curve: Curves.easeOut,
          );
        }
      });
    } finally {
      if (mounted) {
        setState(() => _isSending = false);
      }
    }
  }

  Future<void> _sendMediaMessage({
    required ImageSource? imageSource,
    required bool isVideo,
  }) async {
    // Check permissions
    if (imageSource == ImageSource.camera) {
      if (!await Permission.camera.request().isGranted) {
        _showPermissionDenied('Camera');
        return;
      }
    } else {
      if (Platform.isAndroid) {
        // Android 13+ permissions
        final status = await Permission.photos.status;
        if (!status.isGranted) {
          await [Permission.photos, Permission.videos].request();
        }
      } else {
        if (!await Permission.photos.request().isGranted) {
          _showPermissionDenied('Photos');
          return;
        }
      }
    }

    final picker = ImagePicker();
    final picked = isVideo
        ? await picker.pickVideo(source: imageSource ?? ImageSource.gallery)
        : await picker.pickImage(source: imageSource ?? ImageSource.gallery);
    if (picked == null) return;

    setState(() => _isSending = true);
    try {
      final bytes = await picked.readAsBytes();
      final base64Data = base64Encode(bytes);
      String extension = picked.path.split('.').last.toLowerCase();
      if (extension.length > 5 || !RegExp(r'^[a-z0-9]+$').hasMatch(extension)) {
        extension = isVideo ? 'mp4' : 'jpg';
      }
      final mimeType = isVideo ? 'video/$extension' : 'image/$extension';

      await ref.read(messagingProvider.notifier).sendMessage(
            widget.conversation,
            _messageCtrl.text.trim(),
            mediaUrl: 'data:$mimeType;base64,$base64Data',
            mediaType: isVideo ? 'video' : 'image',
          );
      _messageCtrl.clear();
    } finally {
      if (mounted) {
        setState(() => _isSending = false);
      }
    }
  }

  void _showPermissionDenied(String feature) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('$feature permission is required to send this attachment.'),
        action: SnackBarAction(
          label: 'Settings',
          onPressed: () => openAppSettings(),
        ),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  Future<void> _startRecording() async {
    if (_isRecording) return;
    final granted = await Permission.microphone.request();
    if (!granted.isGranted) {
      _showPermissionDenied('Microphone');
      return;
    }
    try {
      final dir = await getTemporaryDirectory();
      _recordingPath =
          '${dir.path}/voice_${DateTime.now().millisecondsSinceEpoch}.m4a';
      await _recorder.start(
        const RecordConfig(encoder: AudioEncoder.aacLc, bitRate: 128000),
        path: _recordingPath!,
      );
      _recordingDuration = Duration.zero;
      _recordingTimer =
          Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted) {
          setState(() {
            _recordingDuration += const Duration(seconds: 1);
          });
        }
      });
      HapticFeedback.mediumImpact();
      if (mounted) setState(() => _isRecording = true);
    } catch (e) {
      debugPrint('Recording error: $e');
    }
  }

  Future<void> _stopAndSendRecording() async {
    if (!_isRecording) return;
    _recordingTimer?.cancel();
    try {
      final path = await _recorder.stop();
      if (mounted) setState(() => _isRecording = false);
      if (path == null || _recordingDuration.inSeconds < 1) return;

      final file = File(path);
      final bytes = await file.readAsBytes();
      final base64Data = base64Encode(bytes);
      final mediaUrl = 'data:audio/m4a;base64,$base64Data';

      setState(() => _isSending = true);
      try {
        await ref.read(messagingProvider.notifier).sendMessage(
              widget.conversation,
              '',
              mediaUrl: mediaUrl,
              mediaType: 'audio',
            );
      } finally {
        if (mounted) setState(() => _isSending = false);
      }
    } catch (e) {
      if (mounted) setState(() => _isRecording = false);
      debugPrint('Stop recording error: $e');
    }
  }

  Future<void> _cancelRecording() async {
    if (!_isRecording) return;
    _recordingTimer?.cancel();
    await _recorder.stop();
    if (mounted) setState(() => _isRecording = false);
    HapticFeedback.lightImpact();
  }

  void _showAttachmentSheet() {
    showModalBottomSheet(
      context: context,
      useRootNavigator: true, // above the home screen's frosted bar
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        decoration: BoxDecoration(
          color: Theme.of(ctx).cardColor,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: SafeArea(
          top: false,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(height: 12),
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Theme.of(ctx).dividerColor,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 12),
              const ListTile(
                title: Text(
                  'Send Attachment',
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
              ),
              ListTile(
                leading: const Icon(Icons.photo_library_outlined),
                title: const Text('Photo'),
                onTap: () {
                  Navigator.pop(ctx);
                  _sendMediaMessage(
                    imageSource: ImageSource.gallery,
                    isVideo: false,
                  );
                },
              ),
              ListTile(
                leading: const Icon(Icons.videocam_outlined),
                title: const Text('Video'),
                onTap: () {
                  Navigator.pop(ctx);
                  _sendMediaMessage(
                    imageSource: ImageSource.gallery,
                    isVideo: true,
                  );
                },
              ),
              // Camera photo option
              ListTile(
                leading: const Icon(Icons.camera_alt_outlined),
                title: const Text('Take Photo'),
                onTap: () {
                  Navigator.pop(ctx);
                  _sendMediaMessage(
                    imageSource: ImageSource.camera,
                    isVideo: false,
                  );
                },
              ),
              const SizedBox(height: 12),
            ],
          ),
        ),
      ),
    );
  }

  void _showMessageOptions(Message message, bool isMe) {
    if (_isSelectionMode) return;
    showModalBottomSheet(
      context: context,
      useRootNavigator: true, // above the home screen's frosted bar
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        decoration: BoxDecoration(
          color: Theme.of(ctx).cardColor,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: SafeArea(
          top: false,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(height: 12),
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Theme.of(ctx).dividerColor,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 16),
              // Emoji Reactions
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: ['â¤ï¸', 'ðŸ˜‚', 'ðŸ˜®', 'ðŸ˜¢', 'ðŸ˜¡', 'ðŸ‘'].map((emoji) {
                    return GestureDetector(
                      onTap: () {
                        ref.read(messagingProvider.notifier).reactToMessage(widget.conversation.id, message.id, emoji);
                        Navigator.pop(ctx);
                      },
                      child: Text(emoji, style: const TextStyle(fontSize: 28)),
                    );
                  }).toList(),
                ),
              ),
              const Divider(height: 32),
              ListTile(
                leading: const Icon(Icons.copy_rounded),
                title: const Text('Copy Text'),
                onTap: () {
                  Clipboard.setData(ClipboardData(text: message.content));
                  Navigator.pop(ctx);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Copied to clipboard'), behavior: SnackBarBehavior.floating),
                  );
                },
              ),
              ListTile(
                leading: const Icon(Icons.reply_rounded),
                title: const Text('Forward'),
                onTap: () {
                  Navigator.pop(ctx);
                  _toggleSelectionMode(message);
                },
              ),
              ListTile(
                leading: const Icon(Icons.check_box_outlined),
                title: const Text('Select'),
                onTap: () {
                  Navigator.pop(ctx);
                  _toggleSelectionMode(message);
                },
              ),
              if (isMe)
                ListTile(
                  leading: const Icon(Icons.undo_rounded, color: Colors.red),
                  title: const Text('Unsend Message', style: TextStyle(color: Colors.red)),
                  onTap: () {
                    ref.read(messagingProvider.notifier).unsendMessage(widget.conversation.id, message.id);
                    Navigator.pop(ctx);
                  },
                ),
              ListTile(
                leading: const Icon(Icons.delete_outline, color: Colors.red),
                title: const Text('Delete for me', style: TextStyle(color: Colors.red)),
                onTap: () {
                  ref.read(messagingProvider.notifier).deleteMessage(widget.conversation.id, message.id);
                  Navigator.pop(ctx);
                },
              ),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }

  void _toggleSelectionMode(Message? message) {
    setState(() {
      _isSelectionMode = !_isSelectionMode;
      _selectedMessageIds.clear();
      if (_isSelectionMode && message != null) {
        _selectedMessageIds.add(message.id);
      }
    });
  }

  void _toggleMessageSelection(String messageId) {
    setState(() {
      if (_selectedMessageIds.contains(messageId)) {
        _selectedMessageIds.remove(messageId);
        if (_selectedMessageIds.isEmpty) {
          _isSelectionMode = false;
        }
      } else {
        _selectedMessageIds.add(messageId);
      }
    });
  }

  Future<void> _handleDeleteSelected() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Messages'),
        content: Text('Delete ${_selectedMessageIds.length} messages for you?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      final notifier = ref.read(messagingProvider.notifier);
      for (final id in _selectedMessageIds) {
        await notifier.deleteMessage(widget.conversation.id, id);
      }
      _toggleSelectionMode(null);
    }
  }

  Future<void> _handleForwardSelected() async {
    final messagingState = ref.read(messagingProvider);
    final messages = messagingState.messagesByConversation[widget.conversation.id]
            ?.where((m) => _selectedMessageIds.contains(m.id))
            .toList() ?? [];

    if (messages.isEmpty) return;

    final targets = await showModalBottomSheet<List<Conversation>>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => _ForwardPicker(conversations: messagingState.conversations),
    );

    if (targets != null && targets.isNotEmpty) {
      await ref.read(messagingProvider.notifier).forwardMessages(messages, targets);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Forwarded to ${targets.length} chats'), behavior: SnackBarBehavior.floating),
        );
        _toggleSelectionMode(null);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    // Module 16: ALT's safety check on a message just sent (not delivered; the person decides).
    ref.listen<MessagingState>(messagingProvider, (prev, next) {
      final notice = next.safetyNotice;
      if (notice == null || identical(notice, prev?.safetyNotice) || !mounted) return;
      final notifier = ref.read(messagingProvider.notifier);
      if (notice.blocked) {
        notifier.dismissSafetyNotice();
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(notice.message)));
        return;
      }
      showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Before you send'),
          content: Text(notice.message),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Edit message')),
            TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Send anyway')),
          ],
        ),
      ).then((send) => send == true ? notifier.confirmSafetyNotice() : notifier.dismissSafetyNotice());
    });
    final messagingState = ref.watch(messagingProvider);
    final messages =
        messagingState.messagesByConversation[widget.conversation.id] ?? [];
    final activeId = ref.watch(authStateProvider).activeProfileId;

    return Scaffold(
      resizeToAvoidBottomInset: false,
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        elevation: 0,
        title: _isSelectionMode 
            ? Text('${_selectedMessageIds.length} selected')
            : _buildAppBarTitle(),
        leading: IconButton(
          icon: Icon(_isSelectionMode ? Icons.close : Icons.arrow_back_ios_new, 
              size: _isSelectionMode ? 24 : 20),
          onPressed: () {
            if (_isSelectionMode) {
              _toggleSelectionMode(null);
            } else {
              context.pop();
            }
          },
        ),
        actions: _isSelectionMode ? [
          IconButton(
            icon: const Icon(Icons.reply_rounded),
            onPressed: _handleForwardSelected,
          ),
          IconButton(
            icon: const Icon(Icons.delete_outline_rounded),
            onPressed: _handleDeleteSelected,
          ),
        ] : null,
      ),
      body: Column(
        children: [
          Expanded(
            child: messages.isEmpty
                ? _buildEmptyState()
                : ListView.builder(
                    controller: _scrollCtrl,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 12,
                    ),
                    itemCount: messages.length,
                    itemBuilder: (context, index) {
                      final message = messages[index];
                      final isCurrentUser = message.senderId == activeId;

                      return _buildMessageBubble(
                        message: message,
                        isCurrentUser: isCurrentUser,
                      );
                    },
                  ),
          ),
          Container(
            decoration: BoxDecoration(
              color: Theme.of(context).cardColor,
              border: Border(
                top: BorderSide(color: Theme.of(context).dividerColor, width: 0.5),
              ),
            ),
            padding: EdgeInsets.only(
              left: 16,
              right: 16,
              top: 12,
              bottom: MediaQuery.of(context).viewInsets.bottom + 12,
            ),
            child: Row(
              children: [
                IconButton(
                  onPressed: _isSending ? null : _showAttachmentSheet,
                  icon: const Icon(
                    Icons.add_circle_outline_rounded,
                    color: AppColors.textSecondary,
                  ),
                  tooltip: 'Attach',
                ),
                Expanded(
                  child: TextField(
                    controller: _messageCtrl,
                    enabled: !_isSending,
                    maxLines: null,
                    textInputAction: TextInputAction.send,
                    onSubmitted: _isSending ? null : (_) => _sendMessage(),
                    decoration: InputDecoration(
                      hintText: 'Message...',
                      hintStyle: const TextStyle(
                        color: AppColors.textTertiary,
                        fontSize: 14,
                      ),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(24),
                        borderSide: BorderSide(color: Theme.of(context).dividerColor),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(24),
                        borderSide: BorderSide(color: Theme.of(context).dividerColor),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(24),
                        borderSide: const BorderSide(
                          color: AppColors.primary,
                          width: 1.5,
                        ),
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 10,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 4),
                if (_messageCtrl.text.trim().isEmpty)
                  _isRecording
                    ? _buildRecordingRow()
                    : Listener(
                        onPointerDown: (_) => _startRecording(),
                        onPointerUp: (_) => _stopAndSendRecording(),
                        onPointerCancel: (_) => _cancelRecording(),
                        child: Container(
                          width: 40,
                          height: 40,
                          decoration: const BoxDecoration(
                            color: AppColors.primary,
                            shape: BoxShape.circle,
                          ),
                          child: const Tooltip(
                            message: 'Hold to record',
                            child: Icon(
                              Icons.mic_rounded,
                              size: 20,
                              color: Colors.white,
                            ),
                          ),
                        ),
                      )
                else
                  GestureDetector(
                    onTap: _isSending ? null : _sendMessage,
                    child: Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: _isSending
                            ? AppColors.textTertiary
                            : AppColors.primary,
                        shape: BoxShape.circle,
                      ),
                      child: _isSending
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                valueColor:
                                    AlwaysStoppedAnimation<Color>(Colors.white),
                              ),
                            )
                          : const Icon(Icons.send, size: 18, color: Colors.white),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
  /// Compact recording indicator shown inside the input row while recording
  Widget _buildRecordingRow() {
    final seconds = _recordingDuration.inSeconds;
    final mins = (seconds ~/ 60).toString().padLeft(2, '0');
    final secs = (seconds % 60).toString().padLeft(2, '0');

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Cancel
        GestureDetector(
          onTap: _cancelRecording,
          child: const Icon(Icons.close, color: AppColors.error, size: 22),
        ),
        const SizedBox(width: 6),
        // Pulsing red dot
        TweenAnimationBuilder<double>(
          tween: Tween(begin: 0.4, end: 1.0),
          duration: const Duration(milliseconds: 600),
          builder: (_, v, __) => Opacity(
            opacity: v,
            child: const Icon(Icons.circle, color: AppColors.error, size: 10),
          ),
        ),
        const SizedBox(width: 4),
        Text(
          '$mins:$secs',
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: AppColors.error,
          ),
        ),
        const SizedBox(width: 6),
        // Release to send hint
        const Text(
          'Release to send',
          style: TextStyle(fontSize: 11, color: AppColors.textSecondary),
        ),
      ],
    );
  }

  Widget _buildAppBarTitle() {
    return Row(
      children: [
        AvatarWidget(
          avatarUrl: widget.conversation.userAvatarUrl,
          displayName: widget.conversation.userName,
          isAI: widget.conversation.userIsAI,
          radius: 18,
        ),
        const SizedBox(width: 12),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  widget.conversation.userName,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (widget.conversation.userIsVerified) ...[
                  const SizedBox(width: 4),
                  Icon(
                    Icons.verified,
                    size: 14,
                    color: widget.conversation.userIsAI
                        ? AppColors.badgeAI
                        : AppColors.badgeVerified,
                  ),
                ],
              ],
            ),
            Text(
              widget.conversation.userIsAI ? 'AI Persona' : 'Direct messages',
              style:
                  const TextStyle(fontSize: 12, color: AppColors.textTertiary),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 80,
            height: 80,
            decoration: BoxDecoration(
              color: Theme.of(context).dividerColor.withOpacity(0.1),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.chat_outlined,
              size: 40,
              color: AppColors.textTertiary,
            ),
          ),
          const SizedBox(height: 20),
          Text(
            'Start a conversation',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 8),
          Text(
            'Say hello to ${widget.conversation.userName}',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ],
      ),
    );
  }

  Widget _buildMessageBubble({
    required Message message,
    required bool isCurrentUser,
  }) {
    if (message.isUnsended) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          mainAxisAlignment: isCurrentUser ? MainAxisAlignment.end : MainAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                border: Border.all(color: Theme.of(context).dividerColor),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Text(
                isCurrentUser ? 'You unsent a message' : 'Message unsent',
                style: TextStyle(
                  fontSize: 12,
                  fontStyle: FontStyle.italic,
                  color: Theme.of(context).colorScheme.onSurface.withOpacity(0.5),
                ),
              ),
            ),
          ],
        ),
      );
    }

    final sharedPost = SharedPostPreview.fromMessageContent(message.content);
    final mediaUrl = message.mediaUrl;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        mainAxisAlignment:
            isCurrentUser ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (!isCurrentUser) ...[
            AvatarWidget(
              avatarUrl: message.senderAvatarUrl,
              displayName: message.senderName,
              radius: 16,
              isAI: widget.conversation.userIsAI,
            ),
            const SizedBox(width: 8),
          ],
          GestureDetector(
            onLongPress: () => _showMessageOptions(message, isCurrentUser),
            onTap: _isSelectionMode ? () => _toggleMessageSelection(message.id) : null,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (_isSelectionMode)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: Icon(
                      _selectedMessageIds.contains(message.id)
                          ? Icons.check_circle_rounded
                          : Icons.circle_outlined,
                      color: _selectedMessageIds.contains(message.id)
                          ? AppColors.primary
                          : AppColors.textTertiary,
                      size: 20,
                    ),
                  ),
                Column(
                  crossAxisAlignment:
                      isCurrentUser ? CrossAxisAlignment.end : CrossAxisAlignment.start,
                  children: [
                    if (message.isForwarded)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 4, left: 4),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.reply_rounded, size: 12, color: AppColors.textTertiary.withOpacity(0.7)),
                            const SizedBox(width: 4),
                            Text(
                              'Forwarded',
                              style: TextStyle(
                                fontSize: 10,
                                fontStyle: FontStyle.italic,
                                color: AppColors.textTertiary.withOpacity(0.7),
                              ),
                            ),
                          ],
                        ),
                      ),
                    Container(
                      constraints: BoxConstraints(
                        maxWidth: MediaQuery.of(context).size.width * 0.7,
                      ),
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      decoration: BoxDecoration(
                        color: isCurrentUser
                            ? AppColors.primary
                            : Theme.of(context).dividerColor.withOpacity(0.1),
                        borderRadius: BorderRadius.only(
                          topLeft: const Radius.circular(20),
                          topRight: const Radius.circular(20),
                          bottomLeft: Radius.circular(isCurrentUser ? 20 : 0),
                          bottomRight: Radius.circular(isCurrentUser ? 0 : 20),
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (sharedPost != null) ...[
                            if ((sharedPost.note ?? '').trim().isNotEmpty)
                              Padding(
                                padding: const EdgeInsets.only(bottom: 8),
                                child: _buildMessageText(
                                  sharedPost.note!.trim(),
                                  isCurrentUser,
                                ),
                              ),
                            _SharedPostPreviewCard(
                              preview: sharedPost,
                              isCurrentUser: isCurrentUser,
                            ),
                          ] else ...[
                            if (message.content.isNotEmpty)
                              _buildMessageText(message.content, isCurrentUser),
                            if (mediaUrl != null && mediaUrl.isNotEmpty)
                              Padding(
                                padding: EdgeInsets.only(
                                  top: message.content.isNotEmpty ? 8 : 0,
                                ),
                                child: _MessageMediaPreview(
                                  mediaUrl: mediaUrl,
                                  mediaType: message.mediaType,
                                  isCurrentUser: isCurrentUser,
                                  status: message.status,
                                  onPlayed: () => ref
                                      .read(messagingProvider.notifier)
                                      .markVoiceMessagePlayed(
                                        message.conversationId,
                                        message.id,
                                      ),
                                ),
                              ),
                          ],
                        ],
                      ),
                    ),
                    if (message.reactions.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Wrap(
                          spacing: 4,
                          children: message.reactions.map((r) {
                            return Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: Theme.of(context).cardColor,
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: Theme.of(context).dividerColor, width: 0.5),
                                boxShadow: [
                                  BoxShadow(color: Colors.black.withOpacity(0.05), blurRadius: 2),
                                ],
                              ),
                              child: Text(r.emoji, style: const TextStyle(fontSize: 12)),
                            );
                          }).toList(),
                        ),
                      ),
                    const SizedBox(height: 2),
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          '${message.createdAt.hour}:${message.createdAt.minute.toString().padLeft(2, '0')}',
                          style: TextStyle(
                            fontSize: 10,
                            color: AppColors.textTertiary,
                          ),
                        ),
                        if (isCurrentUser) ...[
                          const SizedBox(width: 4),
                          _buildStatusIndicator(message),
                        ],
                      ],
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatusIndicator(Message message) {
    final status = message.status;
    IconData icon;
    Color color = AppColors.textTertiary;

    switch (status) {
      case 'played':
        icon = Icons.done_all_rounded;
        color = AppColors.primary;
        break;
      case 'read':
        icon = Icons.done_all_rounded;
        color = AppColors.primary;
        break;
      case 'delivered':
        icon = Icons.done_all_rounded;
        break;
      case 'sent':
      default:
        icon = Icons.done_rounded;
        break;
    }

    final isPlayedVoice = status == 'played' &&
        (_isAudioMediaType(message.mediaType) ||
            _isAudioMediaUrl(message.mediaUrl ?? ''));
    if (isPlayedVoice) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 3),
          Text(
            'Played',
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w600,
              color: color,
            ),
          ),
        ],
      );
    }

    return Icon(icon, size: 14, color: color);
  }

  Widget _buildMessageText(String text, bool isCurrentUser) {
    final urlRegExp = RegExp(
      r'((https?:\/\/)|(www\.))[^\s/$.?#].[^\s]*',
      caseSensitive: false,
    );

    final matches = urlRegExp.allMatches(text).toList();
    if (matches.isEmpty) {
      return Text(
        text,
        style: TextStyle(
          fontSize: 14,
          color: isCurrentUser ? Colors.white : Theme.of(context).colorScheme.onSurface,
        ),
      );
    }

    final spans = <InlineSpan>[];
    int lastMatchEnd = 0;
    for (final match in matches) {
      if (match.start > lastMatchEnd) {
        spans.add(TextSpan(
          text: text.substring(lastMatchEnd, match.start),
          style: TextStyle(
            fontSize: 14,
            color: isCurrentUser ? Colors.white : Theme.of(context).colorScheme.onSurface,
          ),
        ));
      }

      final url = text.substring(match.start, match.end);
      spans.add(WidgetSpan(
        alignment: PlaceholderAlignment.middle,
        child: GestureDetector(
          onTap: () async {
            final uri = Uri.parse(url.startsWith('http') ? url : 'https://$url');
            if (await canLaunchUrl(uri)) {
              await launchUrl(uri, mode: LaunchMode.externalApplication);
            }
          },
          child: Text(
            url,
            style: TextStyle(
              fontSize: 14,
              color: isCurrentUser ? Colors.white : AppColors.primary,
              decoration: TextDecoration.underline,
              decorationColor: isCurrentUser ? Colors.white : AppColors.primary,
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
      ));
      lastMatchEnd = match.end;
    }

    if (lastMatchEnd < text.length) {
      spans.add(TextSpan(
        text: text.substring(lastMatchEnd),
        style: TextStyle(
          fontSize: 14,
          color: isCurrentUser ? Colors.white : Theme.of(context).colorScheme.onSurface,
        ),
      ));
    }

    return RichText(
      text: TextSpan(children: spans),
    );
  }
}

class _SharedPostPreviewCard extends StatelessWidget {
  final SharedPostPreview preview;
  final bool isCurrentUser;

  const _SharedPostPreviewCard({
    required this.preview,
    required this.isCurrentUser,
  });

  @override
  Widget build(BuildContext context) {
    final textColor =
        isCurrentUser ? Colors.white : Theme.of(context).colorScheme.onSurface;

    return GestureDetector(
      onTap: () => context.push('/post/${preview.postId}'),
      child: Container(
        width: 240,
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: isCurrentUser
              ? Colors.white.withOpacity(0.1)
              : Theme.of(context).cardColor.withOpacity(0.5),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isCurrentUser
                ? Colors.white.withOpacity(0.2)
                : Theme.of(context).dividerColor.withOpacity(0.3),
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.05),
              blurRadius: 10,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        preview.authorName,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: textColor,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      Text(
                        '@${preview.authorUsername}',
                        style: TextStyle(
                          fontSize: 11,
                          color: textColor.withOpacity(0.6),
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                Icon(Icons.open_in_new_rounded, size: 14, color: textColor.withOpacity(0.5)),
              ],
            ),
            if (preview.mediaUrl != null && preview.mediaUrl!.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 10, bottom: 8),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: _buildMedia(context, textColor),
                ),
              ),
            const SizedBox(height: 4),
            Text(
              preview.content.isEmpty ? 'Shared a post' : preview.content,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 13,
                color: textColor.withOpacity(0.9),
                height: 1.3,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMedia(BuildContext context, Color textColor) {
    final mediaUrl = preview.mediaUrl!;
    if (_isAudioMediaUrl(mediaUrl)) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 20),
        color: Colors.black.withOpacity(0.1),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.mic_rounded, size: 20, color: textColor),
            const SizedBox(width: 8),
            Text('Voice note', style: TextStyle(color: textColor, fontSize: 12)),
          ],
        ),
      );
    }

    if (_isVideoMediaUrl(mediaUrl)) {
      return Container(
        width: double.infinity,
        height: 130,
        color: Colors.black.withOpacity(0.2),
        child: Icon(Icons.play_circle_fill_rounded, size: 40, color: textColor),
      );
    }

    if (mediaUrl.startsWith('data:')) {
      final base64Data = mediaUrl.split(',').last;
      return Image.memory(
        base64Decode(base64Data),
        width: double.infinity,
        height: 130,
        fit: BoxFit.cover,
        errorBuilder: (context, error, stackTrace) => Container(
          color: Colors.black12,
          child: const Icon(Icons.broken_image_outlined, color: Colors.grey),
        ),
      );
    }

    return CachedNetworkImage(
      imageUrl: AppConfig.resolveUrl(mediaUrl),
      width: double.infinity,
      height: 130,
      fit: BoxFit.cover,
      placeholder: (context, url) => Container(
        color: Colors.black12,
        child: const Center(child: CircularProgressIndicator(strokeWidth: 2)),
      ),
      errorWidget: (context, url, error) => Container(
        color: Colors.black12,
        child: const Icon(Icons.broken_image_outlined, color: Colors.grey),
      ),
    );
  }
}

class _MessageMediaPreview extends StatelessWidget {
  final String mediaUrl;
  final String? mediaType;
  final bool isCurrentUser;
  final String status;
  final VoidCallback? onPlayed;

  const _MessageMediaPreview({
    required this.mediaUrl,
    this.mediaType,
    required this.isCurrentUser,
    required this.status,
    this.onPlayed,
  });

  @override
  Widget build(BuildContext context) {
    final resolvedUrl = AppConfig.resolveUrl(mediaUrl);

    if (_isAudioMediaType(mediaType) || _isAudioMediaUrl(resolvedUrl)) {
      return _MessageAudioPreview(
        url: resolvedUrl,
        isCurrentUser: isCurrentUser,
        status: status,
        onPlayed: onPlayed,
      );
    }
    if (_isVideoMediaType(mediaType) || _isVideoMediaUrl(resolvedUrl)) {
      return _MessageVideoPreview(url: resolvedUrl);
    }

    if (resolvedUrl.startsWith('data:')) {
      final base64Data = resolvedUrl.split(',').last;
      return GestureDetector(
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => _FullScreenMediaViewer(
                url: resolvedUrl,
                type: 'image',
              ),
            ),
          );
        },
        child: ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: Image.memory(
            base64Decode(base64Data),
            width: 220,
            height: 220,
            fit: BoxFit.cover,
            errorBuilder: (context, error, stackTrace) => Container(
              width: 220,
              height: 220,
              color: AppColors.error.withOpacity(0.1),
              child: const Icon(Icons.broken_image, color: AppColors.error),
            ),
          ),
        ),
      );
    }

    return GestureDetector(
      onTap: () {
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => _FullScreenMediaViewer(
              url: resolvedUrl,
              type: 'image',
            ),
          ),
        );
      },
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: CachedNetworkImage(
          imageUrl: resolvedUrl,
          width: 220,
          height: 220,
          fit: BoxFit.cover,
          placeholder: (context, url) => Container(
            width: 220,
            height: 220,
            color: Theme.of(context).dividerColor.withOpacity(0.1),
            child: const Center(child: CircularProgressIndicator(strokeWidth: 2)),
          ),
          errorWidget: (context, url, error) => Container(
            width: 220,
            height: 220,
            color: AppColors.error.withOpacity(0.1),
            child: const Icon(Icons.broken_image, color: AppColors.error),
          ),
        ),
      ),
    );
  }
}

class _FullScreenMediaViewer extends StatelessWidget {
  final String url;
  final String type;

  const _FullScreenMediaViewer({required this.url, required this.type});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        iconTheme: const IconThemeData(color: Colors.white),
        elevation: 0,
      ),
      body: Center(
        child: type == 'image'
            ? InteractiveViewer(
                child: url.startsWith('data:')
                    ? Image.memory(
                        base64Decode(url.split(',').last),
                        fit: BoxFit.contain,
                        errorBuilder: (context, error, stackTrace) =>
                            const Icon(Icons.error, color: Colors.white),
                      )
                    : CachedNetworkImage(
                        imageUrl: url,
                        fit: BoxFit.contain,
                        placeholder: (context, url) =>
                            const CircularProgressIndicator(),
                        errorWidget: (context, url, error) =>
                            const Icon(Icons.error, color: Colors.white),
                      ),
              )
            : _MessageVideoPreview(url: url, isFullScreen: true),
      ),
    );
  }
}

class _MessageVideoPreview extends StatefulWidget {
  final String url;
  final bool isFullScreen;

  const _MessageVideoPreview({required this.url, this.isFullScreen = false});

  @override
  State<_MessageVideoPreview> createState() => _MessageVideoPreviewState();
}

class _MessageVideoPreviewState extends State<_MessageVideoPreview> {
  late final VideoPlayerController _controller;
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    _controller = VideoPlayerController.networkUrl(Uri.parse(widget.url))
      ..initialize().then((_) {
        if (mounted) setState(() => _ready = true);
      });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_ready) {
      return Container(
        width: widget.isFullScreen ? double.infinity : 220,
        height: widget.isFullScreen ? double.infinity : 220,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: Theme.of(context).dividerColor.withOpacity(0.15),
          borderRadius: BorderRadius.circular(widget.isFullScreen ? 0 : 12),
        ),
        child: const CircularProgressIndicator(),
      );
    }

    return GestureDetector(
      onTap: () {
        if (!widget.isFullScreen) {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => _FullScreenMediaViewer(
                url: widget.url,
                type: 'video',
              ),
            ),
          );
        } else {
          setState(() {
            _controller.value.isPlaying
                ? _controller.pause()
                : _controller.play();
          });
        }
      },
      child: ClipRRect(
        borderRadius: BorderRadius.circular(widget.isFullScreen ? 0 : 12),
        child: Container(
          width: widget.isFullScreen ? MediaQuery.of(context).size.width : 220,
          child: AspectRatio(
            aspectRatio: _controller.value.aspectRatio == 0
                ? 1
                : _controller.value.aspectRatio,
            child: Stack(
              alignment: Alignment.center,
              children: [
                VideoPlayer(_controller),
                if (!widget.isFullScreen || !_controller.value.isPlaying)
                  Container(
                    width: widget.isFullScreen ? 64 : 44,
                    height: widget.isFullScreen ? 64 : 44,
                    decoration: BoxDecoration(
                      color: Colors.black.withOpacity(0.45),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      _controller.value.isPlaying
                          ? Icons.pause_rounded
                          : Icons.play_arrow_rounded,
                      color: Colors.white,
                      size: widget.isFullScreen ? 32 : 24,
                    ),
                  ),
                if (!widget.isFullScreen)
                  Positioned(
                    bottom: 8,
                    right: 8,
                    child: Container(
                      padding: const EdgeInsets.all(4),
                      decoration: BoxDecoration(
                        color: Colors.black45,
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: const Icon(Icons.fullscreen_rounded, color: Colors.white, size: 18),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _MessageAudioPreview extends StatefulWidget {
  final String url;
  final bool isCurrentUser;
  final String status;
  final VoidCallback? onPlayed;

  const _MessageAudioPreview({
    required this.url,
    required this.isCurrentUser,
    required this.status,
    this.onPlayed,
  });

  @override
  State<_MessageAudioPreview> createState() => _MessageAudioPreviewState();
}

class _MessageAudioPreviewState extends State<_MessageAudioPreview> {
  final AudioPlayer _player = AudioPlayer();
  bool _isPlaying = false;
  Duration _duration = Duration.zero;
  Duration _position = Duration.zero;
  String? _localAudioPath;
  bool _audioReady = false;
  bool _playReported = false;

  @override
  void initState() {
    super.initState();
    _initPlayer();
  }

  Future<void> _initPlayer() async {
    try {
      if (widget.url.startsWith('data:audio/')) {
        final parts = widget.url.split(',');
        if (parts.length == 2) {
          final bytes = base64Decode(parts.last);
          final dir = await getTemporaryDirectory();
          final extensionMatch = RegExp(
            r'data:audio/([\w.+-]+);base64',
          ).firstMatch(parts.first);
          final extension = extensionMatch?.group(1) ?? 'm4a';
          final file = File(
            '${dir.path}/voice_note_${DateTime.now().microsecondsSinceEpoch}.$extension',
          );
          await file.writeAsBytes(bytes, flush: true);
          _localAudioPath = file.path;
          await _player.setFilePath(file.path);
        }
      } else {
        await _player.setUrl(widget.url);
      }
      if (mounted) {
        setState(() => _audioReady = true);
      }
      _player.durationStream.listen((d) {
        if (mounted) setState(() => _duration = d ?? Duration.zero);
      });
      _player.positionStream.listen((p) {
        if (mounted) setState(() => _position = p);
      });
      _player.playerStateStream.listen((state) {
        if (!mounted) return;
        if (state.processingState == ProcessingState.completed) {
          _player.seek(Duration.zero);
          _player.pause();
        }
        setState(() => _isPlaying = state.playing);
      });
    } catch (e) {
      debugPrint('Audio load error: $e');
    }
  }

  @override
  void dispose() {
    _player.dispose();
    final localPath = _localAudioPath;
    if (localPath != null) {
      File(localPath).delete().catchError((_) {});
    }
    super.dispose();
  }

  Future<void> _togglePlayback() async {
    if (!_audioReady) return;
    if (_isPlaying) {
      await _player.pause();
    } else {
      await _player.play();
      if (!widget.isCurrentUser &&
          widget.status != 'played' &&
          !_playReported) {
        _playReported = true;
        widget.onPlayed?.call();
      }
    }
  }

  String _formatDuration(Duration d) {
    final mins = d.inMinutes.toString();
    final secs = (d.inSeconds % 60).toString().padLeft(2, '0');
    return '$mins:$secs';
  }

  @override
  Widget build(BuildContext context) {
    final textColor = widget.isCurrentUser
        ? Colors.white
        : Theme.of(context).colorScheme.onSurface;

    return Container(
      width: 220,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: widget.isCurrentUser
            ? Colors.white.withOpacity(0.12)
            : Theme.of(context).dividerColor.withOpacity(0.12),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              GestureDetector(
                onTap: _audioReady ? _togglePlayback : null,
                child: Icon(
                  _isPlaying ? Icons.pause_circle_filled : Icons.play_circle_fill,
                  color: textColor,
                  size: 32,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SliderTheme(
                      data: SliderTheme.of(context).copyWith(
                        thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 4),
                        overlayShape: const RoundSliderOverlayShape(overlayRadius: 10),
                        trackHeight: 2,
                        activeTrackColor: textColor,
                        inactiveTrackColor: textColor.withOpacity(0.3),
                        thumbColor: textColor,
                      ),
                      child: Slider(
                        value: _position.inMilliseconds.toDouble(),
                        max: _duration.inMilliseconds.toDouble() > 0 
                             ? _duration.inMilliseconds.toDouble() 
                             : 1.0,
                        onChanged: !_audioReady ? null : (v) {
                          _player.seek(Duration(milliseconds: v.toInt()));
                        },
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            _formatDuration(_position),
                            style: TextStyle(color: textColor, fontSize: 10),
                          ),
                          Text(
                            _formatDuration(_duration),
                            style: TextStyle(color: textColor, fontSize: 10),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ForwardPicker extends StatefulWidget {
  final List<Conversation> conversations;
  const _ForwardPicker({required this.conversations});

  @override
  State<_ForwardPicker> createState() => _ForwardPickerState();
}

class _ForwardPickerState extends State<_ForwardPicker> {
  final Set<String> _selectedIds = {};
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final filtered = widget.conversations.where((c) {
      return c.userName.toLowerCase().contains(_query.toLowerCase());
    }).toList();

    return Container(
      height: MediaQuery.of(context).size.height * 0.7,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).scaffoldBackgroundColor,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(
        children: [
          Container(
            width: 40, height: 4,
            margin: const EdgeInsets.only(bottom: 16),
            decoration: BoxDecoration(color: Colors.grey[300], borderRadius: BorderRadius.circular(2)),
          ),
          const Text('Forward to...', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          TextField(
            onChanged: (v) => setState(() => _query = v),
            decoration: InputDecoration(
              hintText: 'Search people...',
              prefixIcon: const Icon(Icons.search),
              filled: true,
              fillColor: Theme.of(context).dividerColor.withOpacity(0.05),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
            ),
          ),
          const SizedBox(height: 16),
          Expanded(
            child: ListView.builder(
              itemCount: filtered.length,
              itemBuilder: (ctx, i) {
                final c = filtered[i];
                final isSelected = _selectedIds.contains(c.id);
                return ListTile(
                  leading: AvatarWidget(avatarUrl: c.userAvatarUrl, displayName: c.userName, isAI: c.userIsAI, radius: 20),
                  title: Text(c.userName),
                  trailing: Icon(isSelected ? Icons.check_circle : Icons.circle_outlined, color: isSelected ? AppColors.primary : null),
                  onTap: () => setState(() => isSelected ? _selectedIds.remove(c.id) : _selectedIds.add(c.id)),
                );
              },
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            height: 50,
            child: FilledButton(
              onPressed: _selectedIds.isEmpty ? null : () {
                final selected = widget.conversations.where((c) => _selectedIds.contains(c.id)).toList();
                Navigator.pop(context, selected);
              },
              child: Text('Forward to  chats'),
            ),
          ),
        ],
      ),
    );
  }
}
