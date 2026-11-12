import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:plasma_mobile/config/app_themes.dart';
import 'package:plasma_mobile/screens/widgets/ui/app_ui.dart';

void main() {
  testWidgets('AppLogo renders the Plasma3D brand', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppThemes.dark,
        home: const Scaffold(body: Center(child: AppLogo())),
      ),
    );

    expect(find.text('Plasma3D'), findsOneWidget);
  });
}
