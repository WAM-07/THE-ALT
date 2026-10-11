import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/alt/ai_api.dart';
import '../../core/theme/ds.dart';

// ALTER's components, built on `Ds`. Screens compose these instead of styling Material widgets
// one by one, so the whole app keeps one look.

// ---------------------------------------------------------------- canvas

/// The obsidian canvas with a slow aurora glow. `intensity` 0–1 (sign-in uses more, lists less).
class Backdrop extends StatefulWidget {
  const Backdrop({super.key, required this.child, this.animate = true, this.intensity = 0.6});
  final Widget child;
  final bool animate;
  final double intensity;

  @override
  State<Backdrop> createState() => _BackdropState();
}

class _BackdropState extends State<Backdrop> with SingleTickerProviderStateMixin {
  late final AnimationController _t = AnimationController(vsync: this, duration: const Duration(seconds: 36));

  @override
  void initState() {
    super.initState();
    if (widget.animate) _t.repeat();
  }

  @override
  void dispose() {
    _t.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final k = widget.intensity;
    return ColoredBox(
      color: Ds.bg,
      child: Stack(fit: StackFit.expand, children: [
        AnimatedBuilder(
          animation: _t,
          builder: (context, _) {
            final a = _t.value * 2 * math.pi;
            return Stack(fit: StackFit.expand, children: [
              _glow(Alignment(-0.9 + 0.25 * math.sin(a), -1.0 + 0.15 * math.cos(a)), Ds.iris, 0.22 * k, 1.1),
              _glow(Alignment(1.0 + 0.2 * math.cos(a * 0.7), -0.35 + 0.2 * math.sin(a * 0.7)), Ds.sky, 0.13 * k, 0.9),
              _glow(Alignment(0.2 + 0.3 * math.sin(a * 0.5), 1.15), Ds.mint, 0.07 * k, 1.0),
            ]);
          },
        ),
        // A soft vignette keeps the edges deep.
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0x00000000), Color(0x66000000)], stops: [0.55, 1]),
          ),
        ),
        widget.child,
      ]),
    );
  }

  Widget _glow(Alignment at, Color c, double alpha, double radius) => DecoratedBox(
        decoration: BoxDecoration(gradient: RadialGradient(center: at, radius: radius, colors: [c.withValues(alpha: alpha), c.withValues(alpha: 0)])),
      );
}

/// A page on the canvas: backdrop, safe area and a scrollable column with the standard gutter.
class AltPage extends StatelessWidget {
  const AltPage({super.key, required this.children, this.onRefresh, this.bottomInset = 120, this.appBar, this.floating});
  final List<Widget> children;
  final Future<void> Function()? onRefresh;
  final double bottomInset;
  final PreferredSizeWidget? appBar;
  final Widget? floating;

  @override
  Widget build(BuildContext context) {
    Widget list = ListView(
      physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
      padding: EdgeInsets.fromLTRB(Ds.gutter, appBar == null ? 8 : 4, Ds.gutter, bottomInset),
      children: children,
    );
    if (onRefresh != null) list = RefreshIndicator(onRefresh: onRefresh!, color: Ds.iris, backgroundColor: Ds.sheet, child: list);
    return Backdrop(
      animate: false,
      intensity: 0.45,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: appBar,
        floatingActionButton: floating,
        body: SafeArea(bottom: false, child: list),
      ),
    );
  }
}

/// App bar for pushed screens: a round glass back button and a quiet title.
PreferredSizeWidget topBar(BuildContext context, {String? title, List<Widget> actions = const [], PreferredSizeWidget? bottom}) => AppBar(
      automaticallyImplyLeading: false,
      leadingWidth: 64,
      leading: Navigator.of(context).canPop()
          ? Padding(
              padding: const EdgeInsets.only(left: 16),
              child: Center(child: RoundIconButton(icon: Icons.arrow_back_ios_new_rounded, tooltip: 'Back', onTap: () => Navigator.of(context).maybePop())),
            )
          : null,
      title: title == null ? null : Text(title),
      actions: [...actions, const SizedBox(width: 12)],
      bottom: bottom,
    );

// ---------------------------------------------------------------- surfaces

/// Frosted glass with a hairline border and a faint top highlight.
class Glass extends StatelessWidget {
  const Glass({super.key, required this.child, this.padding = const EdgeInsets.all(18), this.radius = Ds.r3, this.onTap, this.tint, this.border});
  final Widget child;
  final EdgeInsetsGeometry padding;
  final double radius;
  final VoidCallback? onTap;
  final Color? tint;
  final Color? border;

