/// An error returned by an ALT service, e.g. `INVALID_CREDENTIALS` or `ACCOUNT_LOCKED`.
/// [message] is written for people and safe to show in the UI.
class AltApiException implements Exception {
  const AltApiException({required this.status, required this.code, required this.message, this.details});

  final int status;
  final String code;
  final String message;
  final Map<String, dynamic>? details;

  bool get isNetwork => status == 0;
  bool get isUnauthorized => status == 401;

  static AltApiException network(Object error) =>
      AltApiException(status: 0, code: 'NETWORK', message: 'Cannot reach ALT. Check your connection and try again.', details: {'error': '$error'});

  /// Understands ALT Core's `{error: {code, message}}` and ALTERA's `{message, code}` shapes.
  static AltApiException fromBody(int status, Object? body) {
    if (body is Map) {
      final err = body['error'];
      if (err is Map) {
        return AltApiException(
          status: status,
          code: '${err['code'] ?? 'ERROR'}',
          message: '${err['message'] ?? 'Something went wrong.'}',
          details: err['details'] is Map ? Map<String, dynamic>.from(err['details'] as Map) : null,
        );
      }
      if (body['message'] != null) {
        return AltApiException(status: status, code: '${body['code'] ?? 'ERROR'}', message: '${body['message']}');
      }
    }
    return AltApiException(status: status, code: 'HTTP_$status', message: 'Something went wrong (HTTP $status).');
  }

  @override
  String toString() => 'AltApiException($status $code: $message)';
}
