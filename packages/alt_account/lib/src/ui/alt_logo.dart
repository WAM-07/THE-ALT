import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// The four logos of The ALT Ecosystem (docs/brand/logo-pack), drawn natively so they stay sharp at
/// any size, follow light and dark themes, and animate without Lottie or a video.
enum AltLogoKind { alt, alter, altar, altera }

/// Brand colours from the logo pack's README.
abstract final class AltBrandColors {
  static const ink = Color(0xFF0E1525);
  static const paper = Color(0xFFF5F4F0);
  static const sapphire = Color(0xFF2152D9);
  static const sapphireOnDark = Color(0xFF5B86F0);
  static const green = Color(0xFF128A50);
  static const orange = Color(0xFFE8601A);
}

/// Which ALT mark the apps show: the logo pack's hexagon (default) or the classic three bars.
/// The switch is kept out of sight on purpose (ALTER: Profile → Advanced), like the themes.
abstract final class AltBrand {
  static final ValueNotifier<bool> classic = ValueNotifier<bool>(false);
  static const _storage = FlutterSecureStorage(aOptions: AndroidOptions(encryptedSharedPreferences: true));
  static const _key = 'alt_brand_classic_mark';

  /// Reads the choice saved on this phone. Call once at start-up; missing storage means "no".
  static Future<void> load() async {
    try {
      classic.value = await _storage.read(key: _key) == 'on';
    } catch (_) {
      classic.value = false;
    }
  }

  static Future<void> setClassic(bool on) async {
    classic.value = on;
    try {
      await _storage.write(key: _key, value: on ? 'on' : 'off');
    } catch (_) {
      // The choice still applies until the app closes.
    }
  }
}

/// One of the four logos. [animated] plays the pack's 5-second loop (the outline draws itself, then
/// the platform's mark pops in); it shows the still logo when the phone asks for reduced motion.
/// [brightness] picks the light- or dark-background version and defaults to the theme's.
/// Below 28 px the simplified small version is used (thicker lines, no inner mark).
class AltLogo extends StatefulWidget {
  const AltLogo(this.kind, {super.key, this.size = 48, this.animated = false, this.brightness, this.semanticLabel});

  final AltLogoKind kind;
  final double size;
  final bool animated;
  final Brightness? brightness;
  final String? semanticLabel;

  @override
  State<AltLogo> createState() => _AltLogoState();
}

class _AltLogoState extends State<AltLogo> with SingleTickerProviderStateMixin {
  AnimationController? _loop;

  bool _shouldAnimate(BuildContext context) => widget.animated && !(MediaQuery.maybeOf(context)?.disableAnimations ?? false);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _sync();
  }

  @override
  void didUpdateWidget(AltLogo old) {
    super.didUpdateWidget(old);
    _sync();
  }

  void _sync() {
    if (_shouldAnimate(context)) {
      _loop ??= AnimationController(vsync: this, duration: const Duration(seconds: 5))..repeat();
    } else {
      _loop?.dispose();
      _loop = null;
    }
  }

  @override
  void dispose() {
    _loop?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = (widget.brightness ?? Theme.of(context).brightness) == Brightness.dark;
    final label = widget.semanticLabel ?? const {AltLogoKind.alt: 'ALT', AltLogoKind.alter: 'ALTER', AltLogoKind.altar: 'ALTAR', AltLogoKind.altera: 'ALTERA'}[widget.kind];
    final loop = _loop;
    Widget paint(double t) => CustomPaint(size: Size.square(widget.size), painter: _LogoPainter(widget.kind, dark, widget.size < 28, loop == null ? null : t));
    return Semantics(
      label: label,
      image: true,
      child: SizedBox.square(
        dimension: widget.size,
        child: loop == null ? paint(0) : AnimatedBuilder(animation: loop, builder: (_, __) => paint(loop.value)),
      ),
    );
  }
}

/// ALT's mark beside "Continue with ALT" and on the sign-in card and lock screen: the hexagon logo,
/// or the classic three bars when [AltBrand.classic] is on. [ink] is the colour of the text beside it;
/// a light ink means a dark background.
class AltMark extends StatelessWidget {
  const AltMark({super.key, this.height = 18, this.ink = const Color(0xFF15171A)});

