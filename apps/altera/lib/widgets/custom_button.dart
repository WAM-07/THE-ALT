import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../theme/app_theme.dart';

class AlteraButton extends StatefulWidget {
  final String label;
  final VoidCallback onPressed;
  final bool isLoading;
  final bool isEnabled;
  final double? width;
  final double height;
  final ButtonVariant variant;
  final IconData? icon;
  final bool fullWidth;

  const AlteraButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.isLoading = false,
    this.isEnabled = true,
    this.width,
    this.height = 48,
    this.variant = ButtonVariant.primary,
    this.icon,
    this.fullWidth = false,
  });

  @override
  State<AlteraButton> createState() => _AlteraButtonState();
}

class _AlteraButtonState extends State<AlteraButton>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 200),
      vsync: this,
    );
    _scaleAnimation = Tween<double>(begin: 1.0, end: 0.95).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onPressed() {
    if (widget.isEnabled && !widget.isLoading) {
      _controller.forward().then((_) => _controller.reverse());
      widget.onPressed();
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDisabled = !widget.isEnabled || widget.isLoading;

    return ScaleTransition(
      scale: _scaleAnimation,
      child: SizedBox(
        width: widget.fullWidth ? double.infinity : widget.width,
        height: widget.height,
        child: _buildButton(isDisabled),
      ),
    );
  }

  Widget _buildButton(bool isDisabled) {
    switch (widget.variant) {
      case ButtonVariant.primary:
        return _buildPrimaryButton(isDisabled);
      case ButtonVariant.secondary:
        return _buildSecondaryButton(isDisabled);
      case ButtonVariant.tertiary:
        return _buildTertiaryButton(isDisabled);
      case ButtonVariant.danger:
        return _buildDangerButton(isDisabled);
    }
  }

  Widget _buildPrimaryButton(bool isDisabled) {
    return FilledButton(
      onPressed: isDisabled ? null : _onPressed,
      child: _buildButtonContent(),
    );
  }

  Widget _buildSecondaryButton(bool isDisabled) {
    return OutlinedButton(
      onPressed: isDisabled ? null : _onPressed,
      child: _buildButtonContent(invert: true),
    );
  }

  Widget _buildTertiaryButton(bool isDisabled) {
    return TextButton(
      onPressed: isDisabled ? null : _onPressed,
      child: _buildButtonContent(invert: true),
    );
  }

  Widget _buildDangerButton(bool isDisabled) {
    return FilledButton(
      onPressed: isDisabled ? null : _onPressed,
      style: FilledButton.styleFrom(
        backgroundColor: AppColors.error,
        foregroundColor: Colors.white,
      ),
      child: _buildButtonContent(),
    );
  }

  Widget _buildButtonContent({bool invert = false}) {
    if (widget.isLoading) {
      return SizedBox(
        height: 20,
        width: 20,
        child: CircularProgressIndicator(
          strokeWidth: 2,
          valueColor: AlwaysStoppedAnimation<Color>(
            invert ? AppColors.primary : Colors.white,
          ),
        ),
      );
    }

    if (widget.icon != null) {
      return Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(widget.icon, size: 20),
          const SizedBox(width: 8),
          Text(widget.label),
        ],
      );
    }

    return Text(widget.label);
  }
}

enum ButtonVariant { primary, secondary, tertiary, danger }
