import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'dart:async';

import '../../../shared/widgets/gradient_background.dart';
import '../../../shared/widgets/alt_button.dart';
import '../../../shared/ui/ui.dart';
import '../../../shared/widgets/alt_card.dart';
import '../../../core/theme/colors.dart';
import '../../../core/theme/ds.dart';
import '../../../core/theme/gradients.dart';
import '../../../core/theme/typography.dart';
import '../../../core/models/persona.dart';
import '../../../core/providers/storage_providers.dart';
import '../../../core/alt/ai_api.dart';
import '../../../core/alt/alt_session.dart';
import 'package:alt_account/alt_account.dart';

class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  final PageController _pageController = PageController();
  
  // Shared State
  String _name = '';
  String _age = '';
  String? _pronoun;
  List<String> _selectedRoles = [];
  bool _consent1 = false;
  bool _consent2 = false;
  bool _consent3 = false;
  bool _consent4 = false;
  String? _avatarPath;
  String? _profileTrait; // e.g., 'Logical' or 'Creative'

  void _nextPage() {
    _pageController.nextPage(
      duration: const Duration(milliseconds: 600),
      curve: Curves.easeInOut,
    );
  }

  /// Creates the person's AI in ALT Core with their answers and their recorded consent.
  Future<void> _finishOnboarding() async {
    final user = altAccount.currentUser.value;
    final first = (_name.trim().isNotEmpty ? _name.trim() : user?.displayName ?? 'My').split(' ').first;
    final base = '${user?.handle ?? 'me'}_ai'.replaceAll(RegExp(r'[^A-Za-z0-9_.]'), '_');
    final stem = base.length > 26 ? base.substring(0, 26) : base;
    AltAi? created;
    String? error;
    for (var attempt = 0; attempt < 5 && created == null; attempt++) {
      try {
        created = await aiApi.create(
          name: "$first's ALT",
          handle: attempt == 0 ? stem : '${stem}${attempt + 1}',
          onboarding: {
            if (int.tryParse(_age) != null) 'age': int.parse(_age),
            if (_pronoun != null && _pronoun != 'Prefer not to say') 'pronouns': _pronoun,
            'roles': _selectedRoles,
            if (_profileTrait != null) 'primaryTrait': _profileTrait,
          },
          consents: {
            'persona_training': _consent1,
            'third_party_processing': _consent2,
            'public_deployment': _consent3,
            'interaction_learning': _consent4,
          },
        );
      } on AltApiException catch (e) {
        if (e.code != 'HANDLE_TAKEN') {
          error = e.message;
          break;
        }
      }
    }
    if (created == null) {
      if (!mounted) return;
      final retry = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => AlertDialog(
          title: const Text('Could not create your AI'),
          content: Text(error ?? 'Please try again.'),
          actions: [FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Try again'))],
        ),
      );
      if (retry == true) await _finishOnboarding();
      return;
    }

    final persona = Persona(
      id: 'current_user',
      name: _name,
      age: int.tryParse(_age) ?? 0,
      pronouns: _pronoun ?? 'Unspecified',
      roles: _selectedRoles,
      avatarPath: _avatarPath,
      primaryTrait: _profileTrait ?? 'Balanced',
      createdAt: DateTime.now(),
    );
    await ref.read(personaRepositoryProvider).savePersona(persona);
    currentAi.value = created;
    aiPhase.value = AiPhase.exists; // the router moves on to Home
    if (mounted) context.go('/home');
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: GradientBackground(
        baseColor: isDark ? ALTColors.darkBgPage : ALTColors.lightBgPage,
        layers: isDark ? ALTGradients.alterDark : ALTGradients.alterLight,
        animate: true,
        child: SafeArea(
          child: PageView(
            controller: _pageController,
            physics: const NeverScrollableScrollPhysics(),
            children: [
              _Stage1BootSplash(onComplete: _nextPage),
              _Stage2StoryTimer(onComplete: _nextPage),
              _Stage3AuthSplash(onComplete: _nextPage),
              _Stage4Identity(
                onNameChanged: (v) => _name = v,
                onAgeChanged: (v) => _age = v,
                onComplete: _nextPage,
              ),
              _Stage5Demographics(
                onPronounChanged: (v) => _pronoun = v,
                onRolesChanged: (v) => _selectedRoles = v,
                onComplete: _nextPage,
              ),
              _Stage6Consent(
                onComplete: (c1, c2, c3, c4) {
                  _consent1 = c1; _consent2 = c2; _consent3 = c3; _consent4 = c4;
                  _nextPage();
                },
              ),
              _Stage7Avatar(
                onAvatarSelected: (path) => _avatarPath = path,
                onComplete: _nextPage,
              ),
              _Stage8SwipeProfile(
                onTraitSelected: (trait) => _profileTrait = trait,
                onComplete: _nextPage,
              ),
              _Stage9Generating(onComplete: _finishOnboarding),
            ],
          ),
        ),
      ),
    );
  }
}

