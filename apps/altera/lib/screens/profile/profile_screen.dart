import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:timeago/timeago.dart' as timeago;
import 'package:image_picker/image_picker.dart';
import 'dart:io';
import '../../models/message_model.dart';
import '../../providers/auth_provider.dart';
import '../../providers/saved_posts_provider.dart';
import '../../providers/feed_provider.dart';
import '../../providers/theme_provider.dart';
import '../../services/feed_service.dart';
import '../../services/image_service.dart';
import '../../theme/app_theme.dart';
import '../../widgets/audio_viz.dart';
import '../../widgets/post_card.dart';
import '../../widgets/avatar_widget.dart';
import '../../models/post_model.dart';
import '../../models/user_model.dart';
import 'create_ai_screen.dart';

class ProfileScreen extends ConsumerStatefulWidget {
  final String? profileId;
  final String? profileType;
  const ProfileScreen({super.key, this.profileId, this.profileType});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool _isLoadingOther = false;
  Map<String, dynamic>? _otherProfileData;
  String? _errorOther;

  bool get _showsOwnedProfileView =>
      widget.profileId == null || _isOwnedProfileId(widget.profileId);

  @override
  void initState() {
    super.initState();
    final isMe = _showsOwnedProfileView;
    _tabController = TabController(length: isMe ? 3 : 1, vsync: this);
    if (widget.profileId != null && !_showsOwnedProfileView) {
      _fetchOtherProfile();
    } else {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _fetchOwnedProfile();
      });
    }
  }

  @override
  void didUpdateWidget(ProfileScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.profileId != oldWidget.profileId) {
      _tabController.dispose();
      final isMe = _showsOwnedProfileView;
      _tabController = TabController(length: isMe ? 3 : 1, vsync: this);
      
      if (widget.profileId != null && !_showsOwnedProfileView) {
        _fetchOtherProfile();
      } else {
        setState(() {
          _otherProfileData = null;
          _isLoadingOther = false;
        });
        WidgetsBinding.instance.addPostFrameCallback((_) {
          _fetchOwnedProfile();
        });
      }
    }
  }

  Future<void> _fetchOwnedProfile() async {
    final auth = ref.read(authStateProvider);
    final activeId = auth.activeProfileId;
    final user = auth.user;
    if (activeId == null || user == null) return;

    final isHuman = user.humanProfile?.id == activeId;
    final type = isHuman ? 'human' : 'ai';

    try {
      final data = await ref.read(feedServiceProvider).getProfile(
            activeId,
            type: type,
          );
      if (!mounted || data == null) return;

      setState(() {
        _otherProfileData = data;
      });
    } catch (_) {}
  }

  Future<void> _fetchOtherProfile() async {
    setState(() {
      _isLoadingOther = true;
      _errorOther = null;
    });
    try {
      final data = await ref.read(feedServiceProvider).getProfile(
            widget.profileId!,
            type: widget.profileType ?? 'human',
          );
      if (mounted) {
        if (data != null) {
          final pData = data['visiting_profile'];
          final isMe = _isOwnedProfileId(pData['id'] as String?);
          
          // Re-sync tab controller if isMe changed
          final currentTabs = _tabController.length;
          final targetTabs = isMe ? 3 : 1;
          if (currentTabs != targetTabs) {
            _tabController.dispose();
            _tabController = TabController(length: targetTabs, vsync: this);
          }
        }

        setState(() {
          if (data == null) {
            _errorOther = 'Profile not found or access denied';
          } else {
            _otherProfileData = data;
          }
          _isLoadingOther = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorOther = 'Failed to load profile';
          _isLoadingOther = false;
        });
      }
    }
  }

  void _handleBlockProfile(dynamic profile) async {
    final targetId = profile is Map ? profile['id'] : profile?.id;
    if (targetId == null) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Block User?'),
        content: const Text('Blocked users cannot message you or see your posts. You can unblock them later in settings.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Block', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      final ok = await ref.read(feedServiceProvider).blockProfile(targetId);
      if (ok && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('User blocked')));
        _fetchOtherProfile();
      }
    }
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  void _switchOwnedProfile(String profileId) {
    ref.read(authStateProvider.notifier).switchProfile(profileId);
    _tabController.animateTo(0);

    final user = ref.read(authStateProvider).user;
    final isAI =
        user?.aiProfiles.any((profile) => profile.id == profileId) ?? false;
    final profileType = isAI ? 'ai' : 'human';

    if (!mounted) return;
    context.go('/profile?id=$profileId&type=$profileType');
  }

  bool _isOwnedProfileId(String? profileId) {
    if (profileId == null) return false;

    final user = ref.read(authStateProvider).user;
    if (user?.humanProfile?.id == profileId) {
      return true;
    }

    return user?.aiProfiles.any((profile) => profile.id == profileId) ?? false;
  }

  void _handleProfileSwitcherSelection(String value) {
    if (value == 'create_ai') {
      context.push('/create-ai');
      return;
    }

    if (value.startsWith('profile:')) {
      final profileId = value.substring('profile:'.length);
      if (profileId.isNotEmpty) {
        _switchOwnedProfile(profileId);
      }
    }
  }

  void _showProfileSwitcher(BuildContext context, WidgetRef ref) {
    final auth = ref.read(authStateProvider);
    final user = auth.user;
    final activeId = auth.activeProfileId;
    final humanProfile = user?.humanProfile;
    final aiProfiles = user?.aiProfiles ?? [];

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (sheetContext) => Container(
        decoration: BoxDecoration(
          color: Theme.of(context).cardColor,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        ),
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                    color: Theme.of(context).dividerColor,
                    borderRadius: BorderRadius.circular(2))),
            const SizedBox(height: 16),
            Text('Switch Profile',
                style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                    color: Theme.of(context).colorScheme.onSurface)),
            const SizedBox(height: 16),
            if (humanProfile != null)
              _ProfileSwitchTile(
                emoji: '👤',
                name: humanProfile.displayName,
                username: '@${humanProfile.username}',
                isActive: activeId == humanProfile.id,
                isAI: false,
                avatarUrl: humanProfile.avatar,
                onTap: () {
                  Navigator.pop(sheetContext);
                  _switchOwnedProfile(humanProfile.id);
                },
              ),
            ...aiProfiles.map((ai) => _ProfileSwitchTile(
                  emoji: '🤖',
                  name: ai.displayName,
                  username: '@${ai.username}',
                  isActive: activeId == ai.id,
                  isAI: true,
                  avatarUrl: ai.avatar,
                  token: ai.aitTokenId,
                  onTap: () {
                    Navigator.pop(sheetContext);
                    _switchOwnedProfile(ai.id);
                  },
                )),
            const Divider(height: 24),
            ListTile(
              leading: Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                    color: AppColors.primary.withOpacity(0.1),
                    shape: BoxShape.circle),
                child: const Icon(Icons.add_rounded, color: AppColors.primary),
              ),
              title: const Text('Bring your AI from ALTER',
                  style: TextStyle(
                      fontWeight: FontWeight.w600, color: AppColors.primary)),
              subtitle: const Text('Add an AI you created and verified in ALTER',
                  style:
                      TextStyle(fontSize: 12, color: AppColors.textTertiary)),
              onTap: () {
                Navigator.pop(sheetContext);
                context.push('/create-ai');
              },
            ),
          ],
        ),
      ),
    );
  }

  void _showSimpleDialog(BuildContext context, String title, String message) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx), child: const Text('Close'))
        ],
      ),
    );
  }

  void _showPersonalInfo(BuildContext context) {
    final user = ref.read(authStateProvider).user;
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        height: MediaQuery.of(ctx).size.height * 0.5,
        decoration: BoxDecoration(
            color: Theme.of(context).cardColor,
            borderRadius:
                const BorderRadius.vertical(top: Radius.circular(24))),
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Personal Information',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 24),
            _infoRow('Email', user?.email ?? 'N/A'),
            _infoRow('Username', '@${user?.humanProfile?.username ?? 'user'}'),
            _infoRow('Member Since', 'April 2026'),
            _infoRow('Account Type', 'Premium Human'),
          ],
        ),
      ),
    );
  }

  Widget _infoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style:
                  const TextStyle(fontSize: 12, color: AppColors.textTertiary)),
          const SizedBox(height: 4),
          Text(value,
              style:
                  const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }

  void _showLanguageSelector(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        decoration: BoxDecoration(
            color: Theme.of(context).cardColor,
            borderRadius:
                const BorderRadius.vertical(top: Radius.circular(24))),
        child: ListView(
          shrinkWrap: true,
          children: [
            const Padding(
                padding: EdgeInsets.all(20),
                child: Text('Select Language',
                    style:
                        TextStyle(fontSize: 18, fontWeight: FontWeight.bold))),
            ListTile(
                title: const Text('English (US)'),
                trailing: const Icon(Icons.check, color: AppColors.primary),
                onTap: () => Navigator.pop(ctx)),
            ListTile(
                title: const Text('Spanish'), onTap: () => Navigator.pop(ctx)),
            ListTile(
                title: const Text('French'), onTap: () => Navigator.pop(ctx)),
            ListTile(
                title: const Text('German'), onTap: () => Navigator.pop(ctx)),
          ],
        ),
      ),
    );
  }

  void _showStoryUploadSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
        child: Container(
          decoration: BoxDecoration(
            color: Theme.of(context).cardColor,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(height: 12),
              Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                      color: Theme.of(context).dividerColor,
                      borderRadius: BorderRadius.circular(2))),
              Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Share Your Story',
                        style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                            color: Theme.of(context).colorScheme.onSurface)),
                    const SizedBox(height: 20),
                    const Text(
                      'Stories disappear after 24 hours and help your followers get to know you better.',
                      style: TextStyle(
                          fontSize: 13,
                          color: AppColors.textSecondary,
                          height: 1.5),
                    ),
                    const SizedBox(height: 24),
                    // Upload options
                    _StoryOption(
                      icon: Icons.camera_alt_rounded,
                      title: 'Take a Photo',
                      subtitle: 'Capture a new moment',
                      onTap: () async {
                        Navigator.pop(ctx);
                        final picker = ImagePicker();
                        final image =
                            await picker.pickImage(source: ImageSource.camera);
                        if (image != null && context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Story uploaded successfully!'),
                              behavior: SnackBarBehavior.floating,
                            ),
                          );
                        }
                      },
                    ),
                    const SizedBox(height: 12),
                    _StoryOption(
                      icon: Icons.image_rounded,
                      title: 'Choose from Gallery',
                      subtitle: 'Pick from your photos',
                      onTap: () async {
                        Navigator.pop(ctx);
                        final picker = ImagePicker();
                        final image =
                            await picker.pickImage(source: ImageSource.gallery);
                        if (image != null && context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Story uploaded successfully!'),
                              behavior: SnackBarBehavior.floating,
                            ),
                          );
                        }
                      },
                    ),
                    const SizedBox(height: 12),
                    _StoryOption(
                      icon: Icons.text_fields_rounded,
                      title: 'Text Story',
                      subtitle: 'Create a text-only story',
                      onTap: () {
                        Navigator.pop(ctx);
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Text story feature coming soon!'),
                            behavior: SnackBarBehavior.floating,
                          ),
                        );
                      },
                    ),
                    const SizedBox(height: 20),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showEditProfileSheet(BuildContext context, dynamic profile) {
    final nameCtrl = TextEditingController(text: profile?.displayName ?? '');
    final bioCtrl = TextEditingController(text: profile?.bio ?? '');
    var currentAvatar = profile?.avatar as String?;
    var isUploadingAvatar = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => Container(
          height: MediaQuery.of(context).size.height * 0.9,
          decoration: BoxDecoration(
            color: Theme.of(context).cardColor,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: SafeArea(
            top: false,
            child: Padding(
              padding:
                  EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
              child: Column(
                children: [
                  const SizedBox(height: 12),
                  Container(
                      width: 40,
                      height: 4,
                      decoration: BoxDecoration(
                          color: Theme.of(context).dividerColor,
                          borderRadius: BorderRadius.circular(2))),
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        TextButton(
                            onPressed: () => Navigator.pop(ctx),
                            child: const Text('Cancel')),
                        const Text('Edit Profile',
                            style: TextStyle(
                                fontSize: 17, fontWeight: FontWeight.bold)),
                        TextButton(
                          onPressed: () async {
                            final success = await ref
                                .read(authStateProvider.notifier)
                                .updateProfile(
                                  displayName: nameCtrl.text,
                                  bio: bioCtrl.text,
                                );
                            if (success && context.mounted) {
                              Navigator.pop(ctx);
                              ScaffoldMessenger.of(context)
                                  .showSnackBar(const SnackBar(
                                content: Text('Profile updated successfully!'),
                                behavior: SnackBarBehavior.floating,
                              ));
                            }
                          },
                          child: const Text('Done',
                              style: TextStyle(fontWeight: FontWeight.bold)),
                        ),
                      ],
                    ),
                  ),
                  Divider(
                    height: 1,
                    color: Theme.of(ctx).dividerColor.withOpacity(0.35),
                  ),
                  Expanded(
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.fromLTRB(20, 24, 20, 32),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                        Center(
                          child: Stack(
                            children: [
                              Stack(
                                alignment: Alignment.center,
                                children: [
                                  _buildAvatar(
                                    currentAvatar,
                                    nameCtrl.text.trim().isNotEmpty
                                        ? nameCtrl.text.trim()
                                        : profile?.displayName ?? 'U',
                                  ),
                                  if (isUploadingAvatar)
                                    Container(
                                      width: 82,
                                      height: 82,
                                      decoration: BoxDecoration(
                                        color: Colors.black.withOpacity(0.35),
                                        shape: BoxShape.circle,
                                      ),
                                      child: const Padding(
                                        padding: EdgeInsets.all(24),
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2.5,
                                          color: Colors.white,
                                        ),
                                      ),
                                    ),
                                ],
                              ),
                              Positioned(
                                right: 0,
                                bottom: 0,
                                child: GestureDetector(
                                  onTap: isUploadingAvatar
                                      ? null
                                      : () async {
                                          final source =
                                              await showModalBottomSheet<ImageSource>(
                                            context: ctx,
                                            backgroundColor: Colors.transparent,
                                            builder: (pickerCtx) => Container(
                                              decoration: BoxDecoration(
                                                color: Theme.of(pickerCtx)
                                                    .cardColor,
                                                borderRadius:
                                                    const BorderRadius.vertical(
                                                  top: Radius.circular(24),
                                                ),
                                              ),
                                              child: SafeArea(
                                                top: false,
                                                child: Column(
                                                  mainAxisSize:
                                                      MainAxisSize.min,
                                                  children: [
                                                    const SizedBox(height: 12),
                                                    Container(
                                                      width: 40,
                                                      height: 4,
                                                      decoration: BoxDecoration(
                                                        color:
                                                            Theme.of(pickerCtx)
                                                                .dividerColor,
                                                        borderRadius:
                                                            BorderRadius.circular(
                                                                2),
                                                      ),
                                                    ),
                                                    const SizedBox(height: 12),
                                                    const ListTile(
                                                      title: Text(
                                                        'Change Profile Picture',
                                                        style: TextStyle(
                                                          fontWeight:
                                                              FontWeight.w700,
                                                        ),
                                                      ),
                                                    ),
                                                    ListTile(
                                                      leading: const Icon(Icons
                                                          .photo_camera_outlined),
                                                      title:
                                                          const Text('Take Photo'),
                                                      onTap: () =>
                                                          Navigator.pop(
                                                        pickerCtx,
                                                        ImageSource.camera,
                                                      ),
                                                    ),
                                                    ListTile(
                                                      leading: const Icon(Icons
                                                          .photo_library_outlined),
                                                      title: const Text(
                                                          'Choose from Gallery'),
                                                      onTap: () =>
                                                          Navigator.pop(
                                                        pickerCtx,
                                                        ImageSource.gallery,
                                                      ),
                                                    ),
                                                    const SizedBox(height: 12),
                                                  ],
                                                ),
                                              ),
                                            ),
                                          );

                                          if (source == null) return;

                                          final image = await ImagePicker()
                                              .pickImage(source: source);

                                          if (image == null || !context.mounted) {
                                            return;
                                          }

                                          setModalState(
                                              () => isUploadingAvatar = true);

                                          final avatarUrl = await ImageService()
                                              .updateProfilePicture(
                                            image,
                                            ref
                                                .read(authStateProvider)
                                                .activeProfileId!,
                                          );

                                          if (!context.mounted) return;

                                          setModalState(() {
                                            isUploadingAvatar = false;
                                            if (avatarUrl != null &&
                                                avatarUrl.isNotEmpty) {
                                              currentAvatar = avatarUrl;
                                            }
                                          });

                                          if (avatarUrl != null &&
                                              avatarUrl.isNotEmpty) {
                                            await ref
                                                .read(authStateProvider.notifier)
                                                .refreshProfile();
                                            if (context.mounted) {
                                              ScaffoldMessenger.of(context)
                                                  .showSnackBar(const SnackBar(
                                                content: Text(
                                                    'Profile picture updated successfully!'),
                                                behavior:
                                                    SnackBarBehavior.floating,
                                              ));
                                            }
                                          } else if (context.mounted) {
                                            ScaffoldMessenger.of(context)
                                                .showSnackBar(const SnackBar(
                                              content: Text(
                                                  'Failed to upload profile picture'),
                                              behavior:
                                                  SnackBarBehavior.floating,
                                            ));
                                          }
                                        },
                                  child: Container(
                                    padding: const EdgeInsets.all(6),
                                    decoration: BoxDecoration(
                                        color: AppColors.primary,
                                        shape: BoxShape.circle),
                                    child: const Icon(Icons.camera_alt_rounded,
                                        size: 16, color: Colors.white),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 24),
                        Text(
                          'Profile Details',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            color: Theme.of(ctx).colorScheme.onSurface,
                          ),
                        ),
                        const SizedBox(height: 16),
                        Container(
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: Theme.of(ctx).scaffoldBackgroundColor,
                            borderRadius: BorderRadius.circular(18),
                            border: Border.all(
                              color: Theme.of(ctx).dividerColor.withOpacity(0.28),
                            ),
                          ),
                          child: Column(
                            children: [
                              TextField(
                                controller: nameCtrl,
                                onChanged: (_) => setModalState(() {}),
                                decoration: InputDecoration(
                                  labelText: 'Name',
                                  hintText: 'Enter your name',
                                  floatingLabelBehavior: FloatingLabelBehavior.always,
                                  contentPadding: const EdgeInsets.symmetric(
                                      horizontal: 14, vertical: 14),
                                  border: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(14),
                                    borderSide: BorderSide(
                                        color: Theme.of(ctx)
                                            .dividerColor
                                            .withOpacity(0.3)),
                                  ),
                                  enabledBorder: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(14),
                                    borderSide: BorderSide(
                                        color: Theme.of(ctx)
                                            .dividerColor
                                            .withOpacity(0.3)),
                                  ),
                                  focusedBorder: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(14),
                                    borderSide: const BorderSide(
                                        color: AppColors.primary, width: 1.5),
                                  ),
                                  filled: true,
                                  fillColor: Theme.of(ctx).cardColor,
                                ),
                              ),
                              const SizedBox(height: 14),
                              TextField(
                                controller: bioCtrl,
                                maxLines: 4,
                                minLines: 3,
                                decoration: InputDecoration(
                                  labelText: 'Bio',
                                  hintText: 'Write something about yourself',
                                  floatingLabelBehavior: FloatingLabelBehavior.always,
                                  alignLabelWithHint: true,
                                  contentPadding: const EdgeInsets.symmetric(
                                      horizontal: 14, vertical: 14),
                                  border: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(14),
                                    borderSide: BorderSide(
                                        color: Theme.of(ctx)
                                            .dividerColor
                                            .withOpacity(0.3)),
                                  ),
                                  enabledBorder: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(14),
                                    borderSide: BorderSide(
                                        color: Theme.of(ctx)
                                            .dividerColor
                                            .withOpacity(0.3)),
                                  ),
                                  focusedBorder: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(14),
                                    borderSide: const BorderSide(
                                        color: AppColors.primary, width: 1.5),
                                  ),
                                  filled: true,
                                  fillColor: Theme.of(ctx).cardColor,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          'Your display name and bio update the active profile immediately after saving.',
                          style: TextStyle(
                            fontSize: 12,
                            height: 1.45,
                            color: Theme.of(ctx)
                                .colorScheme
                                .onSurface
                                .withOpacity(0.65),
                          ),
                        ),
                        const SizedBox(height: 24),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  void _showShareProfileSheet(BuildContext context, dynamic profile) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        decoration: BoxDecoration(
          color: Theme.of(context).cardColor,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        padding: const EdgeInsets.symmetric(vertical: 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                    color: Theme.of(context).dividerColor,
                    borderRadius: BorderRadius.circular(2))),
            const SizedBox(height: 20),
            const Text('Share Profile',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold)),
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                _ShareOption(
                    icon: Icons.link_rounded,
                    label: 'Copy Link',
                    color: Colors.blue,
                    onTap: () {
                      Navigator.pop(ctx);
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                          content: Text('Link copied!'),
                          behavior: SnackBarBehavior.floating));
                    }),
                _ShareOption(
                    icon: Icons.qr_code_rounded,
                    label: 'QR Code',
                    color: Colors.purple,
                    onTap: () {}),
                _ShareOption(
                    icon: Icons.send_rounded,
                    label: 'Message',
                    color: Colors.green,
                    onTap: () {}),
                _ShareOption(
                    icon: Icons.more_horiz_rounded,
                    label: 'More',
                    color: Colors.grey,
                    onTap: () async {
                      Navigator.pop(ctx);
                      // Simulate more options with a sheet or system share
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                        content: Text('Opening system share...'),
                        behavior: SnackBarBehavior.floating,
                      ));
                    }),
              ],
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  void _showInsightsSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => SafeArea(
        top: false,
        child: Container(
          height: MediaQuery.of(ctx).size.height * 0.85,
          decoration: BoxDecoration(
            color: Theme.of(context).cardColor,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: Column(
            children: [
              const SizedBox(height: 12),
              Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                      color: Theme.of(context).dividerColor,
                      borderRadius: BorderRadius.circular(2))),
              const Padding(
                padding: EdgeInsets.all(16),
                child: Text('Engagement Insights',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold)),
              ),
              const Divider(height: 1),
              Expanded(
                child: FutureBuilder<Map<String, dynamic>?>(
                  future: ref.read(feedServiceProvider).getInsights(),
                  builder: (context, snapshot) {
                    if (snapshot.connectionState == ConnectionState.waiting) {
                      return const Center(child: CircularProgressIndicator(color: AppColors.primary));
                    }
                    if (!snapshot.hasData || snapshot.data == null) {
                      return const Center(child: Text('Failed to load insights'));
                    }

                    final data = snapshot.data!;
                    final profileData = data['profile'];
                    final bottomInset = MediaQuery.of(ctx).padding.bottom + 24;

                    return ListView(
                      physics: const BouncingScrollPhysics(),
                      padding: EdgeInsets.fromLTRB(20, 20, 20, bottomInset),
                      children: [
                      const Text('Influence Metrics',
                          style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.bold)),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          _MetricCard(
                              label: 'Total Likes',
                              value: '${profileData['total_likes']}',
                              growth: 'Across all posts',
                              icon: Icons.favorite_border_rounded,
                              color: Colors.pink),
                          const SizedBox(width: 12),
                          _MetricCard(
                              label: 'Avg Interaction',
                              value: '${profileData['avg_interaction']}',
                              growth: 'Per post',
                              icon: Icons.analytics_outlined,
                              color: Colors.blue),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          _MetricCard(
                              label: 'Total Posts',
                              value: '${profileData['total_posts']}',
                              growth: 'Overall volume',
                              icon: Icons.post_add_rounded,
                              color: Colors.green),
                          const SizedBox(width: 12),
                          _MetricCard(
                              label: 'Pending Approvals',
                              value: '${profileData['pending_approvals']}',
                              growth: 'Action required',
                              icon: Icons.pending_actions_rounded,
                              color: Colors.orange,
                              onTap: () {
                                Navigator.pop(ctx);
                                context.push('/pending-approvals');
                              }),
                        ],
                      ),
                      const SizedBox(height: 32),
                      const Text('Last 7 Days',
                          style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.bold)),
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: Theme.of(context).dividerColor.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: Theme.of(context).dividerColor),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceAround,
                          children: [
                            Column(
                              children: [
                                Text('${profileData['weekly_posts']}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: AppColors.primary)),
                                const Text('New Posts', style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                              ],
                            ),
                            Container(height: 40, width: 1, color: Theme.of(context).dividerColor),
                            Column(
                              children: [
                                Text('${profileData['weekly_likes']}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.pink)),
                                const Text('New Likes', style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                              ],
                            ),
                          ],
                        ),
                      ),
                      // -- Per-AI Persona Breakdown (Phase 4)
                      if ((data['ai_personas'] as List? ?? []).isNotEmpty) ...[
                        const SizedBox(height: 32),
                        const Text('AI Persona Performance',
                            style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                        const SizedBox(height: 12),
                        ...(data['ai_personas'] as List).map((ai) {
                          final aiMap = ai as Map<String, dynamic>;
                          final pending = aiMap['pending_count'] as int? ?? 0;
                          final flagged = aiMap['flagged_count'] as int? ?? 0;
                          final avgInteraction = (aiMap['avg_interaction'] as num?)?.toDouble() ?? 0.0;
                          final weeklyPosts = aiMap['weekly_posts'] as int? ?? 0;
                          final limit = aiMap['daily_post_limit'] as int? ?? 20;
                          return Container(
                            margin: const EdgeInsets.only(bottom: 12),
                            padding: const EdgeInsets.all(14),
                            decoration: BoxDecoration(
                              color: AppColors.badgeAI.withOpacity(0.04),
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(color: AppColors.badgeAI.withOpacity(0.15)),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(children: [
                                  const Icon(Icons.smart_toy_outlined, size: 15, color: AppColors.badgeAI),
                                  const SizedBox(width: 6),
                                  Text('@${aiMap['username']}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                                  const Spacer(),
                                  Text('${avgInteraction.toStringAsFixed(1)} avg/post', style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
                                ]),
                                const SizedBox(height: 8),
                                Wrap(spacing: 8, runSpacing: 6, children: [
                                  _MiniStat(label: 'Posts', value: '${aiMap['post_count']}', color: AppColors.primary),
                                  _MiniStat(label: 'Likes', value: '${aiMap['total_likes']}', color: Colors.pink),
                                  _MiniStat(label: 'Wk', value: '$weeklyPosts', color: Colors.teal),
                                  if (pending > 0) _MiniStat(label: 'Pending', value: '$pending', color: AppColors.warning),
                                  if (flagged > 0) _MiniStat(label: 'Flagged', value: '$flagged', color: AppColors.error),
                                ]),
                              ],
                            ),
                          );
                        }),
                      ],
                      ],
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showSettingsSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        height: MediaQuery.of(ctx).size.height * 0.75,
        decoration: BoxDecoration(
          color: Theme.of(context).cardColor,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
          children: [
            const SizedBox(height: 12),
            Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                    color: Theme.of(context).dividerColor,
                    borderRadius: BorderRadius.circular(2))),
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('Settings',
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold)),
            ),
            const Divider(height: 1),
            Expanded(
              child: ListView(
                children: [
                  _SettingsGroup(title: 'Account', children: [
                    _SettingsTile(
                        icon: Icons.person_outline_rounded,
                        title: 'Personal Information',
                        onTap: () => _showPersonalInfo(context)),
                    _SettingsTile(
                        icon: Icons.lock_outline_rounded,
                        title: 'ALT Account & Security',
                        subtitle: 'Password, two-factor, devices and your other ALT apps',
                        onTap: () {
                          Navigator.of(context).pop();
                          context.push('/account');
                        }),
                    _SettingsTile(
                        icon: Icons.auto_awesome_outlined,
                        title: 'Your AIs',
                        subtitle: 'Owned, rented and subscribed, on every ALT app',
                        onTap: () {
                          Navigator.of(context).pop();
                          context.push('/your-ais');
                        }),
                    _SettingsTile(
                        icon: Icons.account_balance_wallet_outlined,
                        title: 'Wallets',
                        subtitle: 'The addresses that hold your AI identity tokens',
                        onTap: () {
                          Navigator.of(context).pop();
                          context.push('/account');
                        }),
                    _SettingsTile(
                        icon: Icons.policy_outlined,
                        title: 'Moderation & Compliance',
                        subtitle: 'View flagged content and anomaly flags',
                        onTap: () {
                          Navigator.pop(ctx);
                          context.push('/moderation');
                        }),
                  ]),
                  _SettingsGroup(title: 'Preferences', children: [
                    _SettingsTile(
                      icon: Icons.notifications_none_rounded,
                      title: 'Notifications',
                      trailing: Switch(
                          value: true,
                          onChanged: (v) {},
                          activeColor: AppColors.primary),
                    ),
                    _SettingsTile(
                      icon: Icons.light_mode_outlined,
                      title: 'Light Mode',
                      trailing: Switch(
                        value: ref.watch(themeProvider) == ThemeMode.light,
                        onChanged: (v) =>
                            ref.read(themeProvider.notifier).toggleTheme(),
                        activeColor: AppColors.primary,
                      ),
                    ),
                    _SettingsTile(
                      icon: Icons.language_rounded,
                      title: 'Language',
                      trailing: const Text('English (US)',
                          style: TextStyle(
                              fontSize: 12, color: AppColors.textTertiary)),
                      onTap: () => _showLanguageSelector(context),
                    ),
                  ]),
                  _SettingsGroup(title: 'Support', children: [
                    _SettingsTile(
                        icon: Icons.help_outline_rounded,
                        title: 'Help Center',
                        onTap: () => _showSimpleDialog(context, 'Help Center',
                            'Our support team is available 24/7. Contact us at support@altera.ai')),
                    _SettingsTile(
                        icon: Icons.info_outline_rounded,
                        title: 'About Altera',
                        onTap: () => _showSimpleDialog(context, 'About Altera',
                            'Altera is the first hybrid social hub where humans and AI personas interact as equals. Version 1.0.4')),
                    _SettingsTile(
                        icon: Icons.privacy_tip_outlined,
                        title: 'Privacy Policy',
                        onTap: () => _showSimpleDialog(
                            context,
                            'Privacy Policy',
                            'Your data is encrypted and stored on-chain where applicable. We respect your digital sovereignty.')),
                  ]),
                  const SizedBox(height: 20),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: OutlinedButton.icon(
                      onPressed: () async {
                        await ref.read(authStateProvider.notifier).logout();
                        if (context.mounted) {
                          Navigator.pop(ctx);
                          context.go('/login');
                        }
                      },
                      icon: const Icon(Icons.logout_rounded,
                          color: AppColors.error),
                      label: const Text('Logout',
                          style: TextStyle(color: AppColors.error)),
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: AppColors.error),
                        padding: const EdgeInsets.symmetric(vertical: 12),
                      ),
                    ),
                  ),
                  const SizedBox(height: 40),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authStateProvider);
    final user = auth.user;

    if (user == null) {
      return const Scaffold(
        body: Center(
          child: CircularProgressIndicator(color: AppColors.primary),
        ),
      );
    }

    if (_isLoadingOther) {
      return Scaffold(
        body: Center(child: CircularProgressIndicator(color: AppColors.primary)),
      );
    }

    if (_errorOther != null) {
      return Scaffold(
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_errorOther!),
              const SizedBox(height: 16),
              ElevatedButton(onPressed: _fetchOtherProfile, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }

    final activeId = auth.activeProfileId;
    final feedState = ref.watch(feedProvider);
    dynamic profile;
    bool isAIActive = false;
    bool isMe = true;
    List<Post> profilePosts = [];

    if (!_showsOwnedProfileView &&
        widget.profileId != null &&
        _otherProfileData != null) {
      final pData = _otherProfileData!['visiting_profile'];
      isMe = _isOwnedProfileId(pData['id'] as String?);
      profile = pData;
      isAIActive = pData['is_ai'] == true;
      profilePosts = (_otherProfileData!['posts'] as List)
          .map((p) => Post.fromJson(p))
          .toList();
    } else if (!_showsOwnedProfileView && widget.profileId != null) {
      // Still loading — return early, _isLoadingOther will show spinner above
      return const Scaffold(
        body: Center(child: CircularProgressIndicator(color: AppColors.primary)),
      );
    } else {
      final isHuman = user.humanProfile?.id == activeId;
      if (isHuman) {
        profile = user.humanProfile;
      } else {
        profile = user.aiProfiles.where((p) => p.id == activeId).firstOrNull;
        if (profile != null) {
          isAIActive = true;
        } else {
          profile = user.humanProfile;
          isAIActive = false;
        }
      }
      if (_otherProfileData != null && (_otherProfileData!['posts'] is List)) {
        profilePosts = (_otherProfileData!['posts'] as List)
            .map((p) => Post.fromJson(p))
            .toList();
      } else {
        profilePosts = feedState.posts.where((p) => p.authorId == activeId).toList();
      }
    }

    final username = (profile is Map ? profile['username'] : profile?.username) ?? user.humanProfile?.username ?? 'user';
    final displayName = (profile is Map ? (profile['display_name'] ?? profile['full_name']) : profile?.displayName) ?? user.humanProfile?.displayName ?? 'User';
    final avatar = (profile is Map ? profile['avatar'] : profile?.avatar);
    final postCount = (profile is Map ? profile['post_count'] : profile?.postCount) ?? 0;
    final followerCount = (profile is Map ? profile['follower_count'] : (profile is HumanProfile ? profile.followerCount : (profile is AIProfile ? profile.followerCount : 0))) ?? 0;
    final followingCount = (profile is Map ? profile['following_count'] : (profile is HumanProfile ? profile.followingCount : 0));
    final bio = (profile is Map ? profile['bio'] : (profile is HumanProfile ? profile.bio : (profile is AIProfile ? profile.bio : null)));
    final isFollowing = profile is Map ? (profile['is_following'] ?? false) : false;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final selectedProfileId = auth.activeProfileId;
    final AIProfile? activeAiProfile = profile is AIProfile ? profile : null;
    final aiModelIdentity =
        activeAiProfile?.resolvedModelIdentity ?? 'ALTERA Social Core';
    final aiPersonalityTraits = activeAiProfile?.resolvedPersonalityTraits ??
        const <String>[];

    final savedPosts = ref.watch(savedPostsProvider).savedPosts;

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        backgroundColor: Theme.of(context).appBarTheme.backgroundColor,
        elevation: 0,
        title: Text(username,
            style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w800,
                color: Theme.of(context).colorScheme.onSurface)),
        actions: [
          if (isMe) ...[
            PopupMenuButton<String>(
              tooltip: 'Switch profile',
              icon: Icon(Icons.swap_horiz_rounded,
                  size: 24, color: Theme.of(context).colorScheme.onSurface),
              onSelected: _handleProfileSwitcherSelection,
              itemBuilder: (ctx) {
                final humanProfile = user.humanProfile;
                final aiProfiles = user.aiProfiles;
                final items = <PopupMenuEntry<String>>[];

                if (humanProfile != null) {
                  items.add(
                    PopupMenuItem<String>(
                      value: 'profile:${humanProfile.id}',
                      child: Row(
                        children: [
                          Expanded(child: Text(humanProfile.displayName)),
                          if (selectedProfileId == humanProfile.id)
                            const Icon(Icons.check, size: 18, color: AppColors.primary),
                        ],
                      ),
                    ),
                  );
                }

                for (final ai in aiProfiles) {
                  items.add(
                    PopupMenuItem<String>(
                      value: 'profile:${ai.id}',
                      child: Row(
                        children: [
                          Expanded(child: Text(ai.displayName)),
                          if (selectedProfileId == ai.id)
                            const Icon(Icons.check, size: 18, color: AppColors.primary),
                        ],
                      ),
                    ),
                  );
                }

                items.add(const PopupMenuDivider());
                items.add(
                  const PopupMenuItem<String>(
                    value: 'create_ai',
                    child: Text('Create New AI Persona'),
                  ),
                );

                return items;
              },
            ),
            IconButton(
              icon: Icon(Icons.add_box_outlined, size: 26, color: Theme.of(context).colorScheme.onSurface),
              onPressed: () => context.push('/compose'),
            ),
            IconButton(
              icon: Icon(Icons.menu_rounded, size: 24, color: Theme.of(context).colorScheme.onSurface),
              onPressed: () => _showSettingsSheet(context),
            ),
          ] else ...[
            PopupMenuButton<String>(
              icon: Icon(Icons.more_vert, color: Theme.of(context).colorScheme.onSurface),
              onSelected: (val) {
                if (val == 'block') {
                  _handleBlockProfile(profile);
                } else if (val == 'share') {
                  _showShareProfileSheet(context, profile);
                }
              },
              itemBuilder: (ctx) => [
                const PopupMenuItem(value: 'share', child: Text('Share Profile')),
                const PopupMenuItem(
                  value: 'block', 
                  child: Text('Block User', style: TextStyle(color: Colors.red)),
                ),
              ],
            ),
          ],
          const SizedBox(width: 4),
        ],
      ),
      body: KeyedSubtree(
        key: ValueKey('profile:${widget.profileId ?? 'self'}:$selectedProfileId'),
        child: NestedScrollView(
          headerSliverBuilder: (context, innerBoxIsScrolled) => [
          SliverToBoxAdapter(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // ── Avatar + Stats ──────────────────────────────────
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      _buildAvatar(
                          avatar, displayName, (profile is Map ? profile['id'] : profile?.id),
                          (profile is Map ? profile['id'] : profile?.id) != null ? 'profile_header_avatar_${(profile is Map ? profile['id'] : profile?.id)}' : null),
                      const SizedBox(width: 20),
                      Expanded(
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                          children: [
                            _StatCol(count: '$postCount', label: 'Posts'),
                            GestureDetector(
                              onTap: () {
                                final targetId = profile is Map ? profile['id'] : profile?.id;
                                final targetIsAI = profile is Map ? profile['is_ai'] == true : isAIActive;
                                if (targetId != null) {
                                  _showFollowList(context, 'Followers', targetId, targetIsAI);
                                }
                              },
                              child: _StatCol(count: _fmt(followerCount), label: 'Followers'),
                            ),
                            GestureDetector(
                              onTap: () {
                                final targetId = profile is Map ? profile['id'] : profile?.id;
                                final targetIsAI = profile is Map ? profile['is_ai'] == true : isAIActive;
                                if (targetId != null) {
                                  _showFollowList(context, 'Following', targetId, targetIsAI);
                                }
                              },
                              child: _StatCol(count: _fmt(followingCount), label: 'Following'),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),

                // ── Bio ───────────────────────────────────────────
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        displayName,
                        style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                            color: Theme.of(context).colorScheme.onSurface)),
                      const SizedBox(height: 4),
                      if (bio != null)
                        Text(bio,
                            style: TextStyle(
                                fontSize: 14,
                                color: Theme.of(context).colorScheme.onSurface,
                                height: 1.4)),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          if (isMe) ...[
                            Expanded(
                                child: _Btn(
                                    label: 'Edit Profile',
                                    onTap: () => _showEditProfileSheet(context, profile))),
                            const SizedBox(width: 8),
                            Expanded(
                                child: _Btn(
                                    label: 'Insights',
                                    onTap: () => _showInsightsSheet(context))),
                          ] else ...[
                            Expanded(
                              child: _Btn(
                                label: isFollowing ? 'Following' : 'Follow',
                                color: isFollowing ? Colors.transparent : AppColors.primary,
                                textColor: isFollowing ? AppColors.text : Colors.white,
                                border: isFollowing ? Border.all(color: AppColors.divider, width: 1) : null,
                                onTap: () async {
                                  final targetId = profile is Map ? profile['id'] : profile?.id;
                                  final targetType = profile is Map
                                      ? ((profile['is_ai'] == true) ? 'ai' : 'human')
                                      : (isAIActive ? 'ai' : 'human');
                                  if (targetId != null) {
                                    final ok = await ref.read(feedProvider.notifier).toggleFollow(targetId, targetType);
                                    if (ok && mounted) {
                                      _fetchOtherProfile();
                                    }
                                  }
                                },
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: _Btn(
                                label: 'Message',
                                color: Colors.transparent,
                                textColor: AppColors.text,
                                border: Border.all(color: AppColors.divider, width: 1),
                                onTap: () {
                                  final pData = profile is Map ? profile : null;
                                  if (pData == null) return;
                                  final fp = FollowProfile(
                                    id: pData['id'] ?? '',
                                    userId: pData['user_id'] ?? pData['id'] ?? '',
                                    username: pData['username'] ?? '',
                                    displayName: pData['display_name'] ?? pData['full_name'] ?? '',
                                    avatar: pData['avatar'],
                                    isVerified: pData['is_verified'] ?? false,
                                    isAI: pData['is_ai'] == true,
                                  );
                                  _openConversation(fp);
                                },
                              ),
                            ),
                          ],
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),

                // ── AI Personas strip ───────────────────────────────
                if (isMe && user.aiProfiles.isNotEmpty) ...[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                    child: Row(children: [
                      const Icon(Icons.smart_toy_outlined, size: 15, color: AppColors.badgeAI),
                      const SizedBox(width: 6),
                      Text('My AI Personas',
                          style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                              color: Theme.of(context).colorScheme.onSurface)),
                    ]),
                  ),
                  SizedBox(
                    height: 88,
                    child: ListView.builder(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      itemCount: user.aiProfiles.length + 1,
                      itemBuilder: (ctx, i) {
                        if (i == user.aiProfiles.length) {
                          return _PersonaCircle(
                            isAdd: true,
                            label: 'New AI',
                            onTap: () => context.push('/create-ai'),
                          );
                        }
                        final ai = user.aiProfiles[i];
                        return _PersonaCircle(
                          label: ai.displayName,
                          avatarUrl: ai.avatar,
                          isVerified: ai.isVerified,
                          isActive: selectedProfileId == ai.id,
                          onTap: () => _switchOwnedProfile(ai.id),
                        );
                      },
                    ),
                  ),
                  const SizedBox(height: 14),

                  if (isAIActive) ...[
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: AppColors.badgeAI.withOpacity(0.05),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: AppColors.badgeAI.withOpacity(0.2)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                const Icon(Icons.psychology_outlined, size: 18, color: AppColors.badgeAI),
                                const SizedBox(width: 8),
                                Text('Personality & Model Identity',
                                    style: TextStyle(
                                        fontWeight: FontWeight.bold,
                                        color: Theme.of(context).colorScheme.onSurface)),
                              ],
                            ),
                            const SizedBox(height: 12),
                            Text('Model Identity: $aiModelIdentity',
                                style: const TextStyle(fontSize: 12, color: AppColors.primary, fontWeight: FontWeight.w600)),
                            const SizedBox(height: 8),
                            Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: aiPersonalityTraits
                                  .map((trait) => _TraitChip(
                                        label: trait.toString(),
                                        color: _traitColorFor(trait.toString()),
                                      ))
                                  .toList(),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ],
                const SizedBox(height: 14),
              ],
            ),
          ),
          SliverPersistentHeader(
            pinned: true,
            delegate: _TabBarDelegate(
              TabBar(
                controller: _tabController,
                labelColor: isDark ? AppColors.textDark : AppColors.primary,
                unselectedLabelColor: isDark ? AppColors.textSecondaryDark : AppColors.textSecondary,
                indicatorColor: AppColors.primary,
                dividerColor: Colors.transparent,
                tabs: [
                  const Tab(icon: Icon(Icons.grid_on_rounded, size: 18), text: 'Posts'),
                  if (isMe) ...[
                    const Tab(icon: Icon(Icons.smart_toy_outlined, size: 18), text: 'AIs'),
                    const Tab(icon: Icon(Icons.bookmark_rounded, size: 18), text: 'Saved'),
                  ],
                ],
              ),
            ),
          ),
          ],
          body: TabBarView(
            controller: _tabController,
            children: [
              _MyPostsTab(posts: profilePosts, isLoading: feedState.isLoading),
              if (isMe) ...[
                _AIPersonasTab(user: user),
                savedPosts.isEmpty
                    ? const _EmptySaved()
                    : ListView.builder(
                        padding: const EdgeInsets.only(top: 8, bottom: 80),
                        itemCount: savedPosts.length,
                        itemBuilder: (ctx, i) => PostCard(
                          post: savedPosts[i],
                          heroTagPrefix: 'profile_saved',
                        ),
                      ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildAvatar(String? avatar, String name, [String? id, String? heroTag]) {
    final auth = ref.watch(authStateProvider);
    final profileId = id ?? auth.activeProfileId;
    final isAI = auth.user?.aiProfiles.any((p) => p.id == profileId) ?? false;

    return AvatarWidget(
      avatarUrl: avatar,
      displayName: name,
      radius: 41, // Half of 82
      isAI: isAI,
      heroTag: heroTag,
    );
  }

  String _fmt(int n) => n >= 1000 ? '${(n / 1000).toStringAsFixed(1)}K' : '$n';

  Color _traitColorFor(String trait) {
    final normalized = trait.toLowerCase();
    if (normalized.contains('creative') || normalized.contains('expressive')) {
      return Colors.pink;
    }
    if (normalized.contains('empathetic') ||
        normalized.contains('conversational') ||
        normalized.contains('social')) {
      return Colors.teal;
    }
    if (normalized.contains('analytical') ||
        normalized.contains('strategic') ||
        normalized.contains('technical')) {
      return Colors.blue;
    }
    if (normalized.contains('verified')) {
      return Colors.purple;
    }
    if (normalized.contains('trust') ||
        normalized.contains('ethical') ||
        normalized.contains('guided')) {
      return Colors.green;
    }
    if (normalized.contains('autonomous')) {
      return Colors.orange;
    }
    return AppColors.primary;
  }

  void _openConversation(FollowProfile profile) {
    final auth = ref.read(authStateProvider);
    final activeProfileId = auth.activeProfileId;
    if (activeProfileId == null) return;

    final activeIsAI = activeProfileId != auth.user?.humanProfile?.id;
    final participants = [
      '${activeIsAI ? 'ai' : 'human'}:$activeProfileId',
      '${profile.isAI ? 'ai' : 'human'}:${profile.id}',
    ]..sort();
    final conversationId = participants.join('|');

    final conversation = Conversation(
      id: conversationId,
      userId: profile.userId,
      profileId: profile.id,
      userName: profile.displayName,
      userAvatarUrl: profile.avatar,
      userIsVerified: profile.isVerified,
      userIsAI: profile.isAI,
      unreadCount: 0,
      createdAt: DateTime.now(),
    );

    context.push(
      '/messages/${Uri.encodeComponent(conversationId)}',
      extra: conversation,
    );
  }

  Future<bool> _doesProfileFollowActiveProfile({
    required String activeProfileId,
    required FollowProfile profile,
  }) {
    return ref.read(feedServiceProvider).isFollowingProfile(
          activeProfileId,
          followerId: profile.id,
          followerType: profile.isAI ? 'ai' : 'human',
        );
  }

  void _showFollowList(BuildContext context, String title, String targetProfileId, bool targetIsAI) {
    final auth = ref.read(authStateProvider);
    final profileIdNullable = auth.activeProfileId;
    if (profileIdNullable == null) return;
    final String profileId = profileIdNullable; // non-nullable for closure capture
    final activeIsAI = auth.user?.aiProfiles.any((p) => p.id == profileId) ?? false;

    final kind = title.toLowerCase();
    var refreshTick = 0;

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => StatefulBuilder(
        builder: (context, setModalState) => Container(
          height: MediaQuery.of(context).size.height * 0.7,
          decoration: BoxDecoration(
            color: Theme.of(context).cardColor,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: Column(
            children: [
              const SizedBox(height: 12),
              Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                      color: Theme.of(context).dividerColor,
                      borderRadius: BorderRadius.circular(2))),
              Padding(
                padding: const EdgeInsets.all(16),
                child: Text(title,
                    style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        color: Theme.of(context).colorScheme.onSurface)),
              ),
              const Divider(height: 1, color: AppColors.divider),
              Expanded(
                child: FutureBuilder<List<FollowProfile>>(
                  future: ref.read(feedServiceProvider).getFollowList(
                        profileId: targetProfileId,
                        kind: kind,
                        profileType: targetIsAI ? 'ai' : 'human',
                      ),
                  builder: (context, snapshot) {
                    if (!snapshot.hasData) {
                      return const Center(child: CircularProgressIndicator());
                    }

                    final items = snapshot.data ?? [];
                    if (items.isEmpty) {
                      return Center(
                        child: Text(
                          'No $kind yet',
                          style: TextStyle(color: AppColors.textSecondary),
                        ),
                      );
                    }

                    return ListView.builder(
                      itemCount: items.length,
                      itemBuilder: (ctx, i) {
                        final item = items[i];
                        return ListTile(
                          leading: CircleAvatar(
                            backgroundColor: item.isAI
                                ? AppColors.badgeAI.withOpacity(0.15)
                                : AppColors.primary.withOpacity(0.1),
                            child: Text(
                              item.isAI
                                  ? 'AI'
                                  : item.displayName[0].toUpperCase(),
                              style: TextStyle(
                                color: item.isAI
                                    ? AppColors.badgeAI
                                    : AppColors.primary,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          title: Text(
                            item.displayName,
                            style: TextStyle(
                              fontWeight: FontWeight.w600,
                              color: Theme.of(context).colorScheme.onSurface,
                            ),
                          ),
                          subtitle: Text(
                            '@${item.username}',
                            style:
                                const TextStyle(color: AppColors.textSecondary),
                          ),
                          trailing: item.id == profileId
                              ? null
                              : FutureBuilder<bool>(
                                  key: ValueKey('${kind}:${item.id}:$refreshTick'),
                                  future: kind == 'followers'
                                      ? ref
                                          .read(feedServiceProvider)
                                          .isFollowingProfile(
                                            item.id,
                                            followerId: profileId,
                                            followerType:
                                                activeIsAI ? 'ai' : 'human',
                                          )
                                      : _doesProfileFollowActiveProfile(
                                          activeProfileId: profileId,
                                          profile: item,
                                        ),
                                  builder: (context, relationSnapshot) {
                                    final relationReady =
                                        relationSnapshot.connectionState !=
                                            ConnectionState.waiting;
                                    final isMutual =
                                        relationSnapshot.data ?? false;
                                    final showMessage = isMutual;
                                    final canFollowBack =
                                        kind == 'followers' && !showMessage;
                                    final actionLabel = showMessage
                                        ? 'Message'
                                        : canFollowBack
                                            ? 'Follow back'
                                            : 'Following';
                                    final VoidCallback? onPressed;

                                    if (!relationReady) {
                                      onPressed = null;
                                    } else if (showMessage) {
                                      onPressed = () => _openConversation(item);
                                    } else if (canFollowBack) {
                                      onPressed = () async {
                                        final result = await ref
                                            .read(feedServiceProvider)
                                            .followProfile(
                                              item.id,
                                              item.isAI ? 'ai' : 'human',
                                              followerId: profileId,
                                              followerType:
                                                  activeIsAI ? 'ai' : 'human',
                                            );
                                        if (!result.success) {
                                          if (context.mounted) {
                                            ScaffoldMessenger.of(context)
                                                .showSnackBar(
                                              SnackBar(
                                                content: Text(
                                                  result.error ??
                                                      'Could not update follow',
                                                ),
                                                backgroundColor:
                                                    AppColors.error,
                                                behavior:
                                                    SnackBarBehavior.floating,
                                              ),
                                            );
                                          }
                                          return;
                                        }
                                        ref
                                            .read(feedProvider.notifier)
                                            .syncFollowState(
                                              item.id,
                                              result.following,
                                            );
                                        await ref
                                            .read(authStateProvider.notifier)
                                            .refreshProfile();
                                        setModalState(() => refreshTick++);
                                      };
                                    } else {
                                      onPressed = null;
                                    }

                                    return OutlinedButton(
                                      onPressed: onPressed,
                                      style: OutlinedButton.styleFrom(
                                        padding: const EdgeInsets.symmetric(
                                            horizontal: 16),
                                        minimumSize: const Size(0, 32),
                                      ),
                                      child: Text(actionLabel),
                                    );
                                  },
                                ),
                        );
                      },
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── Empty Saved ────────────────────────────────────────────────
class _EmptySaved extends StatelessWidget {
  const _EmptySaved();
  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      child: Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 20),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.bookmark_border_rounded,
                  size: 52, color: AppColors.textTertiary),
              const SizedBox(height: 14),
              const Text('No saved posts yet',
                  style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textSecondary)),
              const SizedBox(height: 6),
              const Text('Tap the bookmark icon on any post\nto save it here.',
                  textAlign: TextAlign.center,
                  style:
                      TextStyle(fontSize: 13, color: AppColors.textTertiary)),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── AI Personas Tab ────────────────────────────────────────────────
class _AIPersonasTab extends ConsumerWidget {
  final dynamic user;
  const _AIPersonasTab({required this.user});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final personas = user?.aiProfiles ?? [];
    final activeProfileId = ref.watch(authStateProvider).activeProfileId;
    if (personas.isEmpty) {
      return SingleChildScrollView(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 20),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 72,
                  height: 72,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(colors: AppColors.aiGradient),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.smart_toy_outlined,
                      size: 36, color: Colors.white),
                ),
                const SizedBox(height: 16),
                Text('No AI Personas Yet',
                    style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: Theme.of(context).colorScheme.onSurface)),
                const SizedBox(height: 8),
                Text(
                    'Create your AI in ALTER, deploy it with its\nidentity token, then bring it here.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                        fontSize: 13,
                        color: Theme.of(context)
                            .colorScheme
                            .onSurface
                            .withOpacity(0.7))),
                const SizedBox(height: 20),
                FilledButton.icon(
                  onPressed: () => context.push('/create-ai'),
                  icon: const Icon(Icons.add),
                  label: const Text('Bring your AI'),
                ),
              ],
            ),
          ),
        ),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.all(14),
      itemCount: personas.length,
      itemBuilder: (ctx, i) {
        final ai = personas[i];
        final isActive = activeProfileId == ai.id;
        final switchProfile = () {
          ref.read(authStateProvider.notifier).switchProfile(ai.id);
          context.go('/profile');
        };
        return Container(
          margin: const EdgeInsets.only(bottom: 12),
          decoration: BoxDecoration(
            color: Theme.of(context).cardColor,
            borderRadius: BorderRadius.circular(16),
            border:
                Border.all(
                  color: isActive
                      ? AppColors.primary.withOpacity(0.6)
                      : Theme.of(context).dividerColor,
                  width: isActive ? 1.2 : 0.5,
                ),
          ),
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: switchProfile,
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                children: [
                  AvatarWidget(
                    avatarUrl: ai.avatar,
                    displayName: ai.displayName,
                    isAI: true,
                    radius: 24,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(children: [
                          Flexible(
                            child: Text(ai.displayName,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                    fontWeight: FontWeight.w700,
                                    fontSize: 14,
                                    color: Theme.of(context)
                                        .colorScheme
                                        .onSurface)),
                          ),
                          if (ai.isVerified) ...[
                            const SizedBox(width: 4),
                            const Icon(Icons.verified_rounded,
                                color: AppColors.primary, size: 14),
                          ],
                        ]),
                        Text('@${ai.username}',
                            style: TextStyle(
                                fontSize: 12, color: AppColors.textSecondary)),
                        const SizedBox(height: 4),
                        Row(children: [
                          GestureDetector(
                            onTap: () => showAitIdentity(context, ref, ai.id),
                            child: _MiniTag(
                                label: ai.aitTokenId != null ? 'AIT #${ai.aitTokenId}' : 'Not verified',
                                color: AppColors.primary),
                          ),
                          const SizedBox(width: 6),
                          _MiniTag(
                              label:
                                  '${ai.healthScore.toStringAsFixed(0)}% health',
                              color: AppColors.success),
                        ]),
                      ],
                    ),
                  ),
                  if (isActive)
                    Container(
                      width: 24,
                      height: 24,
                      decoration: const BoxDecoration(
                        color: AppColors.primary,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.check,
                          size: 14, color: Colors.white),
                    )
                  else
                    IconButton(
                      icon: const Icon(Icons.arrow_forward_ios_rounded,
                          size: 16, color: AppColors.textTertiary),
                      onPressed: switchProfile,
                    ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _MiniTag extends StatelessWidget {
  final String label;
  final Color color;
  const _MiniTag({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(label,
          style: TextStyle(
              fontSize: 10, color: color, fontWeight: FontWeight.w600)),
    );
  }
}

// ─── Helper widgets ────────────────────────────────────────────────

class _SettingsGroup extends StatelessWidget {
  final String title;
  final List<Widget> children;
  const _SettingsGroup({required this.title, required this.children});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 24, 16, 8),
          child: Text(title.toUpperCase(),
              style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textTertiary,
                  letterSpacing: 1)),
        ),
        ...children,
      ],
    );
  }
}

class _SettingsTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;
  const _SettingsTile(
      {required this.icon, required this.title, this.subtitle, this.trailing, this.onTap});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading:
          Icon(icon, size: 22, color: Theme.of(context).colorScheme.onSurface),
      title: Text(title,
          style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w500,
              color: Theme.of(context).colorScheme.onSurface)),
      subtitle: subtitle != null
          ? Text(subtitle!, style: const TextStyle(fontSize: 12, color: AppColors.textSecondary))
          : null,
      trailing: trailing ??
          const Icon(Icons.chevron_right_rounded,
              size: 20, color: AppColors.textTertiary),
      onTap: onTap,
    );
  }
}


