import 'dart:async';
import 'dart:convert';

import 'package:get/get.dart';
import 'package:get_storage/get_storage.dart';
import 'package:plasma_mobile/api/auth_service.dart';
import 'package:plasma_mobile/notifications/push_notifications_service.dart';
import 'package:plasma_mobile/routes/routes.dart';

import '../models/user_model.dart';

class AuthController extends GetxController {
  late final AuthService _api;
  final _box = GetStorage();

  final isLoading = false.obs;
  final _isFirstTime = true.obs;
  final _isLogged = false.obs;

  bool get isFirstTime => _isFirstTime.value;
  bool get isLoggedIn => _isLogged.value || accessToken != null;

  final Rxn<UserModel> currentUser = Rxn<UserModel>();
  StreamSubscription<String>? _pushTokenSubscription;

  final String baseUrl;
  AuthController({required this.baseUrl});

  @override
  void onInit() {
    _api = AuthService(baseUrl);
    _isFirstTime.value = _box.read('isFirstTime') ?? true;
    _isLogged.value = _box.read('isLoggedIn') ?? false;
    _restoreUser();
    _pushTokenSubscription = PushNotificationsService
        .instance
        .registrationStream
        .listen((token) => _registerPushToken(token));
    super.onInit();
  }

  @override
  void onClose() {
    _pushTokenSubscription?.cancel();
    super.onClose();
  }

  void _restoreUser() {
    final raw = _box.read('usuario');
    if (raw == null) return;
    try {
      if (raw is Map) {
        currentUser.value = UserModel.fromJson(Map<String, dynamic>.from(raw));
      } else if (raw is String) {
        currentUser.value = UserModel.fromJson(
          jsonDecode(raw) as Map<String, dynamic>,
        );
      }
    } catch (_) {
      currentUser.value = null;
    }
  }

  String? get accessToken => _box.read('access');
  String? get refreshToken => _box.read('refresh');

  void setFirstTimeDone() {
    _isFirstTime.value = false;
    _box.write('isFirstTime', false);
  }

  void _saveUser(dynamic usuarioJson) {
    if (usuarioJson is! Map) return;
    final map = Map<String, dynamic>.from(usuarioJson);
    currentUser.value = UserModel.fromJson(map);
    _box.write('usuario', map);
  }

  /// Aplica un usuario devuelto por otro endpoint (p.ej. pago).
  void applyUser(dynamic usuarioJson) {
    _saveUser(usuarioJson);
    _isLogged.value = true;
    _box.write('isLoggedIn', true);
  }

  String _message(dynamic res, String fallback) {
    try {
      final body = res.body;
      if (body is Map) {
        final value = body['detail'] ?? body['error'] ?? body['message'];
        if (value != null) return value.toString();
        if (body.isNotEmpty) {
          final first = body.values.first;
          if (first is List && first.isNotEmpty) return first.first.toString();
          return first.toString();
        }
      }
    } catch (_) {
      // Ignorar y usar el fallback.
    }
    return fallback;
  }

  Future<void> register(UserModel user) async {
    try {
      isLoading.value = true;
      final res = await _api.register(user.toJsonRegistro());
      if (res.isOk) {
        await login(
          UserModel(nombre: '', email: user.email, password: user.password),
        );
      } else {
        Get.snackbar(
          'No se pudo registrar',
          _message(res, 'Revisa los datos e inténtalo de nuevo.'),
        );
      }
    } catch (e) {
      Get.snackbar('Error de conexión', '$e');
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> login(UserModel user) async {
    try {
      isLoading.value = true;
      final res = await _api.login(user.toJsonLogin());

      if (res.isOk && res.body is Map) {
        final data = res.body as Map;
        _box.write('access', data['access']);
        _box.write('refresh', data['refresh']);
        _box.write('isLoggedIn', true);
        _isLogged.value = true;
        _saveUser(data['usuario']);
        Get.offAllNamed(AppRoutes.home);
        unawaited(registerPushDevice());
      } else {
        Get.snackbar(
          'Credenciales',
          _message(res, 'Email o contraseña inválidos'),
        );
      }
    } catch (e) {
      Get.snackbar('Error de conexión', '$e');
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> logout() async {
    final token = accessToken;
    final deviceToken = _box.read('push_fid') as String?;
    if (token != null && deviceToken != null) {
      try {
        await _api.unregisterPushDevice(
          token,
          deviceToken,
          PushNotificationsService.instance.platformName,
        );
      } catch (_) {
        // La limpieza del dispositivo no debe impedir cerrar la sesión.
      }
    }
    try {
      if (token != null) {
        await _api.logout(token);
      }
    } catch (_) {
      // El logout del backend es opcional.
    }

    final firstTime = _box.read('isFirstTime') ?? false;
    await _box.erase();
    _box.write('isFirstTime', firstTime);

    currentUser.value = null;
    _isLogged.value = false;
    Get.offAllNamed(AppRoutes.signin);
  }

  Future<bool> updateProfile({String? nombre, String? password}) async {
    final token = accessToken;
    final id = currentUser.value?.id;

    if (token == null || id == null) {
      Get.snackbar(
        'Sesión',
        'Inicia sesión de nuevo para actualizar tu perfil.',
      );
      return false;
    }

    final body = <String, dynamic>{};
    if (nombre != null && nombre.trim().isNotEmpty) {
      body['nombre'] = nombre.trim();
    }
    if (password != null && password.isNotEmpty) {
      body['password'] = password;
    }
    if (body.isEmpty) return false;

    try {
      isLoading.value = true;
      final res = await _api.updateProfile(token, id, body);

      if (res.isOk && res.body is Map) {
        _saveUser(res.body);
        Get.snackbar(
          'Perfil actualizado',
          'Tus datos se guardaron correctamente.',
        );
        return true;
      }

      Get.snackbar(
        'No se pudo actualizar',
        _message(res, 'Inténtalo de nuevo.'),
      );
      return false;
    } catch (e) {
      Get.snackbar('Error de conexión', '$e');
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  String? getToken() {
    final token = accessToken;
    if (token != null && token.isNotEmpty) return token;
    final stored = _box.read('access');
    if (stored is String && stored.isNotEmpty) return stored;
    return null;
  }

  Future<void> registerPushDevice() async {
    if (!isLoggedIn || accessToken == null) return;
    try {
      await PushNotificationsService.instance.registerDevice();
    } catch (_) {
      // Un fallo de notificaciones no debe bloquear el inicio de sesión.
    }
  }

  Future<void> _registerPushToken(String deviceToken) async {
    final token = accessToken;
    if (token == null || token.isEmpty) return;
    try {
      _box.write('push_fid', deviceToken);
      await _api.registerPushDevice(
        token,
        deviceToken,
        PushNotificationsService.instance.platformName,
      );
    } catch (_) {
      // El registro se reintentará al renovar el token o iniciar sesión.
    }
  }
}