// -----------------------------------------------------------------------------
// STAGE 1: BOOT SPLASH (Spinning/Zooming Logo)
// -----------------------------------------------------------------------------
class _Stage1BootSplash extends StatefulWidget {
  final VoidCallback onComplete;
  const _Stage1BootSplash({required this.onComplete});
  @override
  State<_Stage1BootSplash> createState() => _Stage1BootSplashState();
}

class _Stage1BootSplashState extends State<_Stage1BootSplash> {
  @override
  void initState() {
    super.initState();
    Future.delayed(const Duration(milliseconds: 2500), widget.onComplete);
  }

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        width: 150,
        height: 150,
        decoration: const BoxDecoration(
          shape: BoxShape.circle,
          gradient: ALTGradients.heroAILight,
        ),
      ).animate()
       .scale(begin: const Offset(0.5, 0.5), end: const Offset(1, 1), duration: 1000.ms, curve: Curves.easeOutBack)
       .rotate(begin: 0, end: 1, duration: 1500.ms, curve: Curves.easeInOut)
       .then(delay: 500.ms)
       .scale(begin: const Offset(1, 1), end: const Offset(5, 5), duration: 500.ms)
       .fadeOut(duration: 300.ms),
    );
  }
}

// -----------------------------------------------------------------------------
// STAGE 2: STORY TIMER (Auto-advancing series)
// -----------------------------------------------------------------------------
class _Stage2StoryTimer extends StatefulWidget {
  final VoidCallback onComplete;
  const _Stage2StoryTimer({required this.onComplete});
  @override
  State<_Stage2StoryTimer> createState() => _Stage2StoryTimerState();
}

class _Stage2StoryTimerState extends State<_Stage2StoryTimer> with SingleTickerProviderStateMixin {
  final List<String> stories = [
    "What if there was an AI that really understood you, and helped you become more yourself?",
    "Backed by research. Designed for sovereignty.",
    "A Sovereign Digital Persona.\nYour data, your rules.",
    "Completely local.\nCompletely yours.",
  ];
  int currentIndex = 0;
  late AnimationController _progressController;

  @override
  void initState() {
    super.initState();
    _progressController = AnimationController(vsync: this, duration: const Duration(seconds: 4));
    _startStory();
  }

  void _startStory() {
    _progressController.forward(from: 0).whenComplete(() {
      if (currentIndex < stories.length - 1) {
        setState(() => currentIndex++);
        _startStory();
      } else {
        widget.onComplete();
      }
    });
  }

  @override
  void dispose() {
    _progressController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        // Show vibrant background on the final story
        if (currentIndex == 3)
          Positioned.fill(
            child: const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [ALTColors.irisViolet, ALTColors.jadeSurge],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
              ),
            ).animate().fadeIn(duration: 1.seconds),
          ),
        
        Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 16.0),
              child: Row(
                children: List.generate(stories.length, (index) {
                  return Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 4.0),
                      child: AnimatedBuilder(
                        animation: _progressController,
                        builder: (context, child) {
                          double progress = 0;
                          if (index < currentIndex) progress = 1.0;
                          else if (index == currentIndex) progress = _progressController.value;
                          
                          return LinearProgressIndicator(
                            value: progress,
                            backgroundColor: ALTColors.violet100.withOpacity(0.3),
                            valueColor: const AlwaysStoppedAnimation<Color>(ALTColors.irisViolet),
                            minHeight: 4,
                            borderRadius: BorderRadius.circular(2),
                          );
                        },
                      ),
                    ),
                  );
                }),
              ),
            ),
            Expanded(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(32.0),
                  child: Text(
                    stories[currentIndex],
                    style: ALTTypography.headlineLarge.copyWith(
                      color: currentIndex == 3 ? Colors.white : (Theme.of(context).brightness == Brightness.dark ? Colors.white : Colors.black),
                    ),
                    textAlign: TextAlign.center,
                  ).animate(key: ValueKey(currentIndex)).fadeIn(duration: 500.ms).slideY(begin: 0.2, end: 0),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(24.0),
              child: TextButton(
                onPressed: widget.onComplete,
                child: Text("Skip", style: TextStyle(color: currentIndex == 3 ? Colors.white70 : ALTColors.lightTextMuted)),
              ),
            )
          ],
        ),
      ],
    );
  }
}

