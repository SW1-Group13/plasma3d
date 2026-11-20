import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:get/get.dart';
import 'package:plasma_mobile/routes/routes.dart';

class PushNotificationsService {
  PushNotificationsService._();

  static final PushNotificationsService instance = PushNotificationsService._();

  bool _initialized = false;

  Future<void> initialize() async {
    if (_initialized || !_isSupportedPlatform) return;
    _initialized = true;

    FirebaseMessaging.onMessage.listen(_onForegroundMessage);
    FirebaseMessaging.onMessageOpenedApp.listen(_openFromMessage);

    final initialMessage = await FirebaseMessaging.instance.getInitialMessage();
    if (initialMessage != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _openFromMessage(initialMessage);
      });
    }
  }

  Future<void> registerDevice() async {
    if (!_isSupportedPlatform) return;
    final settings = await FirebaseMessaging.instance.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );
    if (settings.authorizationStatus == AuthorizationStatus.denied) return;
    await FirebaseMessaging.instance.register();
  }

  Stream<String> get registrationStream => _isSupportedPlatform
      ? FirebaseMessaging.instance.onRegistered
      : const Stream<String>.empty();

  String get platformName =>
      defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android';

  void _onForegroundMessage(RemoteMessage message) {
    final notification = message.notification;
    if (notification == null) return;

    Get.snackbar(
      notification.title ?? 'Plasma3D',
      notification.body ?? 'Tienes una nueva notificación.',
      snackPosition: SnackPosition.BOTTOM,
    );
  }

  void _openFromMessage(RemoteMessage message) {
    if (message.data['type'] == 'model_ready') {
      Get.offAllNamed(AppRoutes.home);
    }
  }

  bool get _isSupportedPlatform =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
}