  @override
  Widget build(BuildContext context) {
    final shape = BorderRadius.circular(radius);
    final body = DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: shape,
        border: Border.all(color: border ?? Ds.hairline),
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: tint == null ? const [Color(0x12FFFFFF), Color(0x08FFFFFF)] : [tint!.withValues(alpha: 0.16), tint!.withValues(alpha: 0.06)],
        ),
      ),
      child: Padding(padding: padding, child: child),
    );
    if (onTap == null) return body;
    return Pressable(onTap: onTap!, child: Material(type: MaterialType.transparency, borderRadius: shape, child: body));
  }
}

/// Shrinks a touch when pressed and gives a light haptic tick.
class Pressable extends StatefulWidget {
  const Pressable({super.key, required this.child, required this.onTap, this.scale = 0.975});
  final Widget child;
  final VoidCallback? onTap;
  final double scale;

  @override
  State<Pressable> createState() => _PressableState();
}

class _PressableState extends State<Pressable> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onTap != null;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: enabled ? (_) => setState(() => _down = true) : null,
      onTapCancel: enabled ? () => setState(() => _down = false) : null,
      onTapUp: enabled ? (_) => setState(() => _down = false) : null,
      onTap: enabled
          ? () {
              HapticFeedback.selectionClick();
              widget.onTap!();
            }
          : null,
      child: AnimatedScale(scale: _down ? widget.scale : 1, duration: Ds.quick, curve: Ds.ease, child: widget.child),
    );
  }
}

// ---------------------------------------------------------------- buttons

enum BtnKind { primary, secondary, ghost, aurora, danger }

/// The one button. Primary is a light pill; aurora is kept for the AI's big moments (deploy, publish).
class Btn extends StatelessWidget {
  const Btn(this.label, {super.key, required this.onTap, this.kind = BtnKind.primary, this.icon, this.loading = false, this.expand = false, this.compact = false});
  final String label;
  final VoidCallback? onTap;
  final BtnKind kind;
  final IconData? icon;
  final bool loading;
  final bool expand;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null && !loading;
    final (Color fg, Color? bg, Gradient? gradient, Color? border) = switch (kind) {
      BtnKind.primary => (Ds.bg, Ds.text, null, null),
      BtnKind.secondary => (Ds.text, Ds.glassStrong, null, Ds.hairlineStrong),
      BtnKind.ghost => (Ds.iris, null, null, null),
      BtnKind.aurora => (Colors.white, null, Ds.aurora, null),
      BtnKind.danger => (Ds.rose, Ds.rose.withValues(alpha: 0.12), null, Ds.rose.withValues(alpha: 0.35)),
    };
    final h = compact ? 40.0 : 54.0;
    final content = Row(mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min, mainAxisAlignment: MainAxisAlignment.center, children: [
      if (loading)
        SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: fg))
      else ...[
        if (icon != null) ...[Icon(icon, size: compact ? 17 : 19, color: fg), const SizedBox(width: 8)],
        Flexible(child: Text(label, overflow: TextOverflow.ellipsis, style: Ds.button.copyWith(color: fg, fontSize: compact ? 14 : 15))),
      ],
    ]);
    return Opacity(
      opacity: enabled || loading ? 1 : 0.4,
      child: Pressable(
        onTap: enabled ? onTap : null,
        child: Container(
          height: h,
          padding: EdgeInsets.symmetric(horizontal: compact ? 16 : 22),
          decoration: BoxDecoration(
            color: bg,
            gradient: gradient,
            borderRadius: BorderRadius.circular(h / 2),
            border: border == null ? null : Border.all(color: border),
            boxShadow: kind == BtnKind.aurora ? [BoxShadow(color: Ds.iris.withValues(alpha: 0.35), blurRadius: 24, offset: const Offset(0, 8))] : null,
          ),
          child: content,
        ),
      ),
    );
  }
}

/// A round glass icon button (back, close, bell…).
class RoundIconButton extends StatelessWidget {
  const RoundIconButton({super.key, required this.icon, required this.onTap, this.tooltip, this.size = 40, this.badge});
  final IconData icon;
  final VoidCallback? onTap;
  final String? tooltip;
  final double size;
  final Widget? badge;

  @override
  Widget build(BuildContext context) {
    final button = Pressable(
      onTap: onTap,
      scale: 0.92,
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(shape: BoxShape.circle, color: Ds.glass, border: Border.all(color: Ds.hairline)),
        child: Icon(icon, size: size * 0.45, color: Ds.text),
      ),
    );
    final withBadge = badge == null ? button : Stack(clipBehavior: Clip.none, children: [button, Positioned(right: -2, top: -2, child: badge!)]);
    return tooltip == null ? withBadge : Tooltip(message: tooltip!, child: withBadge);
  }
}

