import 'package:altera_app/app.dart';
import 'package:altera_app/screens/auth/onboarding_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  setUp(() {
    // No saved ALT session on this "device".
    FlutterSecureStorage.setMockInitialValues({});
    // app_links has no platform side in widget tests.
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(const MethodChannel('com.llfbandit.app_links/messages'), (_) async => null);
  });

  testWidgets('starts signed out and leaves the splash screen for onboarding', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: AlteraApp()));
    expect(find.byType(MaterialApp), findsOneWidget);

    // Splash waits for the ALT session to be restored, then routes.
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle(const Duration(milliseconds: 100), EnginePhase.sendSemanticsUpdate, const Duration(seconds: 5));

    expect(find.byType(OnboardingScreen), findsOneWidget);
    expect(find.text('Skip'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 1));
  });
}