// -----------------------------------------------------------------------------
// STAGE 3: AUTH SPLASH (Shifting words)
// -----------------------------------------------------------------------------
class _Stage3AuthSplash extends StatefulWidget {
  final VoidCallback onComplete;
  const _Stage3AuthSplash({required this.onComplete});
  @override
  State<_Stage3AuthSplash> createState() => _Stage3AuthSplashState();
}

class _Stage3AuthSplashState extends State<_Stage3AuthSplash> {
  final List<String> phrases = ['digital twin.', 'second self.', 'verified AI.'];
  int currentIndex = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(milliseconds: 2200), (t) {
      if (mounted) setState(() => currentIndex = (currentIndex + 1) % phrases.length);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(28, 32, 28, 40),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const AlterMark(size: 52),
          const SizedBox(height: 36),
          Text('Meet your', style: Ds.display.copyWith(fontSize: 40)),
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 700),
            // The old phrase leaves before the new one arrives, so they never overlap.
            switchInCurve: const Interval(0.45, 1, curve: Curves.easeOutCubic),
            switchOutCurve: const Interval(0.55, 1, curve: Curves.easeIn),
            layoutBuilder: (current, previous) => Stack(alignment: Alignment.centerLeft, children: [...previous, if (current != null) current]),
            transitionBuilder: (child, animation) => FadeTransition(
              opacity: animation,
              child: SlideTransition(position: Tween<Offset>(begin: const Offset(0, 0.25), end: Offset.zero).animate(animation), child: child),
            ),
            child: AuroraText(phrases[currentIndex], key: ValueKey(currentIndex), style: Ds.display.copyWith(fontSize: 40)),
          ),
          const SizedBox(height: 18),
          Text('An AI that speaks like you, learns only what you allow, and carries a verified identity wherever it goes.', style: Ds.callout.copyWith(fontSize: 15)),
          const SizedBox(height: 44),
          Btn('Create my AI', expand: true, onTap: widget.onComplete),
          const SizedBox(height: 14),
          Center(child: Text('Takes about two minutes · you can change everything later', style: Ds.caption.copyWith(color: Ds.textTertiary))),
        ],
      ).animate().fadeIn(duration: Ds.calm),
    );
  }
}

// -----------------------------------------------------------------------------
// STAGE 4: IDENTITY (Name & Age)
// -----------------------------------------------------------------------------
class _Stage4Identity extends StatefulWidget {
  final ValueChanged<String> onNameChanged;
  final ValueChanged<String> onAgeChanged;
  final VoidCallback onComplete;
  const _Stage4Identity({required this.onNameChanged, required this.onAgeChanged, required this.onComplete});
  @override
  State<_Stage4Identity> createState() => _Stage4IdentityState();
}

class _Stage4IdentityState extends State<_Stage4Identity> {
  final TextEditingController _firstNameCtrl = TextEditingController();
  final TextEditingController _lastNameCtrl = TextEditingController();
  final TextEditingController _ageCtrl = TextEditingController();
  bool _showAge = false;

  void _submitName() {
    if (_firstNameCtrl.text.trim().isNotEmpty) {
      widget.onNameChanged("${_firstNameCtrl.text.trim()} ${_lastNameCtrl.text.trim()}".trim());
      setState(() => _showAge = true);
    }
  }

