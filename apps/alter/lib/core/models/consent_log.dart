import 'package:hive/hive.dart';

class ConsentLog {
  final String id;
  final DateTime timestamp;
  final String action;
  final bool status;

  ConsentLog({
    required this.id,
    required this.timestamp,
    required this.action,
    required this.status,
  });
}

class ConsentLogAdapter extends TypeAdapter<ConsentLog> {
  @override
  final int typeId = 1;

  @override
  ConsentLog read(BinaryReader reader) {
    return ConsentLog(
      id: reader.readString(),
      timestamp: DateTime.fromMillisecondsSinceEpoch(reader.readInt()),
      action: reader.readString(),
      status: reader.readBool(),
    );
  }

  @override
  void write(BinaryWriter writer, ConsentLog obj) {
    writer.writeString(obj.id);
    writer.writeInt(obj.timestamp.millisecondsSinceEpoch);
    writer.writeString(obj.action);
    writer.writeBool(obj.status);
  }
}
