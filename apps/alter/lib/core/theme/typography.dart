import 'package:flutter/material.dart';

import 'ds.dart';

/// Older type names, kept so existing screens (onboarding) compile. Headings use the active theme's
/// display face (Sora or Fraunces), text uses Inter, like `Ds`. Colour is inherited from the theme.
/// New code should use `Ds`.
class ALTTypography {
  static TextStyle get displayLarge => TextStyle(fontFamily: Ds.palette.displayFont, fontSize: 44, fontWeight: FontWeight.w600, fontVariations: [FontVariation('wght', 600)], letterSpacing: -1.4, height: 1.05);
  static TextStyle get displayMedium => TextStyle(fontFamily: Ds.palette.displayFont, fontSize: 36, fontWeight: FontWeight.w600, fontVariations: [FontVariation('wght', 600)], letterSpacing: -1.1, height: 1.08);
  static TextStyle get headlineLarge => TextStyle(fontFamily: Ds.palette.displayFont, fontSize: 28, fontWeight: FontWeight.w600, fontVariations: [FontVariation('wght', 600)], letterSpacing: -0.7, height: 1.12);
  static TextStyle get headlineMedium => TextStyle(fontFamily: Ds.palette.displayFont, fontSize: 22, fontWeight: FontWeight.w600, fontVariations: [FontVariation('wght', 600)], letterSpacing: -0.4, height: 1.18);
  static TextStyle get headlineSmall => TextStyle(fontFamily: Ds.palette.displayFont, fontSize: 18, fontWeight: FontWeight.w600, fontVariations: [FontVariation('wght', 600)], letterSpacing: -0.2, height: 1.25);
  static const TextStyle bodyLarge = TextStyle(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w400, fontVariations: [FontVariation('wght', 400)], height: 1.5);
  static const TextStyle bodyMedium = TextStyle(fontFamily: 'Inter', fontSize: 14.5, fontWeight: FontWeight.w400, fontVariations: [FontVariation('wght', 400)], height: 1.5);
  static const TextStyle bodySmall = TextStyle(fontFamily: 'Inter', fontSize: 12.5, fontWeight: FontWeight.w500, fontVariations: [FontVariation('wght', 500)], height: 1.4, color: Color(0xFFA6A6B2));
  static const TextStyle labelLarge = TextStyle(fontFamily: 'Inter', fontSize: 14.5, fontWeight: FontWeight.w600, fontVariations: [FontVariation('wght', 600)], letterSpacing: -0.1);
  static const TextStyle labelMedium = TextStyle(fontFamily: 'Inter', fontSize: 12, fontWeight: FontWeight.w600, fontVariations: [FontVariation('wght', 600)], letterSpacing: 0.2);
}
