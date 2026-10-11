import 'package:flutter/material.dart';

import '../ui/ui.dart';

/// Older name for the canvas, kept so existing screens compile: it now draws the Obsidian
/// [Backdrop]. `baseColor` and `layers` are ignored.
class GradientBackground extends StatelessWidget {
  const GradientBackground({super.key, required this.child, this.baseColor, this.layers, this.animate = false});
  final Widget child;
  final Color? baseColor;
  final List<RadialGradient>? layers;
  final bool animate;

  @override
  Widget build(BuildContext context) => Backdrop(animate: animate, intensity: animate ? 0.8 : 0.5, child: child);
}
