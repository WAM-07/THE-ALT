import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../shared/widgets/gradient_background.dart';
import '../../../shared/widgets/alt_button.dart';
import '../../../shared/widgets/alt_card.dart';
import '../../../core/theme/colors.dart';
import '../../../core/theme/gradients.dart';
import '../../../core/theme/typography.dart';
import '../providers/training_state.dart';
import '../widgets/preflight_sheet.dart';

class TrainingScreen extends ConsumerWidget {
  const TrainingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final modelVersion = ref.watch(modelVersionProvider);

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: GradientBackground(
        baseColor: isDark ? ALTColors.darkBgPage : ALTColors.lightBgPage,
        layers: isDark ? ALTGradients.alterDark : ALTGradients.alterLight,
        animate: true,
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('Training Hub', style: ALTTypography.headlineLarge),
                const SizedBox(height: 8),
                const Text('Manage and evolve your local AI persona.', style: ALTTypography.bodyLarge),
                const SizedBox(height: 48),
                Center(
                  child: Container(
                    width: 200,
                    height: 200,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: ALTColors.irisViolet.withOpacity(0.1),
                      border: Border.all(color: ALTColors.violet100, width: 4),
                      boxShadow: [
                        BoxShadow(
                          color: ALTColors.irisViolet.withOpacity(0.3),
                          blurRadius: 40,
                          spreadRadius: 10,
                        )
                      ],
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text('v1.0.$modelVersion', style: ALTTypography.headlineMedium.copyWith(color: ALTColors.irisViolet)),
                        const SizedBox(height: 8),
                        const Text('BASELINE', style: TextStyle(letterSpacing: 2, fontWeight: FontWeight.bold, fontSize: 12)),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 64),
                ALTButton(
                  label: 'Initiate Training',
                  onPressed: () {
                    showModalBottomSheet(
                      context: context,
                      backgroundColor: Colors.transparent,
                      isScrollControlled: true,
                      builder: (context) => const PreFlightSheet(),
                    );
                  },
                ),
                const SizedBox(height: 48),
                const Text('Recent Iterations', style: ALTTypography.headlineSmall),
                const SizedBox(height: 16),
                Expanded(
                  child: ListView(
                    children: List.generate(modelVersion > 1 ? modelVersion - 1 : 0, (index) {
                      final version = modelVersion - 1 - index;
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: ALTCard(
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text('v1.0.$version Synthesis', style: ALTTypography.bodyLarge.copyWith(fontWeight: FontWeight.bold)),
                                  const SizedBox(height: 4),
                                  Text('Loss optimized, memory integrated.', style: ALTTypography.bodySmall.copyWith(color: ALTColors.lightTextMuted)),
                                ],
                              ),
                              const Icon(Icons.check_circle, color: ALTColors.jadeSurge),
                            ],
                          ),
                        ),
                      );
                    }),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
