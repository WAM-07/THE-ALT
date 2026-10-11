import 'package:flutter/material.dart';

import 'ds.dart';

/// One theme: ALTER is dark by design (see `Ds`). `lightTheme` returns the same so the app never
/// flips to a half-styled light mode on phones set to light.
class AppTheme {
  static ThemeData get lightTheme => darkTheme;

  static ThemeData get darkTheme {
    final scheme = const ColorScheme.dark(
      primary: Ds.iris,
      onPrimary: Colors.white,
      secondary: Ds.sky,
      tertiary: Ds.mint,
      error: Ds.rose,
      surface: Ds.bgRaised,
      onSurface: Ds.text,
      onSurfaceVariant: Ds.textSecondary,
      outline: Ds.hairlineStrong,
      outlineVariant: Ds.hairline,
      surfaceContainerHighest: Color(0xFF1A1A22),
      primaryContainer: Color(0xFF231D45),
      onPrimaryContainer: Color(0xFFE2DDFF),
      errorContainer: Color(0xFF3A1820),
    );
    final pill = RoundedRectangleBorder(borderRadius: BorderRadius.circular(Ds.r4));
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: scheme,
      fontFamily: 'Inter',
      scaffoldBackgroundColor: Ds.bg,
      canvasColor: Ds.bg,
      splashFactory: InkSparkle.splashFactory,
      textTheme: TextTheme(
        displayLarge: Ds.display,
        displayMedium: Ds.display,
        headlineLarge: Ds.title1,
        headlineMedium: Ds.title1,
        headlineSmall: Ds.title2,
        titleLarge: Ds.title2,
        titleMedium: Ds.headline,
        titleSmall: Ds.bodyStrong,
        bodyLarge: Ds.body,
        bodyMedium: Ds.body.copyWith(fontSize: 14),
        bodySmall: Ds.caption,
        labelLarge: Ds.button,
        labelMedium: Ds.caption,
        labelSmall: Ds.overline,
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        iconTheme: const IconThemeData(color: Ds.text),
        titleTextStyle: Ds.headline.copyWith(fontSize: 17),
      ),
      cardTheme: CardThemeData(
        color: Ds.glass,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Ds.r3), side: const BorderSide(color: Ds.hairline)),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: Ds.text,
          foregroundColor: Ds.bg,
          disabledBackgroundColor: Ds.glassStrong,
          disabledForegroundColor: Ds.textTertiary,
          textStyle: Ds.button,
          shape: pill,
          padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 15),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(backgroundColor: Ds.text, foregroundColor: Ds.bg, elevation: 0, textStyle: Ds.button, shape: pill, padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 15)),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: Ds.text,
          backgroundColor: Ds.glass,
          side: const BorderSide(color: Ds.hairlineStrong),
          textStyle: Ds.button,
          shape: pill,
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
        ),
      ),
      textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(foregroundColor: Ds.iris, textStyle: Ds.button.copyWith(fontSize: 14), shape: pill)),
      iconButtonTheme: IconButtonThemeData(style: IconButton.styleFrom(foregroundColor: Ds.text)),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(backgroundColor: Ds.text, foregroundColor: Ds.bg, elevation: 0, shape: StadiumBorder()),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Ds.glass,
        hintStyle: Ds.body.copyWith(color: Ds.textTertiary),
        labelStyle: Ds.callout,
        floatingLabelStyle: Ds.caption.copyWith(color: Ds.iris),
        prefixIconColor: Ds.textTertiary,
        suffixIconColor: Ds.textTertiary,
        contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 17),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(Ds.r2), borderSide: const BorderSide(color: Ds.hairline)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(Ds.r2), borderSide: const BorderSide(color: Ds.hairline)),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(Ds.r2), borderSide: const BorderSide(color: Ds.iris, width: 1.4)),
        errorBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(Ds.r2), borderSide: const BorderSide(color: Ds.rose)),
        focusedErrorBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(Ds.r2), borderSide: const BorderSide(color: Ds.rose, width: 1.4)),
        errorStyle: Ds.caption.copyWith(color: Ds.rose),
        counterStyle: Ds.caption.copyWith(color: Ds.textTertiary),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: Ds.glass,
        selectedColor: const Color(0xFF2A2350),
        side: const BorderSide(color: Ds.hairline),
        labelStyle: Ds.caption.copyWith(color: Ds.text),
        shape: const StadiumBorder(),
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        checkmarkColor: Ds.iris,
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Colors.white : Ds.textSecondary),
        trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Ds.iris : Ds.glassStrong),
        trackOutlineColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Ds.iris : Ds.hairlineStrong),
      ),
      sliderTheme: const SliderThemeData(activeTrackColor: Ds.iris, inactiveTrackColor: Ds.glassStrong, thumbColor: Colors.white, overlayColor: Color(0x228E7DFF), trackHeight: 4),
      listTileTheme: ListTileThemeData(iconColor: Ds.textSecondary, textColor: Ds.text, titleTextStyle: Ds.bodyStrong, subtitleTextStyle: Ds.caption, contentPadding: const EdgeInsets.symmetric(horizontal: 16)),
      dividerTheme: const DividerThemeData(color: Ds.hairline, thickness: 1, space: 1),
      tabBarTheme: TabBarThemeData(
        labelColor: Ds.text,
        unselectedLabelColor: Ds.textTertiary,
        labelStyle: Ds.button.copyWith(fontSize: 14),
        unselectedLabelStyle: Ds.button.copyWith(fontSize: 14),
        indicatorColor: Ds.iris,
        dividerColor: Ds.hairline,
        indicatorSize: TabBarIndicatorSize.label,
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(color: Ds.iris, linearTrackColor: Ds.glassStrong),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: const Color(0xFF1B1B24),
        contentTextStyle: Ds.body.copyWith(fontSize: 14),
        actionTextColor: Ds.iris,
        elevation: 0,
        insetPadding: const EdgeInsets.fromLTRB(16, 0, 16, 104),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Ds.r2), side: const BorderSide(color: Ds.hairline)),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: Ds.sheet,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: Ds.title2,
        contentTextStyle: Ds.callout,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Ds.r3), side: const BorderSide(color: Ds.hairline)),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: Ds.sheet,
        surfaceTintColor: Colors.transparent,
        showDragHandle: true,
        dragHandleColor: Ds.hairlineStrong,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(Ds.r4))),
      ),
      badgeTheme: const BadgeThemeData(backgroundColor: Ds.rose, textColor: Colors.white),
      tooltipTheme: TooltipThemeData(decoration: BoxDecoration(color: const Color(0xFF1B1B24), borderRadius: BorderRadius.circular(10)), textStyle: Ds.caption.copyWith(color: Ds.text)),
      pageTransitionsTheme: const PageTransitionsTheme(builders: {
        TargetPlatform.android: PredictiveBackPageTransitionsBuilder(),
        TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
      }),
    );
  }
}
