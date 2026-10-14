import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// One complete look for ALTER: colours, the AI's signature gradient, the display typeface and how
/// surfaces are drawn. `Ds` reads every value from the active palette, so switching it re-themes
/// the whole app. The switch is tucked away in Profile → Advanced on purpose.
class AlterPalette {
  const AlterPalette({
    required this.id,
    required this.name,
    required this.note,
    required this.brightness,
    required this.bg,
    required this.bgRaised,
    required this.sheet,
    required this.glass,
    required this.glassStrong,
    required this.hairline,
    required this.hairlineStrong,
    required this.text,
    required this.textSecondary,
    required this.textTertiary,
    required this.accent,
    required this.sky,
    required this.mint,
    required this.amber,
    required this.rose,
    required this.signature,
    required this.onAccent,
    required this.displayFont,
    required this.glow,
    required this.fill,
    required this.onFill,
    required this.cardBase,
    required this.cardGlows,
    required this.cardInk,
    required this.cardEdge,
    this.displayWeight = 600,
  });

  final String id;
  final String name;
  final String note;
  final Brightness brightness;

  /// The canvas, raised surfaces (dock, snack bars) and sheets.
  final Color bg;
  final Color bgRaised;
  final Color sheet;

  /// Cards ("glass" on dark themes, porcelain-like paper on light ones) and their borders.
  final Color glass;
  final Color glassStrong;
  final Color hairline;
  final Color hairlineStrong;

  final Color text;
  final Color textSecondary;
  final Color textTertiary;

  /// The main accent (buttons, links, selection) and the supporting colours.
  final Color accent;
  final Color sky;
  final Color mint;
  final Color amber;
  final Color rose;

  /// The AI's own colours: identity, verification and "the AI is speaking" moments only.
  final List<Color> signature;

  /// Text and icons drawn on the accent or the signature gradient.
  final Color onAccent;

  /// Headings: 'Sora' (modern) or 'Fraunces' (an editorial serif).
  final String displayFont;
  final double displayWeight;

  /// The soft light behind the canvas (Backdrop): two colours that drift.
  final List<Color> glow;

  /// The main button: its fill and the text on it.
  final Color fill;
  final Color onFill;

  /// The AI identity card's material: base gradient, three pools of light (top-left, bottom-right,
  /// top-right; verified AIs only), its ink and its edge.
  final List<Color> cardBase;
  final List<Color> cardGlows;
  final Color cardInk;
  final Color cardEdge;

  bool get isLight => brightness == Brightness.light;
}

/// The themes to try. Sapphire is the default; Obsidian is ALTER's first design, kept as it was.
class AlterPalettes {
  AlterPalettes._();

  /// Royal Blue, Sapphire, Quicksand, Swan Wing and Shellstone: night blue with a gold signature.
  static const sapphire = AlterPalette(
    id: 'sapphire',
    name: 'Sapphire',
    note: 'Royal blue and quicksand gold, with an editorial serif.',
    brightness: Brightness.dark,
    bg: Color(0xFF0D1A3F),
    bgRaised: Color(0xFF112250),
    sheet: Color(0xFF15295C),
    glass: Color(0x4D3C507D),
    glassStrong: Color(0x803C507D),
    hairline: Color(0x26D9CBC2),
    hairlineStrong: Color(0x40D9CBC2),
    text: Color(0xFFF5FDE9),
    textSecondary: Color(0xFFD9CBC2),
    textTertiary: Color(0xFF9DA3BC),
    accent: Color(0xFFE0C58F),
    sky: Color(0xFF9DB2E0),
    mint: Color(0xFF9ED6B4),
    amber: Color(0xFFE8B86B),
    rose: Color(0xFFF0908E),
    signature: [Color(0xFFE0C58F), Color(0xFFF3E6C4), Color(0xFFC6A86C)],
    onAccent: Color(0xFF112250),
    displayFont: 'Fraunces',
    displayWeight: 560,
    glow: [Color(0xFF3C507D), Color(0xFF6B5A3A)],
    fill: Color(0xFFE0C58F),
    onFill: Color(0xFF112250),
    cardBase: [Color(0xFF22386E), Color(0xFF0B1636)],
    cardGlows: [Color(0x80E0C58F), Color(0x663C507D), Color(0x40F5FDE9)],
    cardInk: Color(0xFFF5FDE9),
    cardEdge: Color(0x99E0C58F),
  );

