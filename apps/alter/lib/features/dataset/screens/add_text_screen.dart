import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../../../core/models/dataset_item.dart';
import '../../../core/theme/colors.dart';
import '../../../core/theme/gradients.dart';
import '../../../core/theme/typography.dart';
import '../../../shared/widgets/gradient_background.dart';
import '../../../shared/widgets/alt_button.dart';
import '../screens/dataset_screen.dart';

class AddTextScreen extends ConsumerStatefulWidget {
  const AddTextScreen({super.key});

  @override
  ConsumerState<AddTextScreen> createState() => _AddTextScreenState();
}

class _AddTextScreenState extends ConsumerState<AddTextScreen> {
  final _titleCtrl = TextEditingController();
  final _contentCtrl = TextEditingController();

  void _saveEntry() {
    if (_titleCtrl.text.isEmpty || _contentCtrl.text.isEmpty) return;

    final box = ref.read(datasetBoxProvider);
    final id = const Uuid().v4();

    box.put(id, DatasetItem(
      id: id,
      title: _titleCtrl.text.trim(),
      type: 'text',
      contentSummary: _contentCtrl.text.trim(),
      createdAt: DateTime.now(),
      status: 'processed',
    ));

    Navigator.of(context).pop();
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _contentCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: GradientBackground(
        baseColor: isDark ? ALTColors.darkBgPage : ALTColors.lightBgPage,
        layers: isDark ? ALTGradients.alterDark : ALTGradients.alterLight,
        animate: true,
        child: SafeArea(
          child: Column(
            children: [
              AppBar(
                backgroundColor: Colors.transparent,
                elevation: 0,
                title: const Text('New Journal Entry', style: ALTTypography.headlineSmall),
                leading: IconButton(
                  icon: const Icon(Icons.close),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.all(24.0),
                  child: Column(
                    children: [
                      TextField(
                        controller: _titleCtrl,
                        style: ALTTypography.headlineMedium,
                        decoration: const InputDecoration(
                          hintText: 'Title',
                          border: InputBorder.none,
                        ),
                      ),
                      const Divider(),
                      Expanded(
                        child: TextField(
                          controller: _contentCtrl,
                          maxLines: null,
                          expands: true,
                          style: ALTTypography.bodyLarge,
                          decoration: const InputDecoration(
                            hintText: 'Start typing your thoughts...',
                            border: InputBorder.none,
                          ),
                        ),
                      ),
                      const SizedBox(height: 16),
                      SizedBox(
                        width: double.infinity,
                        child: ALTButton(
                          label: 'Save & Analyze',
                          onPressed: _saveEntry,
                        ),
                      )
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