  final double height;
  final Color ink;

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<bool>(
        valueListenable: AltBrand.classic,
        builder: (_, classic, __) => classic
            ? AltClassicMark(height: height, ink: ink)
            : AltLogo(AltLogoKind.alt, size: height * 1.25, brightness: ink.computeLuminance() > 0.5 ? Brightness.dark : Brightness.light),
      );
}

/// ALT's first mark: three bars in the platforms' colours (ALTAR green, ALTERA orange, ink).
/// Kept on purpose (docs/brand/classic); shown when [AltBrand.classic] is on.
class AltClassicMark extends StatelessWidget {
  const AltClassicMark({super.key, this.height = 18, this.ink = const Color(0xFF15171A)});

  final double height;
  final Color ink;

  @override
  Widget build(BuildContext context) {
    Widget bar(Color c) => Container(width: height * 0.32, height: height, decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(height * 0.15)));
    return Row(mainAxisSize: MainAxisSize.min, children: [
      bar(const Color(0xFF1F9A5C)),
      SizedBox(width: height * 0.14),
      bar(const Color(0xFFF0802A)),
      SizedBox(width: height * 0.14),
      bar(ink),
    ]);
  }
}

/// One still frame of the animation at [t] (0–1 of the loop), for tests and previews.
@visibleForTesting
class AltLogoFrame extends StatelessWidget {
  const AltLogoFrame(this.kind, {super.key, required this.t, this.size = 48, this.brightness = Brightness.light});

  final AltLogoKind kind;
  final double t;
  final double size;
  final Brightness brightness;

  @override
  Widget build(BuildContext context) =>
      CustomPaint(size: Size.square(size), painter: _LogoPainter(kind, brightness == Brightness.dark, size < 28, t));
}

// ---------------------------------------------------------------- drawing

/// Keyframe timing of the pack's CSS, per segment (as CSS applies a timing function).
const _draw = Cubic(0.6, 0, 0.2, 1);
const _easeOut = Cubic(0, 0, 0.58, 1);
const _easeInOut = Cubic(0.42, 0, 0.58, 1);

/// The value at [t] (0–1 of the 5 s loop) of a property given as (offset, value) keyframes.
double _kf(double t, List<(double, double)> frames, Curve curve) {
  if (t <= frames.first.$1) return frames.first.$2;
  for (var i = 1; i < frames.length; i++) {
    final (a, va) = frames[i - 1];
    final (b, vb) = frames[i];
    if (t <= b) return b == a ? vb : va + (vb - va) * curve.transform((t - a) / (b - a));
  }
  return frames.last.$2;
}

double _wrap(double t, double delaySeconds) => (t - delaySeconds / 5) % 1;

class _LogoPainter extends CustomPainter {
  _LogoPainter(this.kind, this.dark, this.small, this.t);

  final AltLogoKind kind;
  final bool dark;
  final bool small;

  /// Position in the loop, or null for the still logo.
  final double? t;

  Color get _a => dark ? AltBrandColors.paper : AltBrandColors.ink;

  // Outline and A: drawn on (keyframes d, da, db), then faded out at the end of the loop.
  double _drawn(String which) {
    final t = this.t;
    if (t == null) return 1;
    return switch (which) {
      'd' => _kf(t, const [(0, 0), (0.28, 1)], _draw),
      'da' => _kf(t, const [(0, 0), (0.16, 0), (0.38, 1)], _draw),
      _ => _kf(t, const [(0, 0), (0.10, 0), (0.34, 1)], _draw),
    };
  }

  double get _fade => t == null ? 1 : _kf(t!, const [(0, 1), (0.86, 1), (0.96, 0), (1, 0)], _draw);

  Paint _stroke(Color c, double w, {double opacity = 1}) => Paint()
    ..style = PaintingStyle.stroke
    ..strokeWidth = w
    ..strokeCap = StrokeCap.round
    ..strokeJoin = StrokeJoin.round
    ..color = c.withValues(alpha: c.a * opacity);

  Paint _fill(Color c, {double opacity = 1}) => Paint()..color = c.withValues(alpha: c.a * opacity);

