import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Notificaciones locales Android mediante un canal nativo (sin plugins).
class LocalNotificationsService {
  LocalNotificationsService._();

  static final LocalNotificationsService instance =
      LocalNotificationsService._();

  static const _channel = MethodChannel('plasma3d/local_notifications');

  bool _initialized = false;

  Future<void> initialize() async {
    if (_initialized ||
        kIsWeb ||
        defaultTargetPlatform != TargetPlatform.android) {
      return;
    }

    try {
      await _channel.invokeMethod<void>('initialize');
      _initialized = true;
    } catch (_) {
      // Si el dispositivo no soporta notificaciones locales, la app sigue.
    }
  }

  Future<void> show(String title, String body) async {
    if (!_initialized) return;
    try {
      await _channel.invokeMethod<void>('show', {'title': title, 'body': body});
    } catch (_) {
      // Una notificación fallida no debe romper la acción del usuario.
    }
  }
}
