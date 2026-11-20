class AppConstants {
  AppConstants._();

  /// Base del backend (puede sobreescribirse con --dart-define=API_BASE_URL=...).
  // AWS (dominio, HTTPS):  https://plasma3d.sebaces.fyi/   ← por defecto
  // AWS (IP, HTTP):        http://54.89.10.236/
  // Local (Wi-Fi):         http://192.168.0.14:8000/ (IP de tu PC)
  // Esta URL debe terminar en /. Las rutas ya incluyen "api/...".
  static const baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://plasma3d.sebaces.fyi/',
  );

  /// Base para archivos de media (sin slash final).
  // AWS (dominio): https://plasma3d.sebaces.fyi   · AWS (IP): http://54.89.10.236
  // Esta URL no debe terminar en /.
  static const baseUrlPacht = String.fromEnvironment(
    'API_MEDIA_URL',
    defaultValue: 'https://plasma3d.sebaces.fyi',
  );

  /// Plataforma web (los pagos con Stripe se hacen ahi).
  // AWS (dominio): https://plasma3d.sebaces.fyi   · AWS (IP): http://54.89.10.236
  static const webUrl = String.fromEnvironment(
    'WEB_URL',
    defaultValue: 'https://plasma3d.sebaces.fyi',
  );

  /// Página de planes y pagos de la web.
  static String get webPaymentUrl =>
      '${webUrl.endsWith('/') ? webUrl.substring(0, webUrl.length - 1) : webUrl}/private/pago';

  /// Base normalizada con slash final.
  static String get apiBase => baseUrl.endsWith('/') ? baseUrl : '$baseUrl/';
}
