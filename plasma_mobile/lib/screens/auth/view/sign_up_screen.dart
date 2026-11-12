import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../config/app_colors.dart';
import '../../../routes/routes.dart';
import '../../auth/models/user_model.dart';
import '../../auth/service/auth_controller.dart';
import '../../widgets/input/custom_textfield.dart';
import '../../widgets/ui/app_ui.dart';

class SignUpScreen extends StatefulWidget {
  const SignUpScreen({super.key});

  @override
  State<SignUpScreen> createState() => _SignUpScreenState();
}

class _SignUpScreenState extends State<SignUpScreen> {
  final _auth = Get.find<AuthController>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  void _submit() {
    final name = _nameController.text.trim();
    final email = _emailController.text.trim();
    final password = _passwordController.text;
    final confirm = _confirmPasswordController.text;

    if (name.isEmpty) {
      _error('Ingresa tu nombre.');
      return;
    }
    if (email.isEmpty || !GetUtils.isEmail(email)) {
      _error('Ingresa un correo electrónico válido.');
      return;
    }
    if (password.length < 6) {
      _error('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (password != confirm) {
      _error('Las contraseñas no coinciden.');
      return;
    }

    _auth.register(
      UserModel(
        nombre: name,
        email: email,
        password: password,
      ),
    );
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
                  Align(
                    alignment: Alignment.centerLeft,
                    child: AppIconButton(
                      icon: Icons.arrow_back_rounded,
                      tooltip: 'Volver',
                      onPressed: () => Get.back(),
                    ),
                  ),
                  const SizedBox(height: 16),
                  const AppLogo(size: 52),
                  const SizedBox(height: 24),
                  AppCard(
                    padding: const EdgeInsets.all(22),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          'Crear cuenta',
                          style: theme.textTheme.headlineSmall?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Empieza a modelar tus planos en 3D.',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: AppColors.muted,
                          ),
                        ),
                        const SizedBox(height: 22),
                        CustomTextfield(
                          label: 'Nombre completo',
                          prefixIcon: Icons.person_outline_rounded,
                          keyboardType: TextInputType.name,
                          controller: _nameController,
                        ),
                        const SizedBox(height: 14),
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
                        const SizedBox(height: 14),
                        CustomTextfield(
                          label: 'Confirmar contraseña',
                          prefixIcon: Icons.lock_reset_rounded,
                          isPassword: true,
                          controller: _confirmPasswordController,
                        ),
                        const SizedBox(height: 20),
                        Obx(
                          () => AppButton(
                            label: 'Registrarme',
                            icon: Icons.person_add_alt_1_rounded,
                            loading: _auth.isLoading.value,
                            onPressed: _submit,
                          ),
                        ),
                        const SizedBox(height: 16),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              '¿Ya tienes cuenta?',
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: AppColors.muted,
                              ),
                            ),
                            TextButton(
                              onPressed: () => Get.offNamed(AppRoutes.signin),
                              child: const Text('Inicia sesión'),
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
