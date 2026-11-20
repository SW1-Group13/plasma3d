// lib/main.dart
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:get/get.dart';
import 'package:get_storage/get_storage.dart';
import 'package:plasma_mobile/screens/auth/controller/model_controller.dart';
import 'package:plasma_mobile/screens/auth/service/auth_controller.dart';

import 'config/app_themes.dart';
import 'config/theme_controller.dart';
import 'firebase_options.dart';
import 'notifications/local_notifications_service.dart';
import 'notifications/push_notifications_service.dart';
import 'routes/routes.dart';

// -- importacion de las constantes
import 'const/app_constants.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    await dotenv.load(fileName: '.env');
  } catch (_) {
    // Si el asset no existe, AppConstants usa los valores por defecto.
  }
  if (defaultTargetPlatform == TargetPlatform.android) {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
  }
  await GetStorage.init();
  await LocalNotificationsService.instance.initialize();

  Get.put(ThemeController());

  //const baseUrl = 'http://10.13.114.28:8000/'; // dispositivo físico
  //const baseUrl = 'http://ec2-18-222-5-143.us-east-2.compute.amazonaws.com:8000/';

  // aqui esta el general
  final baseUrl = AppConstants.baseUrl;

  Get.put(AuthController(baseUrl: baseUrl), permanent: true);
  await PushNotificationsService.instance.initialize();
  Get.put(ModelController()); // ⬅️ AÑADIR ESTO OBLIGATORIO
  runApp(const App());
}

class App extends StatelessWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context) {
    final themeController = Get.find<ThemeController>();
    return GetMaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'plasma_mobile',
      theme: AppThemes.light,
      darkTheme: AppThemes.dark,
      themeMode: themeController.theme,
      initialRoute: AppRoutes.splash,
      getPages: AppRoutes.pages,
      defaultTransition: Transition.fade,
    );
  }
}
