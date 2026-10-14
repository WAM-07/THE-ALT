import 'package:alter/core/alt/alt_session.dart';
import 'package:alter/core/models/consent_log.dart';
import 'package:alter/core/models/persona.dart';
import 'package:alter/features/auth/screens/auth_screen.dart';
import 'package:alter/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hive/hive.dart';
import 'dart:io';

void main() {
  setUpAll(() async {
    Hive.init(Directory.systemTemp.createTempSync('alter_test').path);
    Hive.registerAdapter(PersonaAdapter());
    Hive.registerAdapter(ConsentLogAdapter());
    await Hive.openBox<Persona>('personaBox');
    await Hive.openBox<ConsentLog>('consentBox');
  });

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(const MethodChannel('com.llfbandit.app_links/messages'), (_) async => null);
  });

  testWidgets('without a saved ALT session ALTER asks the person to sign in', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: AlterApp()));
    await tester.runAsync(restoreAltSession);
    // The sign-in background animates forever, so pump fixed frames instead of settling.
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }

    expect(find.byType(AuthScreen), findsOneWidget);
    // On phones "Continue with ALT" opens the ALT sign-in card over the app (no browser).
    expect(find.text('Continue with ALT'), findsOneWidget);
    expect(find.text('Create an ALT account'), findsOneWidget);
    await tester.tap(find.text('Continue with ALT'));
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(find.text('Choose an account'), findsOneWidget);
    expect(find.text('Continue with ALTERA'), findsOneWidget);
    await tester.tap(find.text('Use another account'));
    for (var i = 0; i < 4; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(find.text('Sign in'), findsOneWidget);
    expect(find.text('Email or handle'), findsOneWidget);
    expect(find.text('Forgot password?'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
}