// ---------------------------------------------------------------- text and labels

/// Eyebrow + big title + optional subtitle, with optional trailing widgets.
class PageHeader extends StatelessWidget {
  const PageHeader({super.key, required this.title, this.eyebrow, this.subtitle, this.trailing = const [], this.large = false});
  final String title;
  final String? eyebrow;
  final String? subtitle;
  final List<Widget> trailing;
  final bool large;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 20),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (eyebrow != null) ...[Text(eyebrow!.toUpperCase(), style: Ds.overline), const SizedBox(height: 8)],
            Text(title, style: large ? Ds.display : Ds.title1),
            if (subtitle != null) ...[const SizedBox(height: 6), Text(subtitle!, style: Ds.callout)],
          ]),
        ),
        for (final t in trailing) Padding(padding: const EdgeInsets.only(left: 10), child: t),
      ]),
    );
  }
}

/// Small uppercase section label with an optional action on the right.
class SectionLabel extends StatelessWidget {
  const SectionLabel(this.text, {super.key, this.action, this.onAction, this.top = 28});
  final String text;
  final String? action;
  final VoidCallback? onAction;
  final double top;

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.only(top: top, bottom: 12, left: 4, right: 4),
        child: Row(children: [
          Expanded(child: Text(text.toUpperCase(), style: Ds.overline)),
          if (action != null) Pressable(onTap: onAction, child: Text(action!, style: Ds.caption.copyWith(color: Ds.iris, fontWeight: FontWeight.w600))),
        ]),
      );
}

/// A small status capsule.
class Pill extends StatelessWidget {
  const Pill(this.text, {super.key, this.color = Ds.textSecondary, this.icon, this.dot = false});
  final String text;
  final Color color;
  final IconData? icon;
  final bool dot;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(99), border: Border.all(color: color.withValues(alpha: 0.28))),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          if (dot) ...[Container(width: 6, height: 6, decoration: BoxDecoration(color: color, shape: BoxShape.circle)), const SizedBox(width: 6)],
          if (icon != null) ...[Icon(icon, size: 13, color: color), const SizedBox(width: 5)],
          Text(text, style: Ds.caption.copyWith(color: color, fontSize: 12, fontWeight: FontWeight.w600)),
        ]),
      );
}

/// Text painted with the aurora gradient.
class AuroraText extends StatelessWidget {
  const AuroraText(this.text, {super.key, required this.style});
  final String text;
  final TextStyle style;

  @override
  Widget build(BuildContext context) => ShaderMask(
        blendMode: BlendMode.srcIn,
        shaderCallback: (r) => Ds.aurora.createShader(r),
        child: Text(text, style: style.copyWith(color: Colors.white)),
      );
}

// ---------------------------------------------------------------- rows and groups

/// A rounded-square icon with a tinted background.
class IconBadge extends StatelessWidget {
  const IconBadge(this.icon, {super.key, this.color = Ds.iris, this.size = 40});
  final IconData icon;
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) => Container(
        width: size,
        height: size,
        decoration: BoxDecoration(color: color.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(size * 0.32), border: Border.all(color: color.withValues(alpha: 0.22))),
        child: Icon(icon, size: size * 0.5, color: color),
      );
}

/// One row inside a [Group]: icon badge, title, subtitle, trailing (chevron by default).
class ListRow extends StatelessWidget {
  const ListRow({super.key, required this.title, this.subtitle, this.icon, this.color = Ds.iris, this.trailing, this.onTap, this.danger = false});
  final String title;
  final String? subtitle;
  final IconData? icon;
  final Color color;
  final Widget? trailing;
  final VoidCallback? onTap;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final row = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Row(children: [
        if (icon != null) ...[IconBadge(icon!, color: danger ? Ds.rose : color, size: 36), const SizedBox(width: 14)],
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: Ds.bodyStrong.copyWith(color: danger ? Ds.rose : Ds.text)),
            if (subtitle != null) ...[const SizedBox(height: 2), Text(subtitle!, style: Ds.caption)],
          ]),
        ),
        const SizedBox(width: 8),
        trailing ?? (onTap != null ? const Icon(Icons.chevron_right_rounded, color: Ds.textTertiary) : const SizedBox.shrink()),
      ]),
    );
    return onTap == null ? row : Pressable(onTap: onTap, scale: 0.985, child: row);
  }
}

