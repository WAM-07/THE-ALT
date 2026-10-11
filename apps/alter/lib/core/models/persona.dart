import 'package:hive/hive.dart';

class Persona {
  final String id;
  final String name;
  final int age;
  final String pronouns;
  final List<String> roles;
  final String? avatarPath;
  final String? primaryTrait;
  final DateTime createdAt;

  Persona({
    required this.id,
    required this.name,
    required this.age,
    required this.pronouns,
    required this.roles,
    this.avatarPath,
    this.primaryTrait,
    required this.createdAt,
  });
}

class PersonaAdapter extends TypeAdapter<Persona> {
  @override
  final int typeId = 0;

  @override
  Persona read(BinaryReader reader) {
    return Persona(
      id: reader.readString(),
      name: reader.readString(),
      age: reader.readInt(),
      pronouns: reader.readString(),
      roles: reader.readStringList(),
      avatarPath: reader.read() as String?,
      primaryTrait: reader.read() as String?,
      createdAt: DateTime.fromMillisecondsSinceEpoch(reader.readInt()),
    );
  }

  @override
  void write(BinaryWriter writer, Persona obj) {
    writer.writeString(obj.id);
    writer.writeString(obj.name);
    writer.writeInt(obj.age);
    writer.writeString(obj.pronouns);
    writer.writeStringList(obj.roles);
    writer.write(obj.avatarPath);
    writer.write(obj.primaryTrait);
    writer.writeInt(obj.createdAt.millisecondsSinceEpoch);
  }
}
