import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/models/dataset_item.dart';
import '../../../core/theme/colors.dart';
import '../../../core/theme/gradients.dart';
import '../../../core/theme/typography.dart';
import '../../../shared/widgets/gradient_background.dart';
import '../../../shared/widgets/alt_button.dart';
import '../../../shared/widgets/alt_card.dart';
import 'dataset_screen.dart';

class DatasetItemDetailScreen extends ConsumerStatefulWidget {
  final DatasetItem item;

  const DatasetItemDetailScreen({super.key, required this.item});

  @override
  ConsumerState<DatasetItemDetailScreen> createState() => _DatasetItemDetailScreenState();
}

class _DatasetItemDetailScreenState extends ConsumerState<DatasetItemDetailScreen> {
  late DatasetItem currentItem;

  @override
  void initState() {
    super.initState();
    currentItem = widget.item;
  }

  void _toggleRevoke() {
    final box = ref.read(datasetBoxProvider);
    final updatedItem = DatasetItem(
      id: currentItem.id,
      title: currentItem.title,
      type: currentItem.type,
      contentSummary: currentItem.contentSummary,
      createdAt: currentItem.createdAt,
      status: currentItem.status,
      isRevoked: !currentItem.isRevoked,
    );
    box.put(currentItem.id, updatedItem);
    setState(() {
      currentItem = updatedItem;
    });
  }

  void _togglePause() {
    final box = ref.read(datasetBoxProvider);
    final newStatus = currentItem.status == 'processing' ? 'paused' : 'processing';
    final updatedItem = DatasetItem(
      id: currentItem.id,
      title: currentItem.title,
      type: currentItem.type,
      contentSummary: currentItem.contentSummary,
      createdAt: currentItem.createdAt,
      status: newStatus,
      isRevoked: currentItem.isRevoked,
    );
    box.put(currentItem.id, updatedItem);
    setState(() {
      currentItem = updatedItem;
    });
  }

  void _deleteItem() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Theme.of(context).brightness == Brightness.dark ? ALTColors.darkBgSurface02 : ALTColors.lightBgSurface02,
        title: const Text('Delete Data', style: ALTTypography.headlineMedium),
        content: const Text('Are you sure you want to permanently delete this data? This action cannot be undone.', style: ALTTypography.bodyLarge),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel', style: TextStyle(color: ALTColors.lightTextMuted)),
          ),
          TextButton(
            onPressed: () {
              ref.read(datasetBoxProvider).delete(currentItem.id);
              Navigator.of(ctx).pop(); // pop dialog
              Navigator.of(context).pop(); // pop screen
            },
            child: const Text('Delete', style: TextStyle(color: ALTColors.solarEmber)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    // Format Time and Date
    final timeStr = '${currentItem.createdAt.hour}:${currentItem.createdAt.minute.toString().padLeft(2, '0')}';
    final dateStr = '${currentItem.createdAt.day}/${currentItem.createdAt.month}/${currentItem.createdAt.year}';

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: GradientBackground(
        baseColor: isDark ? ALTColors.darkBgPage : ALTColors.lightBgPage,
        layers: isDark ? ALTGradients.alterDark : ALTGradients.alterLight,
        animate: true,
        child: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AppBar(
                backgroundColor: Colors.transparent,
                elevation: 0,
                title: const Text('Data Detail', style: ALTTypography.headlineSmall),
                leading: IconButton(
                  icon: const Icon(Icons.arrow_back),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(currentItem.title, style: ALTTypography.headlineLarge),
                    const SizedBox(height: 16),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  _buildBadge(currentItem.type.toUpperCase(), ALTColors.irisViolet),
                                  const SizedBox(width: 8),
                                  _buildBadge(currentItem.isRevoked ? 'REVOKED' : currentItem.status.toUpperCase(), currentItem.isRevoked ? ALTColors.vermillion : (currentItem.status == 'processed' ? ALTColors.jadeSurge : ALTColors.solarEmber)),
                                ],
                              ),
                              const SizedBox(height: 8),
                              Text(
                                'Added: $timeStr • $dateStr',
                                style: ALTTypography.bodySmall.copyWith(color: ALTColors.lightTextMuted),
                              ),
                            ],
                          ),
                        ),
                        if (currentItem.status == 'processing' || currentItem.status == 'paused')
                          OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(
                              foregroundColor: currentItem.status == 'paused' ? ALTColors.jadeSurge : ALTColors.solarEmber,
                              side: BorderSide(color: currentItem.status == 'paused' ? ALTColors.jadeSurge : ALTColors.solarEmber),
                            ),
                            icon: Icon(currentItem.status == 'paused' ? Icons.play_arrow : Icons.pause, size: 18),
                            label: Text(currentItem.status == 'paused' ? 'Resume' : 'Pause'),
                            onPressed: _togglePause,
                          )
                        else
                          OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(
                              foregroundColor: currentItem.isRevoked ? ALTColors.jadeSurge : ALTColors.vermillion,
                              side: BorderSide(color: currentItem.isRevoked ? ALTColors.jadeSurge : ALTColors.vermillion),
                            ),
                            icon: Icon(currentItem.isRevoked ? Icons.restore : Icons.block, size: 18),
                            label: Text(currentItem.isRevoked ? 'Restore' : 'Revoke'),
                            onPressed: _toggleRevoke,
                          ),
                      ],
                    ),
                    const SizedBox(height: 32),
                    const Text('Content / Summary', style: ALTTypography.headlineMedium),
                  ],
                ),
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: ALTCard(
                    padding: EdgeInsets.zero,
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.all(24),
                      child: SizedBox(
                        width: double.infinity,
                        child: Text(
                          currentItem.contentSummary,
                          style: ALTTypography.bodyLarge,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(24),
                child: Center(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: ALTColors.vermillion,
                      side: const BorderSide(color: ALTColors.vermillion),
                      padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
                    ),
                    icon: const Icon(Icons.delete_forever),
                    label: const Text('Delete Permanently'),
                    onPressed: _deleteItem,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBadge(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color),
      ),
      child: Text(
        label,
        style: ALTTypography.bodySmall.copyWith(color: color),
      ),
    );
  }
}
