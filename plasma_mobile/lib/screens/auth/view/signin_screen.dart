import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../config/app_colors.dart';
import '../../../routes/routes.dart';
import '../../auth/models/user_model.dart';
import '../../auth/service/auth_controller.dart';
import '../../widgets/input/custom_textfield.dart';
import '../../widgets/ui/app_ui.dart';

class SigninScreen extends StatefulWidget {
  const SigninScreen({super.key});

  @override
  State<SigninScreen> createState() => _SigninScreenState();
}

class _SigninScreenState extends State<SigninScreen> {
  final _auth = Get.find<AuthController>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  void _submit() {
    final email = _emailController.text.trim();
    final password = _passwordController.text;

    if (email.isEmpty || !GetUtils.isEmail(email)) {
      _error('Ingresa un correo electrónico válido.');
      return;
    }
    if (password.isEmpty) {
      _error('Ingresa tu contraseña.');
      return;
    }

    _auth.login(UserModel(nombre: '', email: email, password: password));
  }

  void _error(String message) {
    Get.snackbar(
      'Revisa tus datos',
      message,
      snackPosition: SnackPosition.BOTTOM,
      margin: const EdgeInsets.all(16),
      borderRadius: 12,
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Column(
                children: [
                  const AppLogo(size: 52),
                  const SizedBox(height: 24),
                  AppCard(
                    padding: const EdgeInsets.all(22),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          'Iniciar sesión',
                          style: theme.textTheme.headlineSmall?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Bienvenido de nuevo. Continúa donde lo dejaste.',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: AppColors.muted,
                          ),
                        ),
                        const SizedBox(height: 22),
                        CustomTextfield(
                          label: 'Correo electrónico',
                          hint: 'tu@correo.com',
                          prefixIcon: Icons.email_outlined,
                          keyboardType: TextInputType.emailAddress,
                          controller: _emailController,
                        ),
                        const SizedBox(height: 14),
                        CustomTextfield(
                          label: 'Contraseña',
                          prefixIcon: Icons.lock_outline_rounded,
                          isPassword: true,
                          controller: _passwordController,
                        ),
                        Align(
                          alignment: Alignment.centerRight,
                          child: TextButton(
                            onPressed: () => Get.toNamed(AppRoutes.forgot),
                            child: const Text('¿Olvidaste tu contraseña?'),
                          ),
                        ),
                        Obx(
                          () => AppButton(
                            label: 'Entrar',
                            icon: Icons.login_rounded,
                            loading: _auth.isLoading.value,
                            onPressed: _submit,
                          ),
                        ),
                        const SizedBox(height: 16),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              '¿No tienes cuenta?',
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: AppColors.muted,
                              ),
                            ),
                            TextButton(
                              onPressed: () => Get.toNamed(AppRoutes.signup),
                              child: const Text('Regístrate'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
