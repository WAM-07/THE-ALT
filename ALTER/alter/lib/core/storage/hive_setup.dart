import 'package:hive_flutter/hive_flutter.dart';
import '../models/persona.dart';
import '../models/consent_log.dart';
import '../models/dataset_item.dart';

class HiveSetup {
  static Future<void> init() async {
    await Hive.initFlutter();
    
    // Register Adapters
    Hive.registerAdapter(PersonaAdapter());
    Hive.registerAdapter(ConsentLogAdapter());
    Hive.registerAdapter(DatasetItemAdapter());
    
    // Open Boxes
    await Hive.openBox<Persona>('personaBox');
    await Hive.openBox<ConsentLog>('consentBox');
    await Hive.openBox<DatasetItem>('datasetBox');
  }
}
