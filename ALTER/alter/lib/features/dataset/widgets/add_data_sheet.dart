import 'package:flutter/material.dart';
import 'package:hive/hive.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../../../core/models/dataset_item.dart';
import '../../../core/theme/colors.dart';
import '../../../core/theme/typography.dart';
import '../screens/dataset_screen.dart';
import '../screens/add_text_screen.dart';

class AddDataSheet extends ConsumerWidget {
  const AddDataSheet({super.key});

  void _addMockItem(BuildContext context, WidgetRef ref, String title, String type, String summary) {
    final box = ref.read(datasetBoxProvider);
    final id = const Uuid().v4();
    
    // Simulate upload delay
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Processing $type upload...'), backgroundColor: ALTColors.irisViolet),
    );
    
    Navigator.of(context).pop(); // Close bottom sheet
    
    Future.delayed(const Duration(seconds: 2), () {
      box.put(id, DatasetItem(
        id: id,
        title: title,
        type: type,
        contentSummary: summary,
        createdAt: DateTime.now(),
        status: 'processed',
      ));
    });
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: isDark ? ALTColors.darkBgSurface01 : ALTColors.lightBgSurface01,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Add to Dataset', style: ALTTypography.headlineMedium),
            const SizedBox(height: 8),
            const Text('Feed your ALT new context to expand its neural pathways.', style: ALTTypography.bodySmall),
            const SizedBox(height: 24),
            
            _buildOption(
              icon: Icons.edit_note,
              title: 'Journal Entry',
              subtitle: 'Type a thought, memory, or opinion directly.',
              onTap: () {
                Navigator.of(context).pop();
                Navigator.of(context, rootNavigator: true).push(
                  MaterialPageRoute(builder: (_) => const AddTextScreen()),
                );
              },
            ),
            _buildOption(
              icon: Icons.picture_as_pdf,
              title: 'Upload Document',
              subtitle: 'PDFs, Word docs, or spreadsheets (Mock)',
              onTap: () => _addMockItem(context, ref, 'Uploaded Document', 'document', 'Analyzed textual data from document file.'),
            ),
            _buildOption(
              icon: Icons.mic,
              title: 'Record Voice Note',
              subtitle: 'Speak your thoughts aloud (Mock)',
              onTap: () => _addMockItem(context, ref, 'Audio Recording', 'audio', 'Transcribed audio content pending analysis.'),
            ),
            _buildOption(
              icon: Icons.image,
              title: 'Upload Image',
              subtitle: 'Photos or screenshots (Mock)',
              onTap: () => _addMockItem(context, ref, 'Image Upload', 'image', 'Extracted metadata and context from image.'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildOption({required IconData icon, required String title, required String subtitle, required VoidCallback onTap}) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: ALTColors.irisViolet.withOpacity(0.2),
          shape: BoxShape.circle,
        ),
        child: Icon(icon, color: ALTColors.violet100),
      ),
      title: Text(title, style: ALTTypography.labelLarge),
      subtitle: Text(subtitle, style: ALTTypography.bodySmall),
      onTap: onTap,
    );
  }
}
