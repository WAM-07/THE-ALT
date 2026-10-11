import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/ds.dart';

/// The floating glass dock. Five places: Home, Chat, Studio (what your AI learns), Identity (its
/// versions and on-chain token) and Settings.
class ScaffoldWithNavBar extends StatelessWidget {
  const ScaffoldWithNavBar({super.key, required this.navigationShell});
  final StatefulNavigationShell navigationShell;

  static const _tabs = [
    (Icons.home_outlined, Icons.home_rounded, 'Home'),
    (Icons.chat_bubble_outline_rounded, Icons.chat_bubble_rounded, 'Chat'),
    (Icons.auto_awesome_outlined, Icons.auto_awesome, 'Studio'),
    (Icons.fingerprint_rounded, Icons.fingerprint_rounded, 'Identity'),
    (Icons.tune_rounded, Icons.tune_rounded, 'Settings'),
  ];

  void _go(int index) {
    HapticFeedback.selectionClick();
    navigationShell.goBranch(index, initialLocation: index == navigationShell.currentIndex);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Ds.bg,
      extendBody: true,
      body: Stack(children: [
        navigationShell,
        // Content fades out under the floating dock instead of showing through its edges.
        const Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          height: 120,
          child: IgnorePointer(
            child: DecoratedBox(
              decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0x0007070B), Color(0xE607070B), Color(0xFF07070B)], stops: [0, 0.45, 1])),
            ),
          ),
        ),
      ]),
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.only(bottom: 12),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 18),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(Ds.r4),
            child: BackdropFilter(
              filter: Ds.blur(28),
              child: Container(
                height: 66,
                padding: const EdgeInsets.symmetric(horizontal: 6),
                decoration: BoxDecoration(
                  color: const Color(0xB3121219),
                  borderRadius: BorderRadius.circular(Ds.r4),
                  border: Border.all(color: Ds.hairline),
                ),
                child: Row(children: [
                  for (var i = 0; i < _tabs.length; i++)
                    Expanded(child: _Tab(icon: _tabs[i].$1, activeIcon: _tabs[i].$2, label: _tabs[i].$3, active: navigationShell.currentIndex == i, onTap: () => _go(i))),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Tab extends StatelessWidget {
  const _Tab({required this.icon, required this.activeIcon, required this.label, required this.active, required this.onTap});
  final IconData icon;
  final IconData activeIcon;
  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: active,
      label: label,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          AnimatedContainer(
            duration: Ds.calm,
            curve: Ds.ease,
            width: active ? 46 : 36,
            height: 30,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(15),
              color: active ? Ds.iris.withValues(alpha: 0.18) : Colors.transparent,
            ),
            child: active
                ? ShaderMask(blendMode: BlendMode.srcIn, shaderCallback: (r) => Ds.aurora.createShader(r), child: Icon(activeIcon, size: 21, color: Colors.white))
                : Icon(icon, size: 21, color: Ds.textTertiary),
          ),
          const SizedBox(height: 3),
          AnimatedDefaultTextStyle(
            duration: Ds.quick,
            style: Ds.caption.copyWith(fontSize: 10.5, color: active ? Ds.text : Ds.textTertiary, fontWeight: active ? FontWeight.w600 : FontWeight.w500),
            child: Text(label),
          ),
        ]),
      ),
    );
  }
}
