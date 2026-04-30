import 'package:flutter/material.dart';
import '../../core/theme/colors.dart';
import '../../core/theme/gradients.dart';

class GradientBackground extends StatefulWidget {
  final Widget child;
  final Color baseColor;
  final List<RadialGradient> layers;
  final bool animate;

  const GradientBackground({
    super.key,
    required this.child,
    required this.baseColor,
    required this.layers,
    this.animate = false,
  });

  @override
  State<GradientBackground> createState() => _GradientBackgroundState();
}

class _GradientBackgroundState extends State<GradientBackground> with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 8),
    );
    if (widget.animate) {
      _controller.repeat(reverse: true);
    }
  }

  @override
  void didUpdateWidget(covariant GradientBackground oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.animate && !_controller.isAnimating) {
      _controller.repeat(reverse: true);
    } else if (!widget.animate && _controller.isAnimating) {
      _controller.stop();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      color: widget.baseColor,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, child) {
          return Stack(
            children: [
              ...widget.layers.asMap().entries.map((entry) {
                final int i = entry.key;
                final RadialGradient grad = entry.value;
                
                final Alignment center = grad.center as Alignment;
                final offset = widget.animate 
                    ? Offset(
                        center.x + (i % 2 == 0 ? 0.2 : -0.2) * _controller.value,
                        center.y + (i % 2 == 0 ? -0.2 : 0.2) * _controller.value,
                      )
                    : Offset(center.x, center.y);

                return Positioned.fill(
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: RadialGradient(
                        colors: grad.colors,
                        center: Alignment(offset.dx, offset.dy),
                        radius: grad.radius + (widget.animate ? 0.1 * _controller.value : 0),
                      ),
                    ),
                  ),
                );
              }),
              widget.child,
            ],
          );
        },
      ),
    );
  }
}
