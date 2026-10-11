import 'package:flutter/material.dart';

import '../../core/theme/ds.dart';
import '../ui/ui.dart';

/// Older card name, kept so existing screens compile: now a [Glass] panel.
class ALTCard extends StatelessWidget {
  const ALTCard({super.key, required this.child, this.padding = const EdgeInsets.all(18), this.onTap, this.isDanger = false});
  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final bool isDanger;

  @override
  Widget build(BuildContext context) => Glass(padding: padding, onTap: onTap, border: isDanger ? Ds.rose.withValues(alpha: 0.5) : null, child: child);
}
