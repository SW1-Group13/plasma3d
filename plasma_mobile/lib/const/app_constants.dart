import 'package:flutter_dotenv/flutter_dotenv.dart';

class AppConstants {
  AppConstants._();

  /// Valor de --dart-define (tiene prioridad sobre .env).
  static const _apiBaseDefine = String.fromEnvironment('API_BASE_URL');
  static const _apiMediaDefine = String.fromEnvironment('API_MEDIA_URL');
  static const _webUrlDefine = String.fromEnvironment('WEB_URL');

  /// Base del backend. Debe terminar en /.
  /// Prioridad: --dart-define > .env > valor por defecto.
  static String get baseUrl =>
      _value('API_BASE_URL', _apiBaseDefine, 'http://54.89.10.236/');

  /// Base para archivos de media (sin slash final).
  static String get baseUrlPacht =>
      _value('API_MEDIA_URL', _apiMediaDefine, 'http://54.89.10.236');

  /// Plataforma web para planes y pagos (sin slash final).
  static String get webUrl =>
      _value('WEB_URL', _webUrlDefine, 'http://54.89.10.236');

  /// Página de planes y pagos de la web.
  static String get webPaymentUrl =>
      '${webUrl.endsWith('/') ? webUrl.substring(0, webUrl.length - 1) : webUrl}/private/pago';

  /// Base normalizada con slash final.
  static String get apiBase => baseUrl.endsWith('/') ? baseUrl : '$baseUrl/';

  static String _value(String key, String fromDefine, String fallback) {
    if (fromDefine.isNotEmpty) return fromDefine;
    if (dotenv.isInitialized) {
      final fromEnv = dotenv.env[key]?.trim();
      if (fromEnv != null && fromEnv.isNotEmpty) return fromEnv;
    }
    return fallback;
  }
}