class _ShareOption extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;
  const _ShareOption(
      {required this.icon,
      required this.label,
      required this.color,
      required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
                color: color.withOpacity(0.1), shape: BoxShape.circle),
            child: Icon(icon, color: color, size: 24),
          ),
          const SizedBox(height: 8),
          Text(label,
              style: TextStyle(
                  fontSize: 12, color: AppColors.textSecondary)),
        ],
      ),
    );
  }
}

class _StatCol extends StatelessWidget {
  final String count, label;
  final Color? color;
  const _StatCol({required this.count, required this.label, this.color});

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(count,
            style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w800,
                color: color ?? Theme.of(context).colorScheme.onSurface)),
        const SizedBox(height: 2),
        Text(label,
            style: TextStyle(
                fontSize: 11,
                color: color ??
                    Theme.of(context).colorScheme.onSurface.withOpacity(0.6),
                fontWeight: FontWeight.w500),
            textAlign: TextAlign.center),
      ],
    );
  }
}

class _Btn extends StatelessWidget {
  final String label;
  final VoidCallback onTap;
  final IconData? icon;
  final bool compact;
  final Color? color;
  final Color? textColor;
  final String? tooltip;
  final Border? border;
  const _Btn(
      {required this.label,
      required this.onTap,
      this.icon,
      this.compact = false,
      this.color,
      this.textColor,
      this.tooltip,
      this.border});

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip ?? '',
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding:
              EdgeInsets.symmetric(vertical: 8, horizontal: compact ? 10 : 0),
          decoration: BoxDecoration(
            color: color ?? Theme.of(context).dividerColor,
            borderRadius: BorderRadius.circular(10),
            border: border ?? Border.all(color: Theme.of(context).dividerColor, width: 0.5),
          ),
          child: Center(
            child: icon != null
                ? Icon(icon,
                    size: 20, color: textColor ?? Theme.of(context).colorScheme.onSurface)
                : Text(label,
                    style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: textColor ?? Theme.of(context).colorScheme.onSurface)),
          ),
        ),
      ),
    );
  }
}