  @override
  void dispose() {
    _firstNameCtrl.dispose();
    _lastNameCtrl.dispose();
    _ageCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(32.0),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AnimatedOpacity(
            opacity: _showAge ? 0.3 : 1.0,
            duration: const Duration(milliseconds: 400),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text("What should I call you?", style: ALTTypography.headlineMedium),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _firstNameCtrl,
                        enabled: !_showAge,
                        decoration: const InputDecoration(hintText: "First name"),
                        onChanged: (v) => setState(() {}),
                        onSubmitted: (_) => _submitName(),
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: TextField(
                        controller: _lastNameCtrl,
                        enabled: !_showAge,
                        decoration: const InputDecoration(hintText: "Last name"),
                        onChanged: (v) => setState(() {}),
                        onSubmitted: (_) => _submitName(),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                if (!_showAge)
                  ALTButton(
                    label: "Next",
                    onPressed: _firstNameCtrl.text.trim().isNotEmpty ? _submitName : null,
                  ),
              ],
            ),
          ),
          if (_showAge) ...[
            const SizedBox(height: 48),
            Text("Hello, ${_firstNameCtrl.text.trim()}.", style: ALTTypography.headlineMedium.copyWith(color: ALTColors.irisViolet))
                .animate().fadeIn().slideY(begin: 0.2, end: 0),
            const SizedBox(height: 24),
            const Text("How old are you?", style: ALTTypography.headlineSmall)
                .animate().fadeIn(delay: 400.ms).slideY(begin: 0.2, end: 0),
            const SizedBox(height: 16),
            TextField(
              controller: _ageCtrl,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(hintText: "Your age"),
              onChanged: (v) => setState(() {}),
            ).animate().fadeIn(delay: 600.ms),
            const SizedBox(height: 24),
            ALTButton(
              label: "Continue",
              onPressed: _ageCtrl.text.trim().isNotEmpty ? () {
                widget.onAgeChanged(_ageCtrl.text.trim());
                widget.onComplete();
              } : null,
            ).animate().fadeIn(delay: 800.ms),
          ]
        ],
      ),
    );
  }
}

// -----------------------------------------------------------------------------
// STAGE 5: DEMOGRAPHICS (Pronouns & Roles)
// -----------------------------------------------------------------------------
class _Stage5Demographics extends StatefulWidget {
  final ValueChanged<String> onPronounChanged;
  final ValueChanged<List<String>> onRolesChanged;
  final VoidCallback onComplete;
  const _Stage5Demographics({required this.onPronounChanged, required this.onRolesChanged, required this.onComplete});
  @override
  State<_Stage5Demographics> createState() => _Stage5DemographicsState();
}

class _Stage5DemographicsState extends State<_Stage5Demographics> {
  String? _pronoun;
  final List<String> _selectedRoles = [];
  final List<String> _availableRoles = ['Student', 'Professional', 'Artist', 'Developer', 'Dreamer', 'Leader', 'Creator'];

  void _toggleRole(String role) {
    setState(() {
      if (_selectedRoles.contains(role)) {
        _selectedRoles.remove(role);
      } else if (_selectedRoles.length < 3) {
        _selectedRoles.add(role);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(32.0),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text("Pronouns", style: ALTTypography.headlineMedium),
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            decoration: const InputDecoration(labelText: 'How should I refer to you?'),
            value: _pronoun,
            items: ['She/Her', 'He/Him', 'They/Them', 'Other', 'Prefer not to say']
                .map((p) => DropdownMenuItem(value: p, child: Text(p))).toList(),
            onChanged: (val) {
              setState(() => _pronoun = val);
              widget.onPronounChanged(val!);
            },
          ),
          const SizedBox(height: 48),
          const Text("Your Interests / Roles", style: ALTTypography.headlineMedium),
          const Text("Pick up to 3.", style: ALTTypography.bodyMedium),
          const SizedBox(height: 16),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: _availableRoles.map((role) {
              final isSelected = _selectedRoles.contains(role);
              return GestureDetector(
                onTap: () => _toggleRole(role),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  decoration: BoxDecoration(
                    color: isSelected ? ALTColors.irisViolet : Colors.transparent,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: isSelected ? ALTColors.irisViolet : ALTColors.lightTextMuted),
                  ),
                  child: Text(
                    role, 
                    style: TextStyle(color: isSelected ? Colors.white : (Theme.of(context).brightness == Brightness.dark ? Colors.white : Colors.black)),
                  ),
                ),
              );
            }).toList(),
          ),
          const Spacer(),
          SizedBox(
            width: double.infinity,
            child: ALTButton(
              label: "Continue",
              onPressed: (_pronoun != null && _selectedRoles.isNotEmpty) ? () {
                widget.onRolesChanged(_selectedRoles);
                widget.onComplete();
              } : null,
            ),
          )
        ],
      ).animate().fadeIn(),
    );
  }
}

