import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:go_router/go_router.dart';
import '../../../core/theme/colors.dart';
import '../../../core/theme/typography.dart';
import '../../../shared/widgets/alt_button.dart';

class PreFlightSheet extends StatefulWidget {
  const PreFlightSheet({super.key});

  @override
  State<PreFlightSheet> createState() => _PreFlightSheetState();
}

class _PreFlightSheetState extends State<PreFlightSheet> {
  int _completedSteps = 0;

  @override
  void initState() {
    super.initState();
    _runChecks();
  }

  Future<void> _runChecks() async {
    for (int i = 0; i < 3; i++) {
      await Future.delayed(const Duration(milliseconds: 1000));
      if (mounted) {
        setState(() {
          _completedSteps++;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    return Container(
      padding: const EdgeInsets.all(24).copyWith(bottom: MediaQuery.of(context).padding.bottom + 24),
      decoration: BoxDecoration(
        color: isDark ? ALTColors.darkBgSurface01 : ALTColors.lightBgSurface01,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
        border: Border.all(color: isDark ? ALTColors.darkBorderSubtle : ALTColors.lightBorderSubtle),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: ALTColors.lightTextMuted.withOpacity(0.3),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 24),
          const Text('Pre-Flight Checklist', style: ALTTypography.headlineMedium, textAlign: TextAlign.center),
          const SizedBox(height: 32),
          _buildCheckItem('Verifying Dataset Integrity', 0),
          const SizedBox(height: 16),
          _buildCheckItem('Confirming Consent Cryptography', 1),
          const SizedBox(height: 16),
          _buildCheckItem('Allocating Neural Compute', 2),
          const SizedBox(height: 32),
          ALTButton(
            label: 'Commence Training',
            onPressed: _completedSteps == 3 ? () {
              Navigator.of(context).pop();
              context.push('/simulate_training');
            } : null,
          ).animate(target: _completedSteps == 3 ? 1 : 0)
           .shimmer(duration: 1.seconds, color: Colors.white24),
        ],
      ),
    );
  }

  Widget _buildCheckItem(String title, int stepIndex) {
    final isComplete = _completedSteps > stepIndex;
    final isCurrent = _completedSteps == stepIndex;
    
    return Row(
      children: [
        Container(
          width: 24,
          height: 24,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: isComplete ? ALTColors.jadeSurge : Colors.transparent,
            border: Border.all(color: isComplete ? ALTColors.jadeSurge : (isCurrent ? ALTColors.irisViolet : ALTColors.lightTextMuted)),
          ),
          child: isComplete 
            ? const Icon(Icons.check, size: 14, color: Colors.white)
            : (isCurrent ? const Padding(padding: EdgeInsets.all(4.0), child: CircularProgressIndicator(strokeWidth: 2, color: ALTColors.irisViolet)) : null),
        ),
        const SizedBox(width: 16),
        Text(
          title,
          style: ALTTypography.bodyLarge.copyWith(
            color: isComplete ? ALTColors.jadeSurge : (isCurrent ? ALTColors.irisViolet : ALTColors.lightTextMuted),
            fontWeight: isCurrent ? FontWeight.bold : FontWeight.normal,
          ),
        ),
      ],
    ).animate(target: isCurrent ? 1 : 0).fade(duration: 300.ms);
  }
}