  void _strokePart(Canvas canvas, Path path, Paint paint, double fraction) {
    if (fraction <= 0 || paint.color.a == 0) return;
    if (fraction >= 1) return canvas.drawPath(path, paint);
    for (final m in path.computeMetrics()) {
      canvas.drawPath(m.extractPath(0, m.length * fraction), paint);
    }
  }

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / 100);
    switch (kind) {
      case AltLogoKind.alt:
        _paintAlt(canvas);
      case AltLogoKind.alter:
        _paintAlter(canvas);
      case AltLogoKind.altar:
        _paintAltar(canvas);
      case AltLogoKind.altera:
        _paintAltera(canvas);
    }
    canvas.restore();
  }

  static final _aPath = Path()
    ..moveTo(32, 71)
    ..lineTo(50, 31)
    ..lineTo(68, 71);

  void _paintA(Canvas canvas) => _strokePart(canvas, _aPath, _stroke(_a, small ? 12 : 8, opacity: _fade), _drawn('da'));

  // pop: the inner mark scales in with an overshoot, then out at the end.
  (double scale, double opacity) get _pop {
    final t = this.t;
    if (t == null) return (1, 1);
    return (
      _kf(t, const [(0, 0), (0.36, 0), (0.44, 1.3), (0.50, 1), (0.86, 1), (0.96, 0), (1, 0)], _easeOut),
      _kf(t, const [(0, 0), (0.36, 0), (0.44, 1), (0.86, 1), (0.96, 0), (1, 0)], _easeOut),
    );
  }

  void _paintAlt(Canvas canvas) {
    final hex = Path()
      ..moveTo(50, 7)
      ..lineTo(87, 28.5)
      ..lineTo(87, 71.5)
      ..lineTo(50, 93)
      ..lineTo(13, 71.5)
      ..lineTo(13, 28.5)
      ..close();
    _strokePart(canvas, hex, _stroke(_a, small ? 10 : 7, opacity: _fade), _drawn('d'));
    _paintA(canvas);
    if (small) return;
    final dot = dark ? AltBrandColors.sapphireOnDark : AltBrandColors.sapphire;
    final t = this.t;
    if (t != null) {
      final s = _kf(t, const [(0, 1), (0.50, 1), (0.76, 3.4), (1, 3.4)], _easeOut);
      final o = _kf(t, const [(0, 0), (0.50, 0), (0.52, 0.9), (0.76, 0), (1, 0)], _easeOut);
      if (o > 0) canvas.drawCircle(const Offset(50, 62), 5.5 * s, _stroke(dot, 1.5, opacity: o));
    }
    final (scale, opacity) = _pop;
    if (scale > 0) canvas.drawCircle(const Offset(50, 62), 5.5 * scale, _fill(dot, opacity: opacity));
  }

  void _paintAlter(Canvas canvas) {
    // Starts where the SVG's rect does (top edge, after the corner) and runs clockwise.
    const r = Radius.circular(24);
    final square = Path()
      ..moveTo(35, 11)
      ..lineTo(65, 11)
      ..arcToPoint(const Offset(89, 35), radius: r)
      ..lineTo(89, 65)
      ..arcToPoint(const Offset(65, 89), radius: r)
      ..lineTo(35, 89)
      ..arcToPoint(const Offset(11, 65), radius: r)
      ..lineTo(11, 35)
      ..arcToPoint(const Offset(35, 11), radius: r)
      ..close();
    _strokePart(canvas, square, _stroke(AltBrandColors.sapphire, small ? 10 : 7, opacity: _fade), _drawn('d'));
    _paintA(canvas);
    if (small) return;
    final spark = Path()
      ..moveTo(50, 54.5)
      ..quadraticBezierTo(51.1, 59.9, 56.5, 61)
      ..quadraticBezierTo(51.1, 62.1, 50, 67.5)
      ..quadraticBezierTo(48.9, 62.1, 43.5, 61)
      ..quadraticBezierTo(48.9, 59.9, 50, 54.5)
      ..close();
    final color = dark ? AltBrandColors.paper : AltBrandColors.sapphire;
    var scale = 1.0, turn = 0.0, opacity = 1.0;
    final t = this.t;
    if (t != null) {
      scale = _kf(t, const [(0, 0), (0.36, 0), (0.46, 1.25), (0.52, 1), (0.62, 1.3), (0.70, 1), (0.86, 1), (0.96, 0), (1, 0)], _easeInOut);
      turn = _kf(t, const [(0, -90), (0.36, -90), (0.46, 0), (0.52, 0), (0.62, 45), (0.70, 90), (1, 90)], _easeInOut);
      opacity = _kf(t, const [(0, 0), (0.36, 0), (0.46, 1), (0.86, 1), (0.96, 0), (1, 0)], _easeInOut);
    }
    if (scale <= 0) return;
    canvas.save();
    canvas.translate(50, 61);
    canvas.rotate(turn * math.pi / 180);
    canvas.scale(scale);
    canvas.translate(-50, -61);
    canvas.drawPath(spark, _fill(color, opacity: opacity));
    canvas.restore();
  }

  void _paintAltar(Canvas canvas) {
    final t = this.t;
    final flip = t == null ? 1.0 : _kf(t, const [(0, 1), (0.52, 1), (0.60, 0.06), (0.68, 1), (1, 1)], _easeInOut);
    canvas.save();
    canvas.translate(50, 50);
    canvas.scale(flip, 1);
    canvas.translate(-50, -50);
    Path circle(double r) => Path()..addArc(Rect.fromCircle(center: const Offset(50, 50), radius: r), 0, 2 * math.pi - 0.0001);
    _strokePart(canvas, circle(42), _stroke(AltBrandColors.green, small ? 10 : 7, opacity: _fade), _drawn('d'));
    if (!small) _strokePart(canvas, circle(35), _stroke(AltBrandColors.green, 2, opacity: _fade), _drawn('da'));
    _paintA(canvas);
    if (!small) {
      final color = dark ? AltBrandColors.paper : AltBrandColors.green;
      final (scale, opacity) = _pop;
      if (scale > 0) {
        final diamond = Path()
          ..moveTo(50, 55)
          ..lineTo(56, 62)
          ..lineTo(50, 69)
          ..lineTo(44, 62)
          ..close();
        canvas.save();
        canvas.translate(50, 62);
        canvas.scale(scale);
        canvas.translate(-50, -62);
        canvas.drawPath(diamond, _fill(color, opacity: opacity));
        canvas.drawPath(diamond, _stroke(color, 1.5, opacity: opacity));
        canvas.restore();
      }
    }
    canvas.restore();
  }

  void _paintAltera(Canvas canvas) {
    final t = this.t;
    double wave(double delay) => t == null
        ? 1
        : _kf(_wrap(t, delay), const [(0, 1), (0.50, 1), (0.57, 0.25), (0.64, 1), (0.71, 0.25), (0.78, 1), (1, 1)], _easeInOut);
    const center = Offset(50, 51);
    Path arc(double r, double startDeg, double sweepDeg) =>
        Path()..addArc(Rect.fromCircle(center: center, radius: r), startDeg * math.pi / 180, sweepDeg * math.pi / 180);
    final inner = _stroke(AltBrandColors.orange, small ? 10 : 7, opacity: _fade * wave(0));
    _strokePart(canvas, arc(34, 210, -60), inner, _drawn('d'));
    _strokePart(canvas, arc(34, -30, 60), inner, _drawn('d'));
    final outer = _stroke(AltBrandColors.orange, small ? 8 : 5.5, opacity: _fade * wave(0.25));
    _strokePart(canvas, arc(44, 215, -70), outer, _drawn('db'));
    _strokePart(canvas, arc(44, -35, 70), outer, _drawn('db'));
    _paintA(canvas);
    if (small) return;
    final color = dark ? AltBrandColors.paper : AltBrandColors.orange;
    const dots = [44.5, 50.0, 55.5];
    for (var i = 0; i < dots.length; i++) {
      final x = dots[i];
      var y = 0.0, opacity = 1.0;
      if (t != null) {
        final u = _wrap(t, i * 0.15);
        y = _kf(u, const [(0, 0), (0.38, 0), (0.48, -5), (0.54, 0), (0.62, -5), (0.68, 0), (1, 0)], _easeInOut);
        opacity = _kf(u, const [(0, 0), (0.38, 0), (0.42, 1), (0.86, 1), (0.96, 0), (1, 0)], _easeInOut);
      }
      if (opacity > 0) canvas.drawCircle(Offset(x, 64 + y), 2.6, _fill(color, opacity: opacity));
    }
  }

  @override
  bool shouldRepaint(_LogoPainter old) => old.t != t || old.dark != dark || old.kind != kind || old.small != small;
}
