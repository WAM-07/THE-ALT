import 'package:alt_account/alt_account.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    AltBrand.classic.value = false;
  });

  testWidgets('draws every logo, light and dark, large and small, with its name for screen readers', (tester) async {
    for (final b in Brightness.values) {
      await tester.pumpWidget(MaterialApp(
        home: Row(children: [for (final k in AltLogoKind.values) ...[AltLogo(k, size: 96, brightness: b), AltLogo(k, size: 20, brightness: b)]]),
      ));
      expect(tester.takeException(), isNull);
    }
    for (final name in ['ALT', 'ALTER', 'ALTAR', 'ALTERA']) {
      expect(find.bySemanticsLabel(name), findsNWidgets(2));
    }
  });

  testWidgets('every frame of the loop paints', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Wrap(children: [
        for (final k in AltLogoKind.values)
          for (var t = 0.0; t < 1; t += 0.05) AltLogoFrame(k, t: t, size: 40),
      ]),
    ));
    expect(tester.takeException(), isNull);
  });

  testWidgets('animates in a loop, and stays still when the phone asks for less motion', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Center(child: AltLogo(AltLogoKind.altera, size: 80, animated: true))));
    await tester.pump(const Duration(seconds: 2));
    expect(tester.hasRunningAnimations, isTrue);

    await tester.pumpWidget(const MaterialApp(
      home: MediaQuery(data: MediaQueryData(disableAnimations: true), child: Center(child: AltLogo(AltLogoKind.altera, size: 80, animated: true))),
    ));
    await tester.pump();
    expect(tester.hasRunningAnimations, isFalse);
  });

  testWidgets('ALT mark is the hexagon logo, or the classic three bars when that is switched on (and remembered)', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Center(child: AltMark(height: 24))));
    expect(find.byType(AltLogo), findsOneWidget);
    expect(find.byType(AltClassicMark), findsNothing);

    await AltBrand.setClassic(true);
    await tester.pump();
    expect(find.byType(AltClassicMark), findsOneWidget);
    expect(find.byType(AltLogo), findsNothing);

    AltBrand.classic.value = false;
    await AltBrand.load();
    expect(AltBrand.classic.value, isTrue);
  });
}
