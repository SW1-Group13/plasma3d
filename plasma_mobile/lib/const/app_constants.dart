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

  /// Base normalizada con slash final.
  static String get apiBase => baseUrl.endsWith('/') ? baseUrl : '$baseUrl/';
}
