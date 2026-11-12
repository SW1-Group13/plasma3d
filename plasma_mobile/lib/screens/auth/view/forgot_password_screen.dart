import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../config/app_colors.dart';
import '../../../routes/routes.dart';
import '../../main/sidebar/widget/soporte_ayuda.dart';
import '../../widgets/ui/app_ui.dart';

/// Recuperación de acceso. No hay endpoint de reset en el backend, así que se
/// dirige al usuario a soporte para validar su identidad.
class ForgotPasswordScreen extends StatelessWidget {
  const ForgotPasswordScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Recuperar acceso')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AppCard(
              gradient: AppColors.heroGradient,
              padding: const EdgeInsets.all(22),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(
                    Icons.lock_reset_rounded,
                    color: AppColors.accent,
                    size: 34,
                  ),
                  const SizedBox(height: 14),
                  Text(
                    'Restablece tu contraseña',
                    style: theme.textTheme.titleLarge?.copyWith(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Por seguridad, el restablecimiento se gestiona con '
                    'nuestro equipo de soporte.',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: Colors.white.withValues(alpha: 0.78),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            AppButton(
              label: 'Contactar soporte',
              icon: Icons.support_agent_rounded,
              onPressed: () => Get.to(() => const HelpSupportScreen()),
            ),
            const SizedBox(height: 10),
            AppButton(
              label: 'Volver a iniciar sesión',
              icon: Icons.arrow_back_rounded,
              variant: AppButtonVariant.secondary,
              onPressed: () => Get.offAllNamed(AppRoutes.signin),
            ),
          ],
        ),
      ),
    );
  }
}
