import 'package:flutter/material.dart';

import 'ds.dart';

/// Older colour names, kept so existing screens (onboarding, memories, versions) compile. They now
/// read the active theme through `Ds`, so those screens follow it too; the light* and dark* names
/// resolve to the same values (the palette decides light or dark). New code should use `Ds`.
class ALTColors {
  ALTColors._();

  static Color get irisViolet => Ds.iris;
  static Color get jadeSurge => Ds.mint;
  static Color get solarEmber => Ds.amber;
  static Color get vermillion => Ds.rose;
  static Color get skyFlux => Ds.sky;
  static Color get coralPulse => Ds.rose;

  static Color get darkBgPage => Ds.bg;
  static Color get darkBgSurface01 => Ds.sheet;
  static Color get darkBgSurface02 => Color.alphaBlend(Ds.glassStrong, Ds.bgRaised);
  static Color get lightBgPage => darkBgPage;
  static Color get lightBgSurface01 => darkBgSurface01;
  static Color get lightBgSurface02 => darkBgSurface02;

  static Color get darkTextPrimary => Ds.text;
  static Color get darkTextSecondary => Ds.textSecondary;
  static Color get darkTextMuted => Ds.textTertiary;
  static Color get lightTextPrimary => darkTextPrimary;
  static Color get lightTextSecondary => darkTextSecondary;
  static Color get lightTextMuted => darkTextMuted;

  static Color get darkBorderSubtle => Ds.hairline;
  static Color get darkBorderStrong => Ds.hairlineStrong;
  static Color get lightBorderSubtle => darkBorderSubtle;
  static Color get lightBorderStrong => darkBorderStrong;

  /// Tints of the accent, from light to deep.
  static Color get violet100 => Color.alphaBlend(Ds.iris.withValues(alpha: 0.15), Ds.text);
  static Color get violet300 => Color.alphaBlend(Ds.iris.withValues(alpha: 0.6), Ds.text);
  static Color get violet900 => Color.alphaBlend(Ds.iris.withValues(alpha: 0.22), Ds.bg);
  static Color get violet950 => Color.alphaBlend(Ds.iris.withValues(alpha: 0.12), Ds.bg);

  static Color get activeBg => Ds.mint;
  static Color get activeText => Ds.bg;
  static Color get errorBg => Ds.rose;
  static Color get errorText => Colors.white;
}