/// Rows on one glass panel, separated by inset hairlines.
class Group extends StatelessWidget {
  const Group({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Glass(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Column(children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0) const Divider(indent: 66, height: 1),
            children[i],
          ],
        ]),
      );
}

// ---------------------------------------------------------------- the AI

/// The AI's picture, its initial on the aurora when it has none, with a ring once verified.
class AiAvatar extends StatelessWidget {
  const AiAvatar({super.key, required this.ai, this.size = 44, this.ring = true});
  final AltAi ai;
  final double size;
  final bool ring;

  @override
  Widget build(BuildContext context) {
    final url = ai.avatarUrl;
    final face = ClipOval(
      child: SizedBox(
        width: size,
        height: size,
        child: url != null
            ? Image.network(url, fit: BoxFit.cover, errorBuilder: (_, __, ___) => _initial())
            : _initial(),
      ),
    );
    if (!ring || !ai.verified) return face;
    return Container(
      padding: EdgeInsets.all(size * 0.05),
      decoration: const BoxDecoration(shape: BoxShape.circle, gradient: Ds.aurora),
      child: Container(padding: EdgeInsets.all(size * 0.035), decoration: const BoxDecoration(shape: BoxShape.circle, color: Ds.bg), child: face),
    );
  }

  Widget _initial() => DecoratedBox(
        decoration: const BoxDecoration(gradient: Ds.aurora),
        child: Center(
          child: Text(ai.name.isEmpty ? '?' : ai.name.characters.first.toUpperCase(),
              style: Ds.title2.copyWith(fontSize: size * 0.42, color: Colors.white)),
        ),
      );
}

/// The signature element: the AI's identity as a card, like a premium payment card.
/// Verified AIs glow with the aurora; drafts are graphite until they are minted.
class AiIdentityCard extends StatelessWidget {
  const AiIdentityCard({super.key, required this.ai, this.onTap});
  final AltAi ai;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final verified = ai.verified;
    final token = ai.token;
    final status = switch (ai.status) {
      'verified' => ('Verified', Ds.mint),
      'minting' => ('Minting…', Ds.amber),
      'ready' => ('Ready to deploy', Ds.sky),
      'suspended' => ('Suspended', Ds.rose),
      _ => ('Draft', Ds.textSecondary),
    };
    final card = AspectRatio(
      aspectRatio: 1.58,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(Ds.r3 + 4),
        child: Stack(fit: StackFit.expand, children: [
          // Base: deep ink, then aurora light pooling from the corners.
          const DecoratedBox(decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFF15122A), Color(0xFF0B0B14)]))),
          if (verified) ...[
            const DecoratedBox(decoration: BoxDecoration(gradient: RadialGradient(center: Alignment(-1.1, -1.2), radius: 1.3, colors: [Color(0x998E7DFF), Color(0x008E7DFF)]))),
            const DecoratedBox(decoration: BoxDecoration(gradient: RadialGradient(center: Alignment(1.2, 1.3), radius: 1.2, colors: [Color(0x8841E2BE), Color(0x0041E2BE)]))),
            const DecoratedBox(decoration: BoxDecoration(gradient: RadialGradient(center: Alignment(1.1, -0.9), radius: 0.9, colors: [Color(0x665AA9FF), Color(0x005AA9FF)]))),
          ] else
            const DecoratedBox(decoration: BoxDecoration(gradient: RadialGradient(center: Alignment(-1.1, -1.2), radius: 1.3, colors: [Color(0x40FFFFFF), Color(0x00FFFFFF)]))),
          // Fine diagonal sheen, as on metal cards.
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(begin: Alignment(-1, -0.4), end: Alignment(1, 0.4), colors: [Color(0x00FFFFFF), Color(0x14FFFFFF), Color(0x00FFFFFF)], stops: [0.35, 0.5, 0.65]),
            ),
          ),
          DecoratedBox(decoration: BoxDecoration(borderRadius: BorderRadius.circular(Ds.r3 + 4), border: Border.all(color: Ds.hairlineStrong))),
          Padding(
            padding: const EdgeInsets.fromLTRB(22, 20, 22, 20),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Text('ALT IDENTITY', style: Ds.overline.copyWith(color: Colors.white.withValues(alpha: 0.7))),
                const Spacer(),
                Pill(status.$1, color: status.$2, dot: true),
              ]),
              const Spacer(),
              Row(children: [
                AiAvatar(ai: ai, size: 46),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(ai.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: Ds.title2.copyWith(color: Colors.white)),
                    const SizedBox(height: 2),
                    Text('@${ai.handle}', style: Ds.caption.copyWith(color: Colors.white.withValues(alpha: 0.65))),
                  ]),
                ),
              ]),
              const SizedBox(height: 18),
              Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
                _field('TOKEN', token != null ? '#${token.tokenId}' : '—'),
                const SizedBox(width: 26),
                _field('VERSION', ai.currentVersion != null ? 'v${ai.currentVersion}' : (ai.latestVersion != null ? 'v${ai.latestVersion!['version']}' : '—')),
                const Spacer(),
                Icon(verified ? Icons.verified_rounded : Icons.hexagon_outlined, color: Colors.white.withValues(alpha: verified ? 0.9 : 0.4), size: 26),
              ]),
            ]),
          ),
        ]),
      ),
    );
    return onTap == null ? card : Pressable(onTap: onTap, scale: 0.985, child: card);
  }

  static Widget _field(String k, String v) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(k, style: Ds.overline.copyWith(fontSize: 9.5, color: Colors.white.withValues(alpha: 0.55))),
        const SizedBox(height: 3),
        Text(v, style: Ds.headline.copyWith(color: Colors.white, fontFeatures: const [FontFeature.tabularFigures()])),
      ]);
}

