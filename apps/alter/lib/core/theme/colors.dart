import 'package:flutter/material.dart';

/// Older colour names, kept so existing screens compile. They now point at the Obsidian palette
/// (see `ds.dart`); ALTER is dark by design, so the light* names resolve to the same dark values.
/// New code should use `Ds` directly.
class ALTColors {
  static const Color irisViolet = Color(0xFF8E7DFF);
  static const Color jadeSurge = Color(0xFF41E2BE);
  static const Color solarEmber = Color(0xFFF5B862);
  static const Color vermillion = Color(0xFFFF6B7D);
  static const Color skyFlux = Color(0xFF5AA9FF);
  static const Color coralPulse = Color(0xFFFF6B7D);

  static const Color darkBgPage = Color(0xFF07070B);
  static const Color darkBgSurface01 = Color(0xFF111118);
  static const Color darkBgSurface02 = Color(0xFF17171F);
  static const Color lightBgPage = darkBgPage;
  static const Color lightBgSurface01 = darkBgSurface01;
  static const Color lightBgSurface02 = darkBgSurface02;

  static const Color darkTextPrimary = Color(0xFFF4F4F7);
  static const Color darkTextSecondary = Color(0xFFA6A6B2);
  static const Color darkTextMuted = Color(0xFF6C6C78);
  static const Color lightTextPrimary = darkTextPrimary;
  static const Color lightTextSecondary = darkTextSecondary;
  static const Color lightTextMuted = darkTextMuted;

  static const Color darkBorderSubtle = Color(0x17FFFFFF);
  static const Color darkBorderStrong = Color(0x26FFFFFF);
  static const Color lightBorderSubtle = darkBorderSubtle;
  static const Color lightBorderStrong = darkBorderStrong;

  static const Color violet100 = Color(0xFFE2DDFF);
  static const Color violet300 = Color(0xFFC4BBFF);
  static const Color violet900 = Color(0xFF2A2350);
  static const Color violet950 = Color(0xFF16122E);

  static const Color activeBg = jadeSurge;
  static const Color activeText = Color(0xFF07070B);
  static const Color errorBg = vermillion;
  static const Color errorText = Color(0xFFFFFFFF);
}
