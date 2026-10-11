import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app.dart';

void main() async {
  if (kDebugMode) print('🚀 ALTERA: Starting application...');
  WidgetsFlutterBinding.ensureInitialized();
  if (kDebugMode) print('🚀 ALTERA: Binding initialized.');

  // Lock orientation to portrait
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // Status bar style
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
    ),
  );

  if (kDebugMode) print('🚀 ALTERA: Calling runApp...');
  runApp(
    const ProviderScope(
      child: AlteraApp(),
    ),
  );
}
