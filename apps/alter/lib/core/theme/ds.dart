import 'dart:ui';

import 'package:flutter/material.dart';

/// ALTER's design system ("Obsidian"): a deep, quiet dark canvas, frosted-glass surfaces with
/// hairline borders, one luminous "aurora" gradient reserved for the AI itself, and two typefaces
/// (Sora for display, Inter for everything else). Every screen takes its values from here.
class Ds {
  Ds._();

  // ---------------------------------------------------------------- colour
  static const Color bg = Color(0xFF07070B);
  static const Color bgRaised = Color(0xFF0E0E14);
  static const Color sheet = Color(0xFF111118);

  /// Glass: a whisper of white over the canvas, with a hairline border.
  static const Color glass = Color(0x0CFFFFFF); // ~4.7%
  static const Color glassStrong = Color(0x14FFFFFF); // ~7.8%
  static const Color hairline = Color(0x17FFFFFF); // ~9%
  static const Color hairlineStrong = Color(0x26FFFFFF); // ~15%

  static const Color text = Color(0xFFF4F4F7);
  static const Color textSecondary = Color(0xFFA6A6B2);
  static const Color textTertiary = Color(0xFF6C6C78);

  static const Color iris = Color(0xFF8E7DFF);
  static const Color sky = Color(0xFF5AA9FF);
  static const Color mint = Color(0xFF41E2BE);
  static const Color amber = Color(0xFFF5B862);
  static const Color rose = Color(0xFFFF6B7D);

  /// The AI's colour: used for identity, verification and "the AI is speaking" moments only.
  static const LinearGradient aurora = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF8E7DFF), Color(0xFF5AA9FF), Color(0xFF41E2BE)],
  );

  // ---------------------------------------------------------------- shape and space
  static const double r1 = 12;
  static const double r2 = 18;
  static const double r3 = 24;
  static const double r4 = 32;
  static const double gutter = 20;

  // ---------------------------------------------------------------- type
  static TextStyle _sora(double size, double weight, {double tracking = 0, double height = 1.15, Color color = text}) => TextStyle(
        fontFamily: 'Sora',
        fontSize: size,
        fontWeight: _w(weight),
        fontVariations: [FontVariation('wght', weight)],
        letterSpacing: tracking,
        height: height,
        color: color,
      );
  static TextStyle _inter(double size, double weight, {double tracking = 0, double height = 1.4, Color color = text}) => TextStyle(
        fontFamily: 'Inter',
        fontSize: size,
        fontWeight: _w(weight),
        fontVariations: [FontVariation('wght', weight)],
        letterSpacing: tracking,
        height: height,
        color: color,
      );
  static FontWeight _w(double w) => FontWeight.values[((w / 100).round() - 1).clamp(0, 8)];

  static final TextStyle display = _sora(34, 600, tracking: -0.5, height: 1.1);
  static final TextStyle title1 = _sora(26, 600, tracking: -0.6, height: 1.12);
  static final TextStyle title2 = _sora(20, 600, tracking: -0.3, height: 1.2);
  static final TextStyle headline = _inter(16.5, 600, tracking: -0.2, height: 1.3);
  static final TextStyle body = _inter(15, 400, height: 1.5);
  static final TextStyle bodyStrong = _inter(15, 550, height: 1.45);
  static final TextStyle callout = _inter(14, 400, color: textSecondary, height: 1.45);
  static final TextStyle caption = _inter(12.5, 500, color: textSecondary, height: 1.35);
  static final TextStyle overline = _inter(11, 650, tracking: 1.4, color: textTertiary, height: 1.2);
  static final TextStyle button = _inter(15, 600, tracking: -0.1, height: 1.1);
  static final TextStyle mono = const TextStyle(fontFamily: 'monospace', fontSize: 12.5, color: textSecondary, height: 1.3);

  // ---------------------------------------------------------------- motion
  static const Duration quick = Duration(milliseconds: 160);
  static const Duration calm = Duration(milliseconds: 420);
  static const Curve ease = Cubic(0.2, 0.8, 0.2, 1);

  /// Frosted glass behind floating chrome (dock, sheets).
  static ImageFilter blur([double sigma = 24]) => ImageFilter.blur(sigmaX: sigma, sigmaY: sigma);
}
