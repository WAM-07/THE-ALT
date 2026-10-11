/// Makes a file link from ALT (an avatar, a local IPFS manifest) reachable from this device.
///
/// ALT Core writes links with its public address, which in development is
/// `http://localhost:8080`. On a phone or the Android emulator "localhost" is the device itself,
/// so a link to a loopback host is pointed at the address the app already uses for the API
/// (`http://10.0.2.2:8080`, or the PC's LAN address). Other links are returned unchanged.
String altMediaUrl(String url, String apiUrl) {
  final link = Uri.tryParse(url);
  final api = Uri.tryParse(apiUrl);
  if (link == null || api == null || !link.hasAuthority || !api.hasAuthority) return url;
  const loopback = {'localhost', '127.0.0.1', '::1', '[::1]'};
  if (!loopback.contains(link.host) || link.host == api.host) return url;
  return link.replace(scheme: api.scheme, host: api.host, port: api.port).toString();
}