class _TraitChip extends StatelessWidget {
  final String label;
  final Color color;
  const _TraitChip({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withOpacity(0.08),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Text(label,
          style: TextStyle(
              fontSize: 11, fontWeight: FontWeight.w600, color: color)),
    );
  }
}

class _PersonaCircle extends StatelessWidget {
  final bool isAdd;
  final String label;
  final String? avatarUrl;
  final bool isVerified;
  final bool isActive;
  final VoidCallback? onTap;
  const _PersonaCircle(
      {this.isAdd = false,
      required this.label,
      this.avatarUrl,
      this.isVerified = false,
      this.isActive = false,
      this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8),
        child: Column(
          children: [
            Container(
              width: 58,
              height: 58,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: isAdd
                    ? null
                    : const LinearGradient(colors: AppColors.aiGradient),
                border: isAdd
                    ? Border.all(color: AppColors.primary, width: 1.5)
                    : isActive
                        ? Border.all(color: Colors.white, width: 2)
                    : null,
                boxShadow: isActive
                    ? [
                        BoxShadow(
                          color: AppColors.primary.withOpacity(0.28),
                          blurRadius: 12,
                          offset: const Offset(0, 4),
                        ),
                      ]
                    : null,
              ),
              child: Center(
                child: isAdd
                    ? const Icon(Icons.add, color: AppColors.primary, size: 26)
                    : AvatarWidget(
                        avatarUrl: avatarUrl,
                        displayName: label,
                        radius: 26,
                        isAI: true,
                        showGradient: false,
                      ),
              ),
            ),
            const SizedBox(height: 4),
            SizedBox(
              width: 60,
              child: Text(label,
                  style: TextStyle(
                      fontSize: 10, color: AppColors.textSecondary),
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center),
            ),
          ],
        ),
      ),
    );
  }
}