// -----------------------------------------------------------------------------
// STAGE 6: CONSENT ENGINE (Glowing Cards)
// -----------------------------------------------------------------------------
class _Stage6Consent extends StatefulWidget {
  final Function(bool, bool, bool, bool) onComplete;
  const _Stage6Consent({required this.onComplete});
  @override
  State<_Stage6Consent> createState() => _Stage6ConsentState();
}

class _Stage6ConsentState extends State<_Stage6Consent> {
  bool c1 = false, c2 = false, c3 = false, c4 = false;

  Widget _buildCard(String title, bool val, VoidCallback onTap) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: val ? ALTColors.irisViolet.withOpacity(0.15) : (Theme.of(context).brightness == Brightness.dark ? ALTColors.darkBgSurface02 : ALTColors.lightBgSurface02),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: val ? ALTColors.irisViolet : Colors.transparent),
          ),
          child: Row(
            children: [
              Icon(val ? Icons.check_circle : Icons.radio_button_unchecked, color: val ? ALTColors.irisViolet : ALTColors.lightTextMuted),
              const SizedBox(width: 16),
              Expanded(child: Text(title, style: ALTTypography.bodyLarge)),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24.0),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text("Your data, your choice", style: ALTTypography.headlineLarge),
          const SizedBox(height: 8),
          const Text("Each choice is recorded and can be changed any time in Settings. The first one is needed to build your AI.",
              style: ALTTypography.bodyMedium),
          const SizedBox(height: 24),
          Expanded(
            child: SingleChildScrollView(
              child: Column(children: [
                _buildCard(consentScopes['persona_training']!, c1, () => setState(() => c1 = !c1)),
                _buildCard(consentScopes['third_party_processing']!, c2, () => setState(() => c2 = !c2)),
                _buildCard(consentScopes['public_deployment']!, c3, () => setState(() => c3 = !c3)),
                _buildCard(consentScopes['interaction_learning']!, c4, () => setState(() => c4 = !c4)),
              ]),
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ALTButton(
              label: "Confirm",
              onPressed: c1 ? () => widget.onComplete(c1, c2, c3, c4) : null,
            ),
          )
        ],
      ).animate().fadeIn(),
    );
  }
}

// -----------------------------------------------------------------------------
// STAGE 7: AVATAR SELECTION
// -----------------------------------------------------------------------------
class _Stage7Avatar extends StatefulWidget {
  final ValueChanged<String?> onAvatarSelected;
  final VoidCallback onComplete;
  const _Stage7Avatar({required this.onAvatarSelected, required this.onComplete});
  @override
  State<_Stage7Avatar> createState() => _Stage7AvatarState();
}

class _Stage7AvatarState extends State<_Stage7Avatar> {
  String? path;

  Future<void> _pick() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery);
    if (picked != null) {
      setState(() => path = picked.path);
      widget.onAvatarSelected(path);
      Future.delayed(const Duration(milliseconds: 500), widget.onComplete);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(32.0),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Text("Setting up your ALT", style: ALTTypography.headlineLarge),
          const SizedBox(height: 16),
          const Text("Give your self-replicating digital twin a face.", style: ALTTypography.bodyLarge, textAlign: TextAlign.center),
          const SizedBox(height: 48),
          GestureDetector(
            onTap: _pick,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 300),
              width: 160,
              height: 160,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: path == null ? ALTColors.violet100.withOpacity(0.2) : ALTColors.irisViolet,
                border: Border.all(color: ALTColors.irisViolet, width: 2),
              ),
              child: path == null
                  ? const Center(child: Icon(Icons.person_add, size: 64, color: ALTColors.irisViolet))
                  : const Center(child: Icon(Icons.check, size: 64, color: Colors.white)),
            ),
          ),
          const SizedBox(height: 48),
          TextButton(
            onPressed: () { widget.onAvatarSelected(null); widget.onComplete(); },
            child: const Text("Skip", style: TextStyle(color: ALTColors.lightTextMuted, fontSize: 18)),
          )
        ],
      ).animate().fadeIn(),
    );
  }
}

