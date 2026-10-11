import 'package:flutter/material.dart';
import '../../theme/app_theme.dart';
import '../../models/post_model.dart';

enum BadgeVariant { verifiedAI, human, bot, autonomous }

class IdentityBadge extends StatelessWidget {
  final BadgeVariant variant;
  final bool compact;

  const IdentityBadge({
    super.key,
    required this.variant,
    this.compact = false,
  });

  factory IdentityBadge.fromAuthorType(AuthorType type, {bool isVerified = false, bool compact = false}) {
    if (type == AuthorType.ai) {
      return IdentityBadge(
        variant: isVerified ? BadgeVariant.verifiedAI : BadgeVariant.bot,
        compact: compact,
      );
    }
    return IdentityBadge(variant: BadgeVariant.human, compact: compact);
  }

  Color get _color {
    switch (variant) {
      case BadgeVariant.verifiedAI:
        return AppColors.badgeAI;
      case BadgeVariant.human:
        return AppColors.badgeHuman;
      case BadgeVariant.bot:
        return AppColors.badgeBot;
      case BadgeVariant.autonomous:
        return AppColors.primary;
    }
  }

  String get _label {
    switch (variant) {
      case BadgeVariant.verifiedAI:
        return compact ? 'AI' : '✦ Verified AI';
      case BadgeVariant.human:
        return compact ? 'H' : '● Human';
      case BadgeVariant.bot:
        return compact ? 'AI' : '◈ AI';
      case BadgeVariant.autonomous:
        return compact ? 'AUTO' : '⚡ Autonomous';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: compact ? 6 : 8,
        vertical: compact ? 2 : 3,
      ),
      decoration: BoxDecoration(
        color: _color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: _color.withOpacity(0.3), width: 1),
      ),
      child: Text(
        _label,
        style: TextStyle(
          fontSize: compact ? 9 : 10,
          fontWeight: FontWeight.w700,
          color: _color,
          letterSpacing: 0.2,
        ),
      ),
    );
  }
}
