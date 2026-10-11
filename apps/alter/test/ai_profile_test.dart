import 'package:alter/core/alt/ai_api.dart';
import 'package:alter/features/ai_profile/screens/ai_profile_screen.dart';
import 'package:alter/shared/widgets/offline_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('the tag editor adds, removes and stops at its limit', (tester) async {
    var values = <String>['curious'];
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: StatefulBuilder(
          builder: (context, setState) => TagEditor(label: 'Traits', values: values, max: 2, onChanged: (v) => setState(() => values = v)),
        ),
      ),
    ));
    expect(find.text('Traits (1/2)'), findsOneWidget);

    await tester.enterText(find.byType(TextField), '  calm ');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pump();
    expect(values, ['curious', 'calm']);
    expect(find.text('That’s the most you can add'), findsOneWidget);

    await tester.tap(find.byTooltip('Delete').first);
    await tester.pump();
    expect(values, ['calm']);
  });

  testWidgets('an AI without a picture shows its initial', (tester) async {
    final ai = AltAi({'id': 'a', 'handle': 'nova', 'name': 'nova', 'status': 'draft', 'verified': false});
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: AiAvatar(ai: ai))));
    expect(find.text('N'), findsOneWidget);
  });

  testWidgets('when ALT cannot be reached the person can retry instead of being sent to onboarding', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: OfflineScreen()));
    expect(find.text('Can’t reach ALT right now'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
  });

  test('links to ALT files point at the address the app uses', () {
    expect(media('http://localhost:8080/core/media/avatars/x.png'), startsWith('http://'));
    expect(media('https://res.cloudinary.com/x.png'), 'https://res.cloudinary.com/x.png');
  });
}
