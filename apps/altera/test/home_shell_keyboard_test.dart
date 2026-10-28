import 'package:altera_app/screens/home/home_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

// The home screen's frosted bottom bar must never sit over text being typed.
void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(const MethodChannel('com.llfbandit.app_links/messages'), (_) async => null);
  });

  Widget app() {
    final root = GlobalKey<NavigatorState>();
    final router = GoRouter(navigatorKey: root, initialLocation: '/feed', routes: [
      ShellRoute(
        builder: (_, __, child) => HomeShell(child: child),
        routes: [
          GoRoute(
            path: '/feed',
            builder: (context, _) => Scaffold(
              body: Column(children: [
                const SizedBox(height: 80),
                ElevatedButton(
                  onPressed: () => showModalBottomSheet(
                    context: context,
                    useRootNavigator: true,
                    builder: (_) => const Padding(padding: EdgeInsets.all(16), child: TextField(key: Key('sheet-field'))),
                  ),
                  child: const Text('open sheet'),
                ),
                const Spacer(),
                const TextField(key: Key('page-field')),
              ]),
            ),
          ),
        ],
      ),
    ]);
    return ProviderScope(child: MaterialApp.router(routerConfig: router));
  }

  testWidgets('the bottom bar steps aside while the keyboard is open', (tester) async {
    await tester.pumpWidget(app());
    await tester.pump();
    expect(find.text('Feed'), findsOneWidget);

    tester.view.viewInsets = const FakeViewPadding(bottom: 300);
    addTearDown(tester.view.resetViewInsets);
    await tester.pump();
    expect(find.text('Feed'), findsNothing);
    // The field sits just above the keyboard, nothing over it.
    final field = tester.getRect(find.byKey(const Key('page-field')));
    final view = tester.view;
    expect(field.bottom, lessThanOrEqualTo((view.physicalSize.height - 300) / view.devicePixelRatio));

    tester.view.resetViewInsets();
    await tester.pump();
    expect(find.text('Feed'), findsOneWidget);
  });

  testWidgets('a sheet opened from the home screen is drawn above the bottom bar', (tester) async {
    await tester.pumpWidget(app());
    await tester.pump();
    await tester.tap(find.text('open sheet'));
    await tester.pumpAndSettle();
    final sheetField = find.byKey(const Key('sheet-field'));
    expect(sheetField, findsOneWidget);
    expect(find.ancestor(of: sheetField, matching: find.byType(HomeShell)), findsNothing);
    // Tapping the field reaches the field, not the bar.
    await tester.tap(sheetField);
    await tester.pump();
    expect(tester.testTextInput.isVisible, isTrue);
  });
}