  /// Linen, Khaki, Camel, Cocoa and Espresso: a warm, paper-light theme.
  static const linen = AlterPalette(
    id: 'linen',
    name: 'Linen',
    note: 'Warm linen and espresso, light and calm like good paper.',
    brightness: Brightness.light,
    bg: Color(0xFFF5F1EA),
    bgRaised: Color(0xFFFBF8F3),
    sheet: Color(0xFFFBF8F3),
    glass: Color(0xFFFCFAF6),
    glassStrong: Color(0xFFEDE5DA),
    hairline: Color(0xFFE2D7C9),
    hairlineStrong: Color(0xFFCDBBA6),
    text: Color(0xFF4A342A),
    textSecondary: Color(0xFF7D5A44),
    textTertiary: Color(0xFF9E8268),
    accent: Color(0xFF7D5A44),
    sky: Color(0xFF7F8C6B),
    mint: Color(0xFF5F8455),
    amber: Color(0xFFB07F33),
    rose: Color(0xFFB0514A),
    signature: [Color(0xFFB2967D), Color(0xFF7D5A44), Color(0xFF4A342A)],
    onAccent: Color(0xFFF5F1EA),
    displayFont: 'Fraunces',
    displayWeight: 560,
    glow: [Color(0xFFD7C9B8), Color(0xFFE9DCC9)],
    fill: Color(0xFF4A342A),
    onFill: Color(0xFFF5F1EA),
    cardBase: [Color(0xFF6B4D3B), Color(0xFF3A2920)],
    cardGlows: [Color(0x80B2967D), Color(0x55D7C9B8), Color(0x33F5F1EA)],
    cardInk: Color(0xFFF5F1EA),
    cardEdge: Color(0x66D7C9B8),
  );

  /// ALTER's first design: obsidian glass with the iris-to-mint aurora.
  static const obsidian = AlterPalette(
    id: 'obsidian',
    name: 'Obsidian',
    note: 'The original: dark glass and the aurora.',
    brightness: Brightness.dark,
    bg: Color(0xFF07070B),
    bgRaised: Color(0xFF0E0E14),
    sheet: Color(0xFF111118),
    glass: Color(0x0CFFFFFF),
    glassStrong: Color(0x14FFFFFF),
    hairline: Color(0x17FFFFFF),
    hairlineStrong: Color(0x26FFFFFF),
    text: Color(0xFFF4F4F7),
    textSecondary: Color(0xFFA6A6B2),
    textTertiary: Color(0xFF6C6C78),
    accent: Color(0xFF8E7DFF),
    sky: Color(0xFF5AA9FF),
    mint: Color(0xFF41E2BE),
    amber: Color(0xFFF5B862),
    rose: Color(0xFFFF6B7D),
    signature: [Color(0xFF8E7DFF), Color(0xFF5AA9FF), Color(0xFF41E2BE)],
    onAccent: Colors.white,
    displayFont: 'Sora',
    glow: [Color(0xFF8E7DFF), Color(0xFF41E2BE)],
    fill: Color(0xFFF4F4F7),
    onFill: Color(0xFF07070B),
    cardBase: [Color(0xFF15122A), Color(0xFF0B0B14)],
    cardGlows: [Color(0x998E7DFF), Color(0x8841E2BE), Color(0x665AA9FF)],
    cardInk: Colors.white,
    cardEdge: Color(0x26FFFFFF),
  );

