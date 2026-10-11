import 'package:flutter/material.dart';
import 'colors.dart';

class ALTGradients {
  static const RadialGradient heroAILight = RadialGradient(
    colors: [ALTColors.irisViolet, ALTColors.skyFlux],
    center: Alignment.center,
    radius: 1.0,
  );

  static const RadialGradient heroAIDark = RadialGradient(
    colors: [ALTColors.violet900, ALTColors.irisViolet],
    center: Alignment.center,
    radius: 1.0,
  );

  static final List<RadialGradient> alterDark = [
    RadialGradient(
      center: const Alignment(-0.8, -0.6),
      radius: 1.2,
      colors: [ALTColors.violet950.withOpacity(0.5), Colors.transparent],
    ),
    RadialGradient(
      center: const Alignment(0.8, 0.4),
      radius: 1.0,
      colors: [ALTColors.darkBgSurface02.withOpacity(0.3), Colors.transparent],
    ),
  ];

  static final List<RadialGradient> alterLight = [
    RadialGradient(
      center: const Alignment(-0.8, -0.6),
      radius: 1.2,
      colors: [ALTColors.violet100.withOpacity(0.8), Colors.transparent],
    ),
    RadialGradient(
      center: const Alignment(0.8, 0.4),
      radius: 1.0,
      colors: [ALTColors.lightBgSurface02.withOpacity(0.5), Colors.transparent],
    ),
  ];
}