// -----------------------------------------------------------------------------
// STAGE 8: SWIPE PROFILING
// -----------------------------------------------------------------------------
class _Stage8SwipeProfile extends StatefulWidget {
  final ValueChanged<String> onTraitSelected;
  final VoidCallback onComplete;
  const _Stage8SwipeProfile({required this.onTraitSelected, required this.onComplete});
  @override
  State<_Stage8SwipeProfile> createState() => _Stage8SwipeProfileState();
}

class _Stage8SwipeProfileState extends State<_Stage8SwipeProfile> {
  double _dragOffset = 0;

  void _onDragEnd(DragEndDetails details) {
    if (_dragOffset > 100) {
      widget.onTraitSelected("Creative");
      widget.onComplete();
    } else if (_dragOffset < -100) {
      widget.onTraitSelected("Logical");
      widget.onComplete();
    } else {
      setState(() => _dragOffset = 0);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bgColor = _dragOffset > 0 
        ? ALTColors.solarEmber.withOpacity((_dragOffset / 200).clamp(0.0, 0.5))
        : ALTColors.jadeSurge.withOpacity((_dragOffset.abs() / 200).clamp(0.0, 0.5));

    return AnimatedContainer(
      duration: const Duration(milliseconds: 100),
      color: bgColor,
      child: Padding(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text("Profile your ALT", style: ALTTypography.headlineLarge),
            const SizedBox(height: 16),
            const Text("Swipe the card to choose its core trait.", style: ALTTypography.bodyLarge),
            const SizedBox(height: 64),
            GestureDetector(
              onHorizontalDragUpdate: (d) => setState(() => _dragOffset += d.delta.dx),
              onHorizontalDragEnd: _onDragEnd,
              child: Transform.translate(
                offset: Offset(_dragOffset, 0),
                child: Transform.rotate(
                  angle: _dragOffset / 500,
                  child: ALTCard(
                    padding: const EdgeInsets.all(32),
                    child: Column(
                      children: [
                        const Icon(Icons.psychology, size: 64, color: ALTColors.irisViolet),
                        const SizedBox(height: 16),
                        Text(
                          _dragOffset > 20 ? "Creative ->" : (_dragOffset < -20 ? "<- Logical" : "< Swipe >"),
                          style: ALTTypography.headlineSmall,
                        )
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ).animate().fadeIn(),
      ),
    );
  }
}

// -----------------------------------------------------------------------------
// STAGE 9: GENERATING TWIN
// -----------------------------------------------------------------------------
class _Stage9Generating extends StatefulWidget {
  final VoidCallback onComplete;
  const _Stage9Generating({required this.onComplete});
  @override
  State<_Stage9Generating> createState() => _Stage9GeneratingState();
}

class _Stage9GeneratingState extends State<_Stage9Generating> with SingleTickerProviderStateMixin {
  late AnimationController _progressController;

  @override
  void initState() {
    super.initState();
    _progressController = AnimationController(vsync: this, duration: const Duration(seconds: 4));
    _progressController.forward().whenComplete(widget.onComplete);
  }

  @override
  void dispose() {
    _progressController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const Icon(Icons.memory, size: 80, color: ALTColors.irisViolet)
            .animate(onPlay: (c) => c.repeat(reverse: true)).scale(begin: const Offset(1,1), end: const Offset(1.2, 1.2), duration: 1.seconds),
        const SizedBox(height: 32),
        const Text("Creating your personal AI...", style: ALTTypography.headlineMedium),
        const SizedBox(height: 48),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 48.0),
          child: AnimatedBuilder(
            animation: _progressController,
            builder: (context, child) {
              return LinearProgressIndicator(
                value: _progressController.value,
                backgroundColor: ALTColors.violet100.withOpacity(0.3),
                valueColor: const AlwaysStoppedAnimation<Color>(ALTColors.irisViolet),
              );
            },
          ),
        ),
      ],
    ).animate().fadeIn();
  }
}
