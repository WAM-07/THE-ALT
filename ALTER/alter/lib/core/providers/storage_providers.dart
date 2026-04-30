import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive/hive.dart';
import '../models/persona.dart';
import '../models/consent_log.dart';
import '../storage/repositories/persona_repository.dart';
import '../storage/repositories/consent_repository.dart';

final personaBoxProvider = Provider<Box<Persona>>((ref) {
  return Hive.box<Persona>('personaBox');
});

final consentBoxProvider = Provider<Box<ConsentLog>>((ref) {
  return Hive.box<ConsentLog>('consentBox');
});

final personaRepositoryProvider = Provider<PersonaRepository>((ref) {
  final box = ref.watch(personaBoxProvider);
  return PersonaRepository(box);
});

final consentRepositoryProvider = Provider<ConsentRepository>((ref) {
  final box = ref.watch(consentBoxProvider);
  return ConsentRepository(box);
});

// A StateProvider or NotifierProvider can be built on top of this to reactively watch Persona state.
final currentPersonaProvider = StateProvider<Persona?>((ref) {
  final repo = ref.watch(personaRepositoryProvider);
  return repo.getPersona();
});
