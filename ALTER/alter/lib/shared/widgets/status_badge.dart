import 'package:flutter/material.dart';
import '../../core/theme/colors.dart';
import '../../core/theme/typography.dart';

enum BadgeType { active, pending, error, complete }

class StatusBadge extends StatefulWidget {
  final String label;
  final BadgeType type;

  const StatusBadge({
    super.key,
    required this.label,
    required this.type,
  });

  @override
  State<StatusBadge> createState() => _StatusBadgeState();
}

class _StatusBadgeState extends State<StatusBadge> with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;
  late Animation<double> _opacityAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    );

    _scaleAnimation = TweenSequence<double>([
      TweenSequenceItem(tween: Tween(begin: 1.0, end: 1.4), weight: 50),
      TweenSequenceItem(tween: Tween(begin: 1.4, end: 1.0), weight: 50),
    ]).animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));

    _opacityAnimation = TweenSequence<double>([
      TweenSequenceItem(tween: Tween(begin: 1.0, end: 0.3), weight: 50),
      TweenSequenceItem(tween: Tween(begin: 0.3, end: 1.0), weight: 50),
    ]).animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));

    if (widget.type == BadgeType.active) {
      _controller.repeat();
    }
  }

  @override
  void didUpdateWidget(covariant StatusBadge oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.type == BadgeType.active && !oldWidget.type.name.contains('active')) {
      _controller.repeat();
    } else if (widget.type != BadgeType.active && _controller.isAnimating) {
      _controller.stop();
      _controller.reset();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    Color bg;
    Color fg;
    Color dotColor;

    switch (widget.type) {
      case BadgeType.active:
        bg = isDark ? ALTColors.darkBgSurface02 : ALTColors.lightBgSurface02;
        fg = isDark ? Colors.white : Colors.black;
        dotColor = ALTColors.jadeSurge;
        break;
      case BadgeType.pending:
        bg = ALTColors.solarEmber.withOpacity(0.15);
        fg = ALTColors.solarEmber;
        dotColor = ALTColors.solarEmber;
        break;
      case BadgeType.error:
        bg = ALTColors.vermillion.withOpacity(0.15);
        fg = ALTColors.vermillion;
        dotColor = ALTColors.vermillion;
        break;
      case BadgeType.complete:
        bg = ALTColors.jadeSurge.withOpacity(0.15);
        fg = ALTColors.jadeSurge;
        dotColor = ALTColors.jadeSurge;
        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: dotColor.withOpacity(0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (widget.type == BadgeType.active)
            AnimatedBuilder(
              animation: _controller,
              builder: (context, child) {
                return Transform.scale(
                  scale: _scaleAnimation.value,
                  child: Opacity(
                    opacity: _opacityAnimation.value,
                    child: Container(
                      width: 6,
                      height: 6,
                      decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle),
                    ),
                  ),
                );
              },
            )
          else
            Container(width: 6, height: 6, decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle)),
          const SizedBox(width: 6),
          Text(widget.label, style: ALTTypography.labelMedium.copyWith(color: fg)),
        ],
      ),
    );
  }
}
