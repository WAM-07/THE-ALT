import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Asks for a 6-digit code (email verification or authenticator app).
/// When [allowRecoveryCode] is true the person can switch to entering a recovery code instead.
/// Returns `(code: ..., recovery: false)`, or null if cancelled.
Future<({String code, bool recovery})?> showAltCodeDialog(
  BuildContext context, {
  required String title,
  required String message,
  bool allowRecoveryCode = false,
  Future<void> Function()? onResend,
}) {
  return showDialog<({String code, bool recovery})>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) => _CodeDialog(title: title, message: message, allowRecoveryCode: allowRecoveryCode, onResend: onResend),
  );
}

class _CodeDialog extends StatefulWidget {
  const _CodeDialog({required this.title, required this.message, required this.allowRecoveryCode, this.onResend});

  final String title;
  final String message;
  final bool allowRecoveryCode;
  final Future<void> Function()? onResend;

  @override
  State<_CodeDialog> createState() => _CodeDialogState();
}

class _CodeDialogState extends State<_CodeDialog> {
  final _ctrl = TextEditingController();
  bool _recovery = false;
  bool _resending = false;
  String? _error;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  void _submit() {
    final value = _ctrl.text.trim();
    if (_recovery ? value.length < 8 : !RegExp(r'^\d{6}$').hasMatch(value)) {
      setState(() => _error = _recovery ? 'Enter one of your recovery codes' : 'Enter the 6-digit code');
      return;
    }
    Navigator.of(context).pop((code: value, recovery: _recovery));
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.title),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(_recovery ? 'Enter one of the recovery codes you saved when you turned on two-factor authentication.' : widget.message),
          const SizedBox(height: 16),
          TextField(
            controller: _ctrl,
            autofocus: true,
            keyboardType: _recovery ? TextInputType.text : TextInputType.number,
            inputFormatters: _recovery ? null : [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 22, letterSpacing: 6),
            decoration: InputDecoration(hintText: _recovery ? 'xxxx-xxxx' : '000000', errorText: _error, border: const OutlineInputBorder()),
            onSubmitted: (_) => _submit(),
          ),
          if (widget.allowRecoveryCode)
            TextButton(
              onPressed: () => setState(() {
                _recovery = !_recovery;
                _ctrl.clear();
                _error = null;
              }),
              child: Text(_recovery ? 'Use my authenticator app instead' : 'Use a recovery code'),
            ),
          if (widget.onResend != null)
            TextButton(
              onPressed: _resending
                  ? null
                  : () async {
                      setState(() => _resending = true);
                      try {
                        await widget.onResend!();
                        if (context.mounted) {
                          ScaffoldMessenger.maybeOf(context)?.showSnackBar(const SnackBar(content: Text('We sent a new code.')));
                        }
                      } catch (_) {
                        // The message already explains; the server rate-limits resends.
                      } finally {
                        if (mounted) setState(() => _resending = false);
                      }
                    },
              child: const Text('Send a new code'),
            ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
        FilledButton(onPressed: _submit, child: const Text('Continue')),
      ],
    );
  }
}
