import 'package:get/get.dart';

class AuthService extends GetConnect {
  AuthService(String baseUrl) {
    httpClient.baseUrl = baseUrl.endsWith('/') ? baseUrl : '$baseUrl/';
    httpClient.timeout = const Duration(seconds: 30);
    httpClient.defaultContentType = 'application/json';
  }

  Map<String, String> _auth(String token) => {
    'Authorization': 'Bearer $token',
    'Accept': 'application/json',
  };

  Future<Response> register(Map<String, dynamic> body) =>
      post('api/users/auth/registro/', body);

  Future<Response> login(Map<String, dynamic> body) =>
      post('api/users/auth/login/', body);

  Future<Response> logout(String token) =>
      post('api/users/auth/logout/', {}, headers: _auth(token));

  Future<Response> registerPushDevice(
    String token,
    String deviceToken,
    String platform,
  ) => post('api/notifications/devices/register/', {
    'token': deviceToken,
    'platform': platform,
  }, headers: _auth(token));

  Future<Response> unregisterPushDevice(
    String token,
    String deviceToken,
    String platform,
  ) => post('api/notifications/devices/unregister/', {
    'token': deviceToken,
    'platform': platform,
  }, headers: _auth(token));

  /// Actualiza el perfil via el ViewSet (hashea password y valida JWT).
  Future<Response> updateProfile(
    String token,
    int usuarioId,
    Map<String, dynamic> body,
  ) => patch('api/users/usuarios/$usuarioId/', body, headers: _auth(token));
}