class _ProfileSwitchTile extends StatelessWidget {
  final String emoji, name, username;
  final bool isActive, isAI;
  final String? token;
  final String? avatarUrl;
  final VoidCallback onTap;
  const _ProfileSwitchTile(
      {required this.emoji,
      required this.name,
      required this.username,
      required this.isActive,
      required this.isAI,
      required this.onTap,
      this.avatarUrl,
      this.token});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
      leading: avatarUrl != null && avatarUrl!.isNotEmpty
          ? AvatarWidget(
              avatarUrl: avatarUrl,
              displayName: name,
              isAI: isAI,
              radius: 24,
              showGradient: false,
            )
          : Center(child: Text(emoji, style: const TextStyle(fontSize: 22))),
      title: Text(name,
          style: TextStyle(
              fontWeight: FontWeight.w700,
              color: Theme.of(context).colorScheme.onSurface)),
      subtitle: Row(
        children: [
          Text(username,
              style: TextStyle(
                  fontSize: 12, color: AppColors.textSecondary)),
          if (token != null) ...[
            const SizedBox(width: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: AppColors.primary.withOpacity(0.1),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(token!,
                  style: TextStyle(
                      fontSize: 10,
                      color: AppColors.primary,
                      fontWeight: FontWeight.w600)),
            ),
          ],
        ],
      ),
      trailing: isActive
          ? Container(
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                color: AppColors.primary,
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.check, color: Colors.white, size: 14),
            )
          : null,
      onTap: onTap,
    );
  }
}

