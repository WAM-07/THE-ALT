import 'package:flutter/material.dart';

import '../ui/ui.dart';

enum ALTButtonVariant { primary, secondary, ghost }

/// Older button name, kept so existing screens compile: now the Obsidian [Btn], full width.
class ALTButton extends StatelessWidget {
  const ALTButton({super.key, required this.label, required this.onPressed, this.variant = ALTButtonVariant.primary, this.isLoading = false, this.icon});
  final String label;
  final VoidCallback? onPressed;
  final ALTButtonVariant variant;
  final bool isLoading;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => Btn(
        label,
        onTap: onPressed,
        icon: icon,
        loading: isLoading,
        expand: true,
        kind: switch (variant) {
          ALTButtonVariant.primary => BtnKind.primary,
          ALTButtonVariant.secondary => BtnKind.secondary,
          ALTButtonVariant.ghost => BtnKind.ghost,
        },
      );
}
