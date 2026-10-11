import 'package:flutter/material.dart';
import '../../core/theme/colors.dart';
import '../../core/theme/typography.dart';

enum ALTButtonVariant { primary, secondary, ghost }

class ALTButton extends StatefulWidget {
  final String label;
  final VoidCallback? onPressed;
  final ALTButtonVariant variant;
  final bool isLoading;
  final IconData? icon;

  const ALTButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.variant = ALTButtonVariant.primary,
    this.isLoading = false,
    this.icon,
  });

  @override
  State<ALTButton> createState() => _ALTButtonState();
}

class _ALTButtonState extends State<ALTButton> with SingleTickerProviderStateMixin {
  late AnimationController _scaleController;
  late Animation<double> _scaleAnimation;

  @override
  void initState() {
    super.initState();
    _scaleController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 80),
    );
    _scaleAnimation = Tween<double>(begin: 1.0, end: 0.97).animate(
      CurvedAnimation(parent: _scaleController, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _scaleController.dispose();
    super.dispose();
  }

  void _onTapDown(TapDownDetails details) {
    if (widget.onPressed != null && !widget.isLoading) _scaleController.forward();
  }

  void _onTapUp(TapUpDetails details) {
    _scaleController.reverse();
  }

  void _onTapCancel() {
    _scaleController.reverse();
  }

  @override
  Widget build(BuildContext context) {
    final bool isDisabled = widget.onPressed == null || widget.isLoading;

    Color bg;
    Color fg;
    BorderSide? border;

    switch (widget.variant) {
      case ALTButtonVariant.primary:
        bg = isDisabled ? ALTColors.violet100 : ALTColors.irisViolet;
        fg = isDisabled ? ALTColors.lightTextMuted : Colors.white;
        break;
      case ALTButtonVariant.secondary:
        bg = Colors.transparent;
        fg = ALTColors.irisViolet;
        border = const BorderSide(color: ALTColors.irisViolet, width: 1.5);
        break;
      case ALTButtonVariant.ghost:
        bg = Colors.transparent;
        fg = ALTColors.irisViolet;
        break;
    }

    final content = Row(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (widget.isLoading) ...[
          SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(strokeWidth: 2, color: fg),
          ),
          const SizedBox(width: 8),
        ] else if (widget.icon != null) ...[
          Icon(widget.icon, size: 18, color: fg),
          const SizedBox(width: 8),
        ],
        Text(widget.label, style: ALTTypography.labelLarge.copyWith(color: fg)),
      ],
    );

    return GestureDetector(
      onTapDown: _onTapDown,
      onTapUp: _onTapUp,
      onTapCancel: _onTapCancel,
      onTap: isDisabled ? null : widget.onPressed,
      child: ScaleTransition(
        scale: _scaleAnimation,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.circular(16),
            border: border != null ? Border.fromBorderSide(border) : null,
          ),
          child: Center(child: content),
        ),
      ),
    );
  }
}
