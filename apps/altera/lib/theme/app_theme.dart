import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class AppColors {
  // ─── Light Theme ────────────────────────────────────────────────────────
  static const Color primary = Color(0xFFFF6B2B);
  static const Color primaryLight = Color(0xFFFF8F5E);
  static const Color primaryDark = Color(0xFFE5581E);
  static const Color secondary = Color(0xFFFFB347);
  static const Color accent = Color(0xFFFF3D71);
  
  static const Color background = Color(0xFFFAFAFA);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color surfaceVariant = Color(0xFFF4F4F5);
  static const Color navy = Color(0xFF18181B);
  static const Color text = Color(0xFF27272A);
  static const Color textSecondary = Color(0xFF71717A);
  static const Color textTertiary = Color(0xFFA1A1AA);
  static const Color subtle = Color(0xFFE4E4E7);
  static const Color border = Color(0xFFE4E4E7);
  static const Color divider = Color(0xFFF4F4F5);

  // ─── Dark Theme ─────────────────────────────────────────────────────────
  static const Color backgroundDark = Color(0xFF020617); // Deeper Slate/Black
  static const Color surfaceDark = Color(0xFF0F172A);    // Slate 900
  static const Color surfaceVariantDark = Color(0xFF1E293B); // Slate 800
  static const Color textDark = Color(0xFFF1F5F9);       // Slate 100
  static const Color textSecondaryDark = Color(0xFF94A3B8); // Slate 400
  static const Color textTertiaryDark = Color(0xFF64748B); // Slate 500
  static const Color borderDark = Color(0xFF1E293B);     // Slate 800
  static const Color dividerDark = Color(0xFF0F172A);

  // ─── Semantic ─────────────────────────────────────────────────────────────
  static const Color success = Color(0xFF22C55E);
  static const Color warning = Color(0xFFFFB347);
  static const Color error = Color(0xFFEF4444);
  static const Color info = Color(0xFF0EA5E9);
  
  static const Color badgeAI = Color(0xFF0EA5E9);
  static const Color badgeHuman = Color(0xFF22C55E);
  static const Color badgeBot = Color(0xFF8B5CF6);
  static const Color badgeVerified = Color(0xFF0EA5E9);

  // ─── Gradients ──────────────────────────────────────────────────────────
  static const List<Color> primaryGradient = [Color(0xFFFF6B2B), Color(0xFFFF8F5E)];
  static const List<Color> aiGradient = [Color(0xFF0EA5E9), Color(0xFF8B5CF6)];
  static const List<Color> warmGradient = [Color(0xFFFF6B2B), Color(0xFFFFB347)];
}

class AppTheme {
  static ThemeData get lightTheme => _buildTheme(Brightness.light);
  static ThemeData get darkTheme => _buildTheme(Brightness.dark);

  static ThemeData _buildTheme(Brightness brightness) {
    final bool isDark = brightness == Brightness.dark;
    
    final colorScheme = ColorScheme.fromSeed(
      seedColor: AppColors.primary,
      brightness: brightness,
      primary: AppColors.primary,
      surface: isDark ? AppColors.surfaceDark : AppColors.surface,
      onSurface: isDark ? AppColors.textDark : AppColors.text,
      background: isDark ? AppColors.backgroundDark : AppColors.background,
      error: AppColors.error,
    );

    final baseTextTheme = isDark 
        ? GoogleFonts.interTextTheme().apply(bodyColor: AppColors.textDark, displayColor: AppColors.textDark)
        : GoogleFonts.interTextTheme().apply(bodyColor: AppColors.text, displayColor: AppColors.text);

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: isDark ? AppColors.backgroundDark : AppColors.background,
      cardColor: isDark ? AppColors.surfaceDark : AppColors.surface,
      dividerColor: isDark ? AppColors.dividerDark : AppColors.divider,
      hintColor: isDark ? AppColors.textSecondaryDark : AppColors.textSecondary,
      
      textTheme: baseTextTheme.copyWith(
        displayMedium: GoogleFonts.inter(fontWeight: FontWeight.w800, color: isDark ? AppColors.textDark : AppColors.navy),
        headlineMedium: GoogleFonts.inter(fontWeight: FontWeight.w700, color: isDark ? AppColors.textDark : AppColors.navy),
        titleLarge: GoogleFonts.inter(fontWeight: FontWeight.w600, color: isDark ? AppColors.textDark : AppColors.text),
        bodyLarge: GoogleFonts.inter(fontSize: 16, color: isDark ? AppColors.textDark : AppColors.text),
        bodyMedium: GoogleFonts.inter(fontSize: 14, color: isDark ? AppColors.textSecondaryDark : AppColors.textSecondary),
      ),

      appBarTheme: AppBarTheme(
        backgroundColor: isDark ? AppColors.backgroundDark : AppColors.surface,
        elevation: 0,
        centerTitle: true,
        titleTextStyle: GoogleFonts.inter(fontSize: 18, fontWeight: FontWeight.w700, color: isDark ? AppColors.textDark : AppColors.navy),
        iconTheme: IconThemeData(color: isDark ? AppColors.textDark : AppColors.navy),
      ),

      cardTheme: CardThemeData(
        color: isDark ? AppColors.surfaceDark : AppColors.surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: isDark ? AppColors.borderDark : AppColors.border),
        ),
      ),

      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? Color(0xFF0F172A) : AppColors.divider,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: isDark ? BorderSide(color: AppColors.borderDark) : BorderSide.none),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: isDark ? BorderSide(color: AppColors.borderDark) : BorderSide.none),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: AppColors.primary, width: 1.5)),
        hintStyle: TextStyle(color: isDark ? AppColors.textSecondaryDark : AppColors.textSecondary),
        labelStyle: TextStyle(color: isDark ? AppColors.textSecondaryDark : AppColors.textSecondary),
      ),

      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          minimumSize: const Size(double.infinity, 54),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          elevation: 0,
          textStyle: GoogleFonts.inter(fontWeight: FontWeight.w600, fontSize: 16),
        ),
      ),
      
      tabBarTheme: TabBarThemeData(
        labelColor: AppColors.primary,
        unselectedLabelColor: isDark ? AppColors.textSecondaryDark : AppColors.textSecondary,
        indicatorColor: AppColors.primary,
      ),
    );
  }
}
