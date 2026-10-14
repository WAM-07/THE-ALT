import 'package:alt_account/alt_account.dart';
import 'package:image_picker/image_picker.dart';

/// A photo from the gallery for the ALT picture picker ("Upload a photo"), resized for a profile.
Future<AltPickedPhoto?> pickAltPhoto() async {
  final file = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 1024, maxHeight: 1024, imageQuality: 88);
  if (file == null) return null;
  final name = file.name.toLowerCase();
  final mime = name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  return (bytes: await file.readAsBytes(), fileName: file.name, mimeType: mime);
}
