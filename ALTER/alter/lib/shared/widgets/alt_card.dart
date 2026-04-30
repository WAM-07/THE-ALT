import 'package:flutter/material.dart';
import '../../core/theme/colors.dart';

class ALTCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final bool isDanger;

  const ALTCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16.0),
    this.onTap,
    this.isDanger = false,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    Widget card = Card(
      color: isDark ? ALTColors.darkBgSurface02 : ALTColors.lightBgSurface02,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(24),
        side: BorderSide(
          color: isDanger ? ALTColors.vermillion : (isDark ? ALTColors.darkBorderSubtle : ALTColors.lightBorderSubtle),
          width: isDanger ? 2 : 1,
        ),
      ),
      elevation: 0,
      margin: EdgeInsets.zero,
      child: Padding(
        padding: padding,
        child: child,
      ),
    );

    if (onTap != null) {
      return InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(24),
        child: card,
      );
    }
    
    return card;
  }
}