class _TabBarDelegate extends SliverPersistentHeaderDelegate {
  final TabBar tabBar;
  _TabBarDelegate(this.tabBar);

  @override
  double get minExtent => tabBar.preferredSize.height;
  @override
  double get maxExtent => tabBar.preferredSize.height;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      color: isDark ? AppColors.backgroundDark : AppColors.background,
      child: tabBar,
    );
  }

  @override
  bool shouldRebuild(_TabBarDelegate oldDelegate) => true;
}

// â”€â”€â”€ My Posts Tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class _MyPostsTab extends StatelessWidget {
  final List<Post> posts;
  final bool isLoading;
  const _MyPostsTab({required this.posts, required this.isLoading});

  @override
  Widget build(BuildContext context) {
    if (isLoading && posts.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (posts.isEmpty) {
      return SingleChildScrollView(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 20),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.post_add_rounded,
                    size: 52, color: AppColors.textTertiary),
                const SizedBox(height: 14),
                Text('No posts yet',
                    style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        color: Theme.of(context)
                            .colorScheme
                            .onSurface
                            .withOpacity(0.7))),
                const SizedBox(height: 6),
                const Text('Share your thoughts with the world.',
                    textAlign: TextAlign.center,
                    style:
                        TextStyle(fontSize: 13, color: AppColors.textTertiary)),
              ],
            ),
          ),
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.only(top: 8, bottom: 80),
      itemCount: posts.length,
      itemBuilder: (ctx, i) => PostCard(
        post: posts[i],
        heroTagPrefix: 'profile',
      ),
    );
  }
}

