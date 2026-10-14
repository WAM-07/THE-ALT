import 'package:flutter/material.dart';

import 'colors.dart';
import 'ds.dart';

/// Older gradient names (onboarding, memories, versions), now drawn from the active theme.
class ALTGradients {
  ALTGradients._();

  static RadialGradient get heroAILight => RadialGradient(colors: Ds.palette.signature.take(2).toList(), center: Alignment.center, radius: 1.0);

  static RadialGradient get heroAIDark => RadialGradient(colors: [ALTColors.violet900, ALTColors.irisViolet], center: Alignment.center, radius: 1.0);

  /// The soft light behind those screens (the same for light and dark: the palette decides).
  static List<RadialGradient> get alterDark => [
        RadialGradient(center: const Alignment(-0.8, -0.6), radius: 1.2, colors: [Ds.palette.glow[0].withValues(alpha: Ds.isLight ? 0.7 : 0.35), Colors.transparent]),
        RadialGradient(center: const Alignment(0.8, 0.4), radius: 1.0, colors: [Ds.palette.glow[1].withValues(alpha: Ds.isLight ? 0.5 : 0.25), Colors.transparent]),
      ];

  static List<RadialGradient> get alterLight => alterDark;
}
