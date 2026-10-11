import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/colors.dart';

class ScaffoldWithNavBar extends StatelessWidget {
  final StatefulNavigationShell navigationShell;

  const ScaffoldWithNavBar({
    super.key,
    required this.navigationShell,
  });

  void _goBranch(int index) {
    navigationShell.goBranch(
      index,
      initialLocation: index == navigationShell.currentIndex,
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: navigationShell,
      extendBody: true, // Allows body to go behind the floating nav bar
      bottomNavigationBar: SafeArea(
        child: Container(
          margin: const EdgeInsets.only(left: 16, right: 16, bottom: 16),
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          decoration: BoxDecoration(
            color: isDark ? ALTColors.darkBgSurface01 : ALTColors.lightBgSurface01,
            borderRadius: BorderRadius.circular(32),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: isDark ? 0.4 : 0.1),
                blurRadius: 20,
                offset: const Offset(0, 10),
              )
            ],
            border: Border.all(
              color: isDark ? ALTColors.darkBorderSubtle : ALTColors.lightBorderSubtle,
              width: 1,
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _NavBarIcon(
                icon: Icons.auto_awesome,
                label: 'Home',
                isSelected: navigationShell.currentIndex == 0,
                onTap: () => _goBranch(0),
              ),
              _NavBarIcon(
                icon: Icons.chat_bubble_outline,
                label: 'Chat',
                isSelected: navigationShell.currentIndex == 1,
                onTap: () => _goBranch(1),
              ),
              _NavBarIcon(
                icon: Icons.storage,
                label: 'Data',
                isSelected: navigationShell.currentIndex == 2,
                onTap: () => _goBranch(2),
              ),
              _NavBarIcon(
                icon: Icons.memory,
                label: 'Deploy',
                isSelected: navigationShell.currentIndex == 3,
                onTap: () => _goBranch(3),
              ),
              _NavBarIcon(
                icon: Icons.settings,
                label: 'Settings',
                isSelected: navigationShell.currentIndex == 4,
                onTap: () => _goBranch(4),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavBarIcon extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  const _NavBarIcon({
    required this.icon,
    required this.label,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = isSelected ? ALTColors.irisViolet : (Theme.of(context).brightness == Brightness.dark ? ALTColors.darkTextSecondary : ALTColors.lightTextSecondary);
    
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected ? ALTColors.violet100.withValues(alpha: 0.15) : Colors.transparent,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: color, size: 24),
            const SizedBox(height: 4),
            Text(
              label,
              style: TextStyle(
                fontSize: 10,
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
                color: color,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
