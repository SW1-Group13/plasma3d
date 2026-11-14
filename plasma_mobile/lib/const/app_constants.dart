class AppConstants {
  AppConstants._();

  /// Base del backend (puede sobreescribirse con --dart-define=API_BASE_URL=...).
  static const baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://django-sw1.fournext.me/',
  );

  /// Base para archivos de media (sin slash final).
  static const baseUrlPacht = String.fromEnvironment(
    'API_MEDIA_URL',
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
