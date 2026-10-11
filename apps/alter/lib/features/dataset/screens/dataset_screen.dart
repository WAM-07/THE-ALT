import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';
import '../../../core/models/dataset_item.dart';
import '../../../core/theme/colors.dart';
import '../../../core/theme/typography.dart';
import '../../../shared/widgets/alt_card.dart';
import '../widgets/add_data_sheet.dart';
import 'dataset_item_detail_screen.dart';

import '../../../core/theme/gradients.dart';
import '../../../shared/widgets/gradient_background.dart';

final datasetBoxProvider = Provider<Box<DatasetItem>>((ref) {
  return Hive.box<DatasetItem>('datasetBox');
});

class DatasetScreen extends ConsumerWidget {
  const DatasetScreen({super.key});

  void _seedMockData(Box<DatasetItem> box) {
    if (box.isEmpty) {
      box.put('1', DatasetItem(id: '1', title: 'Journal Entry: Dreams', type: 'text', contentSummary: 'A discussion about my future goals and creative aspirations.', createdAt: DateTime.now().subtract(const Duration(days: 1)), status: 'processed'));
      box.put('2', DatasetItem(id: '2', title: 'Work Resume', type: 'document', contentSummary: 'PDF containing professional experience and skills.', createdAt: DateTime.now().subtract(const Duration(hours: 5)), status: 'processed'));
      box.put('3', DatasetItem(id: '3', title: 'Voice Note 01', type: 'audio', contentSummary: 'Thoughts on the new digital sovereignty movement.', createdAt: DateTime.now().subtract(const Duration(minutes: 30)), status: 'processing'));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final box = ref.watch(datasetBoxProvider);
    
    // Auto-seed for demonstration purposes
    _seedMockData(box);

    return GradientBackground(
      baseColor: isDark ? ALTColors.darkBgPage : ALTColors.lightBgPage,
      layers: isDark ? ALTGradients.alterDark : ALTGradients.alterLight,
      animate: true,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: AppBar(
          title: const Text('My Dataset', style: ALTTypography.headlineMedium),
          backgroundColor: Colors.transparent,
          elevation: 0,
        ),
        body: Padding(
          padding: const EdgeInsets.only(bottom: 90.0),
          child: ClipRRect(
            borderRadius: const BorderRadius.vertical(bottom: Radius.circular(32)),
            child: ValueListenableBuilder(
              valueListenable: box.listenable(),
        builder: (context, Box<DatasetItem> box, _) {
          if (box.isEmpty) {
            return const Center(child: Text("Your dataset is empty."));
          }

          final items = box.values.toList()..sort((a, b) => b.createdAt.compareTo(a.createdAt));

          return ListView.separated(
            padding: const EdgeInsets.only(left: 16, right: 16, top: 16, bottom: 48),
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (context, index) {
              final item = items[index];
              return GestureDetector(
                onTap: () {
                  Navigator.of(context, rootNavigator: true).push(
                    MaterialPageRoute(builder: (_) => DatasetItemDetailScreen(item: item)),
                  );
                },
                child: ALTCard(
                padding: const EdgeInsets.all(16),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildTypeIcon(item.type),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(item.title, style: ALTTypography.labelLarge),
                          const SizedBox(height: 4),
                          Text(item.contentSummary, style: ALTTypography.bodySmall, maxLines: 2, overflow: TextOverflow.ellipsis),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              Text(
                                '${item.createdAt.day}/${item.createdAt.month}/${item.createdAt.year} • ',
                                style: ALTTypography.bodySmall.copyWith(color: ALTColors.lightTextMuted),
                              ),
                              Text(
                                item.isRevoked ? 'REVOKED' : item.status.toUpperCase(),
                                style: ALTTypography.bodySmall.copyWith(
                                  color: item.isRevoked ? ALTColors.vermillion : (item.status == 'processed' ? ALTColors.jadeSurge : ALTColors.solarEmber),
                                ),
                              ),
                            ],
                          )
                        ],
                      ),
                    ),
                  ],
                ),
              ));
            },
          );
        },
      ),
      ),
      ),
      floatingActionButton: Padding(
        padding: const EdgeInsets.only(bottom: 110.0),
        child: FloatingActionButton(
          onPressed: () {
            showModalBottomSheet(
              context: context,
              isScrollControlled: true,
              backgroundColor: Colors.transparent,
              builder: (context) => const AddDataSheet(),
            );
          },
          backgroundColor: ALTColors.irisViolet,
          child: const Icon(Icons.add, color: Colors.white),
        ),
      ),
    ));
  }

  Widget _buildTypeIcon(String type) {
    IconData icon;
    switch (type) {
      case 'document': icon = Icons.description; break;
      case 'audio': icon = Icons.mic; break;
      case 'text': default: icon = Icons.text_snippet; break;
    }
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: ALTColors.irisViolet.withOpacity(0.2),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Icon(icon, color: ALTColors.violet100),
    );
  }
}
