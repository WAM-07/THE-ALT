import 'package:hive/hive.dart';
import '../../models/persona.dart';

class PersonaRepository {
  final Box<Persona> _box;

  PersonaRepository(this._box);

  Future<void> savePersona(Persona persona) async {
    await _box.put('current_user', persona);
  }

  Persona? getPersona() {
    return _box.get('current_user');
  }

  Future<void> clearPersona() async {
    await _box.delete('current_user');
  }
}
