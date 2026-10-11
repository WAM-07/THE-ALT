import 'package:flutter/material.dart';
import 'dart:math' as math;
import '../../theme/app_theme.dart';

class AudioVizWidget extends StatefulWidget {
  final int barCount;
  final Color? color;
  final double height;
  final bool isPlaying;

  const AudioVizWidget({
    super.key,
    this.barCount = 32,
    this.color,
    this.height = 48,
    this.isPlaying = false,
  });

  @override
  State<AudioVizWidget> createState() => _AudioVizWidgetState();
}

class _AudioVizWidgetState extends State<AudioVizWidget>
    with TickerProviderStateMixin {
  late AnimationController _controller;
  late List<double> _baseHeights;
  final _random = math.Random();

  @override
  void initState() {
    super.initState();
    _baseHeights = List.generate(
      widget.barCount,
      (_) => 0.2 + _random.nextDouble() * 0.8,
    );
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    );
    if (widget.isPlaying) _controller.repeat(reverse: true);
  }

  @override
  void didUpdateWidget(AudioVizWidget oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isPlaying && !_controller.isAnimating) {
      _controller.repeat(reverse: true);
    } else if (!widget.isPlaying && _controller.isAnimating) {
      _controller.stop();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = widget.color ?? AppColors.primary;
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        return SizedBox(
          height: widget.height,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: List.generate(widget.barCount, (i) {
              final phase = (i / widget.barCount) * math.pi * 2;
              final anim = widget.isPlaying
                  ? math.sin(_controller.value * math.pi * 2 + phase).abs()
                  : 0.3;
              final frac = _baseHeights[i] * (0.3 + 0.7 * anim);
              return Container(
                width: 3,
                height: widget.height * frac.clamp(0.1, 1.0),
                decoration: BoxDecoration(
                  color: color.withOpacity(0.3 + 0.7 * frac),
                  borderRadius: BorderRadius.circular(2),
                ),
              );
            }),
          ),
        );
      },
    );
  }
}