// ---------------------------------------------------------------- states

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, this.body, this.action});
  final IconData icon;
  final String title;
  final String? body;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 40),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: 68,
            height: 68,
            decoration: BoxDecoration(shape: BoxShape.circle, color: Ds.glass, border: Border.all(color: Ds.hairline)),
            child: ShaderMask(blendMode: BlendMode.srcIn, shaderCallback: (r) => Ds.aurora.createShader(r), child: Icon(icon, size: 30, color: Colors.white)),
          ),
          const SizedBox(height: 18),
          Text(title, textAlign: TextAlign.center, style: Ds.title2.copyWith(fontSize: 18)),
          if (body != null) ...[const SizedBox(height: 8), Text(body!, textAlign: TextAlign.center, style: Ds.callout)],
          if (action != null) ...[const SizedBox(height: 20), action!],
        ]),
      );
}

class Loading extends StatelessWidget {
  const Loading({super.key, this.padding = 48});
  final double padding;

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.all(padding),
        child: const Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.2, color: Ds.iris))),
      );
}

/// A short message at the bottom of the screen.
void toast(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}

/// ALTER's mark: an aurora ring around a glowing core, the "twin" inside you.
class AlterMark extends StatelessWidget {
  const AlterMark({super.key, this.size = 56});
  final double size;

  @override
  Widget build(BuildContext context) => Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: Ds.aurora,
          boxShadow: [BoxShadow(color: Ds.iris.withValues(alpha: 0.45), blurRadius: size * 0.6, spreadRadius: -size * 0.1)],
        ),
        padding: EdgeInsets.all(size * 0.12),
        child: Container(
          decoration: const BoxDecoration(shape: BoxShape.circle, color: Ds.bg),
          padding: EdgeInsets.all(size * 0.2),
          child: Container(
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: const LinearGradient(begin: Alignment.bottomLeft, end: Alignment.topRight, colors: [Color(0xFF8E7DFF), Color(0xFF41E2BE)]),
              boxShadow: [BoxShadow(color: Ds.mint.withValues(alpha: 0.5), blurRadius: size * 0.25)],
            ),
          ),
        ),
      );
}

/// Renders the light markdown LLMs write (**bold**, *italic*, `code`) as styled text.
class RichMessage extends StatelessWidget {
  const RichMessage(this.text, {super.key, required this.style});
  final String text;
  final TextStyle style;

  static final _token = RegExp(r'(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)');

  @override
  Widget build(BuildContext context) {
    final spans = <InlineSpan>[];
    var last = 0;
    for (final m in _token.allMatches(text)) {
      if (m.start > last) spans.add(TextSpan(text: text.substring(last, m.start)));
      final t = m.group(0)!;
      if (t.startsWith('**')) {
        spans.add(TextSpan(text: t.substring(2, t.length - 2), style: const TextStyle(fontWeight: FontWeight.w700, fontVariations: [FontVariation('wght', 680)])));
      } else if (t.startsWith('`')) {
        spans.add(TextSpan(text: t.substring(1, t.length - 1), style: const TextStyle(fontFamily: 'monospace', fontSize: 13)));
      } else {
        spans.add(TextSpan(text: t.substring(1, t.length - 1), style: const TextStyle(fontStyle: FontStyle.italic)));
      }
      last = m.end;
    }
    if (last < text.length) spans.add(TextSpan(text: text.substring(last)));
    return Text.rich(TextSpan(style: style, children: spans));
  }
}
