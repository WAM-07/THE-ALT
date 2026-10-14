import 'package:flutter/material.dart';

import '../../core/theme/ds.dart';
import '../../core/theme/palettes.dart';

/// Profile → Advanced → Theme: each look as a small preview, drawn in its own colours.
Future<void> showThemePicker(BuildContext context) => showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.85),
          child: ListView(shrinkWrap: true, padding: const EdgeInsets.fromLTRB(Ds.gutter, 0, Ds.gutter, 20), children: [
            Text('Theme', style: Ds.title2),
            const SizedBox(height: 4),
            Text('How ALTER looks on this phone. Your AI and your data stay the same.', style: Ds.callout),
            const SizedBox(height: 16),
            for (final p in AlterPalettes.all) ...[
              _ThemeTile(
                palette: p,
                selected: p.id == Ds.palette.id,
                onTap: () {
                  Navigator.pop(ctx);
                  AlterThemeController.set(p);
                },
              ),
              const SizedBox(height: 10),
            ],
          ]),
        ),
      ),
    );

class _ThemeTile extends StatelessWidget {
  const _ThemeTile({required this.palette, required this.selected, required this.onTap});
  final AlterPalette palette;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = palette;
    final serif = p.displayFont == 'Fraunces';
    return Material(
      color: p.bg,
      borderRadius: BorderRadius.circular(Ds.r2),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(Ds.r2),
            border: Border.all(color: selected ? p.accent : p.hairlineStrong, width: selected ? 2 : 1),
          ),
          child: Row(children: [
            // A tiny identity card in the theme's material.
            Container(
              width: 74,
              height: 48,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(10),
                gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: p.cardBase),
                border: Border.all(color: p.cardEdge),
              ),
              child: Stack(children: [
                Positioned(
                  left: 8,
                  bottom: 8,
                  child: Container(width: 16, height: 16, decoration: BoxDecoration(shape: BoxShape.circle, gradient: LinearGradient(colors: p.signature))),
                ),
                Positioned(right: 8, top: 8, child: Container(width: 22, height: 4, decoration: BoxDecoration(color: p.cardInk.withValues(alpha: 0.6), borderRadius: BorderRadius.circular(2)))),
              ]),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(p.name,
                    style: TextStyle(
                      fontFamily: p.displayFont,
                      fontSize: serif ? 20 : 18,
                      fontWeight: FontWeight.w600,
                      color: p.text,
                      fontVariations: const [FontVariation('wght', 580)],
                    )),
                const SizedBox(height: 2),
                Text(p.note, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontFamily: 'Inter', fontSize: 12.5, height: 1.3, color: p.textSecondary)),
                const SizedBox(height: 8),
                Row(children: [
                  for (final c in [p.bg, p.glassStrong, p.accent, p.text, p.textSecondary])
                    Container(
                      width: 14,
                      height: 14,
                      margin: const EdgeInsets.only(right: 5),
                      decoration: BoxDecoration(color: c, shape: BoxShape.circle, border: Border.all(color: p.hairlineStrong)),
                    ),
                ]),
              ]),
            ),
            if (selected) Icon(Icons.check_circle_rounded, color: p.accent),
          ]),
        ),
      ),
    );
  }
}