class _MetricCard extends StatelessWidget {
  final String label;
  final String value;
  final String growth;
  final IconData icon;
  final Color color;
  final VoidCallback? onTap;

  const _MetricCard({
    required this.label,
    required this.value,
    required this.growth,
    required this.icon,
    required this.color,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: color.withOpacity(0.05),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: color.withOpacity(0.1)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Icon(icon, size: 20, color: color),
                  Text(growth,
                      style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                          color: Colors.green)),
                ],
              ),
              const SizedBox(height: 12),
              Text(value,
                  style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface)),
              const SizedBox(height: 4),
              Text(label,
                  style: TextStyle(
                      fontSize: 11, color: AppColors.textTertiary)),
            ],
          ),
        ),
      ),
    );
  }
}


class _StoryOption extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _StoryOption({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Theme.of(context).dividerColor.withOpacity(0.5)),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppColors.primary.withOpacity(0.1),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: AppColors.primary, size: 24),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: TextStyle(
                      fontSize: 13,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right_rounded, color: AppColors.textTertiary),
          ],
        ),
      ),
    );
  }
}

// -- _MiniStat: compact inline metric badge used in AI persona performance
class _MiniStat extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  const _MiniStat({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.08),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withOpacity(0.2)),
      ),
      child: Column(
        children: [
          Text(value, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: color)),
          Text(label, style: const TextStyle(fontSize: 9, color: AppColors.textSecondary)),
        ],
      ),
    );
  }
}
