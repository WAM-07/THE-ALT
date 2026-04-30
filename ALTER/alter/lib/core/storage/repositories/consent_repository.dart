import 'package:hive/hive.dart';
import '../../models/consent_log.dart';

class ConsentRepository {
  final Box<ConsentLog> _box;

  ConsentRepository(this._box);

  Future<void> logConsent(ConsentLog log) async {
    await _box.put(log.id, log);
  }

  List<ConsentLog> getAllLogs() {
    return _box.values.toList()..sort((a, b) => b.timestamp.compareTo(a.timestamp));
  }
}
