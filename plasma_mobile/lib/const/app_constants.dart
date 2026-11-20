class AppConstants {
  AppConstants._();

  /// Base del backend (puede sobreescribirse con --dart-define=API_BASE_URL=...).
  // Local: http://192.168.0.14:8000/ (IP Wi-Fi actual de esta computadora).
  // AWS:   https://api.tudominio.com/ (reemplazar por el dominio real).
  // Esta URL debe terminar en /.
  static const baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    // REEMPLAZAR el texto entre comillas de defaultValue por la URL local o de AWS.
    defaultValue: 'https://django-sw1.fournext.me/',
  );

  /// Base para archivos de media (sin slash final).
  // Local: http://192.168.0.14:8000 (IP Wi-Fi actual de esta computadora).
  // AWS:   https://api.tudominio.com (el mismo dominio del backend).
  // Esta URL no debe terminar en /.
  static const baseUrlPacht = String.fromEnvironment(
    'API_MEDIA_URL',
    // REEMPLAZAR el texto entre comillas de defaultValue por la misma URL, sin / final.
    defaultValue: 'https://django-sw1.fournext.me',
  );

  /// Plataforma web (los pagos con Stripe se hacen ahi).
  static const webUrl = String.fromEnvironment(
    'WEB_URL',
    defaultValue: 'https://front-sw1.fournext.me',
  );

  /// Página de planes y pagos de la web.
  static String get webPaymentUrl =>
      '${webUrl.endsWith('/') ? webUrl.substring(0, webUrl.length - 1) : webUrl}/private/pago';

  /// Base normalizada con slash final.
  static String get apiBase => baseUrl.endsWith('/') ? baseUrl : '$baseUrl/';
}
