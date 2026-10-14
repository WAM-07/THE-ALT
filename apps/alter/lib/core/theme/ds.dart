import 'dart:ui';

import 'package:flutter/material.dart';

import 'palettes.dart';

/// ALTER's design system. Every screen takes its colours, type and spacing from here. The values
/// come from the active [AlterPalette] (Sapphire by default; Obsidian, the first design, and the
/// other themes are in Profile → Advanced), so they are getters, never `const`.
class Ds {
  Ds._();

  static AlterPalette get palette => AlterThemeController.current.value;
  static bool get isLight => palette.isLight;

  // ---------------------------------------------------------------- colour
  static Color get bg => palette.bg;
  static Color get bgRaised => palette.bgRaised;
  static Color get sheet => palette.sheet;

  /// Cards: frosted glass on dark themes, paper on light ones, with a hairline border.
  static Color get glass => palette.glass;
  static Color get glassStrong => palette.glassStrong;
  static Color get hairline => palette.hairline;
  static Color get hairlineStrong => palette.hairlineStrong;

  static Color get text => palette.text;
  static Color get textSecondary => palette.textSecondary;
  static Color get textTertiary => palette.textTertiary;

  /// The accent (named after Obsidian's iris) and the supporting colours.
  static Color get iris => palette.accent;
  static Color get sky => palette.sky;
  static Color get mint => palette.mint;
  static Color get amber => palette.amber;
  static Color get rose => palette.rose;

  /// Text and icons on the accent or the signature gradient.
  static Color get onAccent => palette.onAccent;

  /// The main button.
  static Color get fill => palette.fill;
  static Color get onFill => palette.onFill;

  /// True for ALTER's first design, drawn exactly as it was.
  static bool get isObsidian => palette.id == 'obsidian';

  /// The AI's colours: used for identity, verification and "the AI is speaking" moments only.
  static LinearGradient get aurora => LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: palette.signature);

  /// A soft shadow that lifts cards off light canvases (none on dark ones, where glass does it).
  static List<BoxShadow> get lift => isLight
      ? [BoxShadow(color: palette.text.withValues(alpha: 0.06), blurRadius: 18, offset: const Offset(0, 6))]
      : const [];

  // ---------------------------------------------------------------- shape and space
  static const double r1 = 12;
  static const double r2 = 18;
  static const double r3 = 24;
  static const double r4 = 32;
  static const double gutter = 20;

  // ---------------------------------------------------------------- type
  static TextStyle _display(double size, {double tracking = 0, double height = 1.15, double? weight}) {
    final w = weight ?? palette.displayWeight;
    final serif = palette.displayFont == 'Fraunces';
    return TextStyle(
      fontFamily: palette.displayFont,
      fontSize: serif ? size * 1.06 : size,
      fontWeight: _w(w),
      fontVariations: [FontVariation('wght', w), if (serif) const FontVariation('opsz', 72)],
      letterSpacing: serif ? tracking * 0.4 : tracking,
      height: height,
      color: text,
    );
  }

  static TextStyle _inter(double size, double weight, {double tracking = 0, double height = 1.4, Color? color}) => TextStyle(
        fontFamily: 'Inter',
        fontSize: size,
        fontWeight: _w(weight),
        fontVariations: [FontVariation('wght', weight)],
        letterSpacing: tracking,
        height: height,
        color: color ?? text,
      );
  static FontWeight _w(double w) => FontWeight.values[((w / 100).round() - 1).clamp(0, 8)];

  static TextStyle get display => _display(34, tracking: -0.5, height: 1.1);
  static TextStyle get title1 => _display(26, tracking: -0.6, height: 1.12);
  static TextStyle get title2 => _display(20, tracking: -0.3, height: 1.2);
  static TextStyle get headline => _inter(16.5, 600, tracking: -0.2, height: 1.3);
  static TextStyle get body => _inter(15, 400, height: 1.5);
  static TextStyle get bodyStrong => _inter(15, 550, height: 1.45);
  static TextStyle get callout => _inter(14, 400, color: textSecondary, height: 1.45);
  static TextStyle get caption => _inter(12.5, 500, color: textSecondary, height: 1.35);
  static TextStyle get overline => _inter(11, 650, tracking: 1.4, color: textTertiary, height: 1.2);
  static TextStyle get button => _inter(15, 600, tracking: -0.1, height: 1.1);
  static TextStyle get mono => TextStyle(fontFamily: 'monospace', fontSize: 12.5, color: textSecondary, height: 1.3);

  // ---------------------------------------------------------------- motion
  static const Duration quick = Duration(milliseconds: 160);
  static const Duration calm = Duration(milliseconds: 420);
  static const Curve ease = Cubic(0.2, 0.8, 0.2, 1);

  /// Frosted glass behind floating chrome (dock, sheets).
  static ImageFilter blur([double sigma = 24]) => ImageFilter.blur(sigmaX: sigma, sigmaY: sigma);
}
