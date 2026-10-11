import 'package:hive/hive.dart';

class DatasetItem {
  final String id;
  final String title;
  final String type; // e.g., 'text', 'document', 'audio'
  final String contentSummary;
  final DateTime createdAt;
  final String status; // e.g., 'processed', 'processing', 'failed'
  final bool isRevoked;

  DatasetItem({
    required this.id,
    required this.title,
    required this.type,
    required this.contentSummary,
    required this.createdAt,
    required this.status,
    this.isRevoked = false,
  });
}

class DatasetItemAdapter extends TypeAdapter<DatasetItem> {
  @override
  final int typeId = 2;

  @override
  DatasetItem read(BinaryReader reader) {
    final id = reader.readString();
    final title = reader.readString();
    final type = reader.readString();
    final contentSummary = reader.readString();
    final createdAt = DateTime.fromMillisecondsSinceEpoch(reader.readInt());
    final status = reader.readString();
    bool isRevoked = false;
    try {
      isRevoked = reader.readBool();
    } catch (_) {}

    return DatasetItem(
      id: id,
      title: title,
      type: type,
      contentSummary: contentSummary,
      createdAt: createdAt,
      status: status,
      isRevoked: isRevoked,
    );
  }

  @override
  void write(BinaryWriter writer, DatasetItem obj) {
    writer.writeString(obj.id);
    writer.writeString(obj.title);
    writer.writeString(obj.type);
    writer.writeString(obj.contentSummary);
    writer.writeInt(obj.createdAt.millisecondsSinceEpoch);
    writer.writeString(obj.status);
    writer.writeBool(obj.isRevoked);
  }
}