  /// Deep emerald with brass and ivory: a club-library feel.
  static const emerald = AlterPalette(
    id: 'emerald',
    name: 'Emerald',
    note: 'Deep green, brass and ivory.',
    brightness: Brightness.dark,
    bg: Color(0xFF0A1B16),
    bgRaised: Color(0xFF0F261F),
    sheet: Color(0xFF122B23),
    glass: Color(0x1AE8E2D0),
    glassStrong: Color(0x2BE8E2D0),
    hairline: Color(0x21E8E2D0),
    hairlineStrong: Color(0x38E8E2D0),
    text: Color(0xFFF1EEE4),
    textSecondary: Color(0xFFBAC4B8),
    textTertiary: Color(0xFF7F8D84),
    accent: Color(0xFFC9A86A),
    sky: Color(0xFF8FB8A8),
    mint: Color(0xFF7FD1A8),
    amber: Color(0xFFE0B060),
    rose: Color(0xFFE58A7C),
    signature: [Color(0xFFC9A86A), Color(0xFFE8D6A6), Color(0xFF8FB8A8)],
    onAccent: Color(0xFF0A1B16),
    displayFont: 'Fraunces',
    displayWeight: 560,
    glow: [Color(0xFF1F5A47), Color(0xFF5E4C26)],
    fill: Color(0xFFC9A86A),
    onFill: Color(0xFF0A1B16),
    cardBase: [Color(0xFF184536), Color(0xFF08160F)],
    cardGlows: [Color(0x80C9A86A), Color(0x558FB8A8), Color(0x33F1EEE4)],
    cardInk: Color(0xFFF1EEE4),
    cardEdge: Color(0x80C9A86A),
  );

  /// Cool porcelain and ink: crisp, light and quiet.
  static const porcelain = AlterPalette(
    id: 'porcelain',
    name: 'Porcelain',
    note: 'Cool white and ink, crisp and minimal.',
    brightness: Brightness.light,
    bg: Color(0xFFF2F3F5),
    bgRaised: Color(0xFFFFFFFF),
    sheet: Color(0xFFFFFFFF),
    glass: Color(0xFFFFFFFF),
    glassStrong: Color(0xFFE7E9ED),
    hairline: Color(0xFFE1E4E9),
    hairlineStrong: Color(0xFFC9CED6),
    text: Color(0xFF15171C),
    textSecondary: Color(0xFF555B66),
    textTertiary: Color(0xFF878D97),
    accent: Color(0xFF22293A),
    sky: Color(0xFF4F6D8F),
    mint: Color(0xFF2F8F6B),
    amber: Color(0xFFB7791F),
    rose: Color(0xFFC2414B),
    signature: [Color(0xFF22293A), Color(0xFF5A6884), Color(0xFFA9B4C6)],
    onAccent: Colors.white,
    displayFont: 'Sora',
    glow: [Color(0xFFDDE3EC), Color(0xFFEDE8E1)],
    fill: Color(0xFF15171C),
    onFill: Colors.white,
    cardBase: [Color(0xFF2E3546), Color(0xFF14171F)],
    cardGlows: [Color(0x55A9B4C6), Color(0x33FFFFFF), Color(0x40C9CED6)],
    cardInk: Colors.white,
    cardEdge: Color(0x40FFFFFF),
  );

  static const all = [sapphire, linen, obsidian, emerald, porcelain];
  static const fallback = sapphire;

  static AlterPalette byId(String? id) => all.firstWhere((p) => p.id == id, orElse: () => fallback);
}

/// The active palette, remembered on this phone.
class AlterThemeController {
  AlterThemeController._();

  static const _key = 'alter.theme';
  static final ValueNotifier<AlterPalette> current = ValueNotifier<AlterPalette>(AlterPalettes.fallback);

  static Future<void> load() async {
    try {
      current.value = AlterPalettes.byId((await SharedPreferences.getInstance()).getString(_key));
    } catch (_) {}
    _applySystemBars();
  }

  static Future<void> set(AlterPalette palette) async {
    current.value = palette;
    _applySystemBars();
    try {
      await (await SharedPreferences.getInstance()).setString(_key, palette.id);
    } catch (_) {}
  }

  static void _applySystemBars() {
    final light = current.value.isLight;
    SystemChrome.setSystemUIOverlayStyle(SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: light ? Brightness.dark : Brightness.light,
      statusBarBrightness: light ? Brightness.light : Brightness.dark,
      systemNavigationBarColor: current.value.bg,
      systemNavigationBarIconBrightness: light ? Brightness.dark : Brightness.light,
    ));
  }
}
