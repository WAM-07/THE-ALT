import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../../../core/theme/colors.dart';
import '../../../core/theme/typography.dart';
import '../../../shared/widgets/alt_button.dart';
import '../providers/training_state.dart';

class SimulatedTrainingScreen extends ConsumerStatefulWidget {
  const SimulatedTrainingScreen({super.key});

  @override
  ConsumerState<SimulatedTrainingScreen> createState() => _SimulatedTrainingScreenState();
}

class _SimulatedTrainingScreenState extends ConsumerState<SimulatedTrainingScreen> {
  final List<String> _logs = [];
  final ScrollController _scrollController = ScrollController();
  double _progress = 0;
  bool _isComplete = false;
  Timer? _timer;
  
  final List<String> _mockPhrases = [
    "Epoch {E}/50 - Neural Syncing...",
    "Loss {L} - Adjusting LoRA Weights",
    "Assimilating Persona Matrix chunk {C}",
    "Cognitive Sync {P}% complete",
    "Pruning erratic gradients...",
    "Optimizing attention heads...",
    "Validating synthetic memories...",
  ];

  @override
  void initState() {
    super.initState();
    _startTraining();
  }

  void _startTraining() {
    int tick = 0;
    _timer = Timer.periodic(const Duration(milliseconds: 150), (timer) {
      tick++;
      
      if (_progress >= 1.0) {
        timer.cancel();
        setState(() {
          _isComplete = true;
          _logs.add(">> TRAINING COMPLETE. MATRIX UPDATED.");
        });
        _scrollToBottom();
        ref.read(modelVersionProvider.notifier).state++;
        return;
      }

      setState(() {
        _progress = (tick / 50).clamp(0.0, 1.0);
        
        if (tick % 2 == 0) {
          final phrase = _mockPhrases[tick % _mockPhrases.length]
            .replaceAll('{E}', (tick ~/ 2).toString())
            .replaceAll('{L}', (0.9 - (tick * 0.01)).toStringAsFixed(3))
            .replaceAll('{C}', tick.toString())
            .replaceAll('{P}', (_progress * 100).toInt().toString());
          _logs.add("> $phrase");
        }
      });
      _scrollToBottom();
    });
  }

  void _scrollToBottom() {
    if (_scrollController.hasClients) {
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent + 50,
        duration: const Duration(milliseconds: 100),
        curve: Curves.easeOut,
      );
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          Positioned.fill(
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 500),
              decoration: BoxDecoration(
                gradient: RadialGradient(
                  colors: [
                    _isComplete ? ALTColors.jadeSurge.withOpacity(0.3) : ALTColors.irisViolet.withOpacity(0.3),
                    Colors.black,
                  ],
                  radius: _isComplete ? 1.5 : 0.8 + (_progress * 0.5),
                ),
              ),
            ),
          ),
          SafeArea(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.all(24),
                  child: const Text(
                    'NEURAL ASSIMILATION IN PROGRESS...',
                    style: TextStyle(
                      fontFamily: 'monospace',
                      color: ALTColors.irisViolet,
                      fontSize: 16,
                      letterSpacing: 2,
                    ),
                  ).animate(onPlay: (controller) => controller.repeat(reverse: true)).fade(begin: 0.5, end: 1.0, duration: 1.seconds),
                ),
                Expanded(
                  child: ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
                    itemCount: _logs.length,
                    itemBuilder: (context, index) {
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 4),
                        child: Text(
                          _logs[index],
                          style: TextStyle(
                            fontFamily: 'monospace',
                            color: _isComplete && index == _logs.length - 1 ? ALTColors.jadeSurge : Colors.greenAccent.withOpacity(0.7),
                            fontSize: 12,
                          ),
                        ),
                      );
                    },
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text('SYNTHESIS', style: ALTTypography.bodySmall.copyWith(color: Colors.white)),
                          Text('${(_progress * 100).toInt()}%', style: ALTTypography.bodySmall.copyWith(color: Colors.white)),
                        ],
                      ),
                      const SizedBox(height: 8),
                      LinearProgressIndicator(
                        value: _progress,
                        backgroundColor: Colors.white12,
                        valueColor: AlwaysStoppedAnimation<Color>(_isComplete ? ALTColors.jadeSurge : ALTColors.irisViolet),
                        minHeight: 8,
                        borderRadius: BorderRadius.circular(4),
                      ),
                      const SizedBox(height: 32),
                      if (_isComplete)
                        ALTButton(
                          label: 'Return to Hub',
                          onPressed: () {
                            context.pop();
                          },
                        ).animate().fade().scale(),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
