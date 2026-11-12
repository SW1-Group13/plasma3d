import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../config/app_colors.dart';
import '../../auth/service/auth_controller.dart';
import '../../widgets/input/custom_textfield.dart';
import '../../widgets/ui/app_ui.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = Get.find<AuthController>();

    return Scaffold(
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
        children: [
          Text(
            'Mi perfil',
            style: Theme.of(context)
                .textTheme
                .headlineSmall
                ?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 14),
          Obx(() {
            final user = auth.currentUser.value;
            return AppCard(
              gradient: AppColors.heroGradient,
              padding: const EdgeInsets.all(20),
              child: Row(
                children: [
                  AppAvatar(
                    name: user?.nombre ?? 'Usuario',
                    imageUrl: user?.avatarUrl,
                    size: 58,
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          user?.nombre ?? 'Invitado',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context)
                              .textTheme
                              .titleMedium
                              ?.copyWith(
                                color: Colors.white,
                                fontWeight: FontWeight.w700,
                              ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          user?.email ?? '',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.75),
                            fontSize: 12,
                          ),
                        ),
                        const SizedBox(height: 8),
                        AppBadge(
                          label: (user?.isPremium ?? false)
                              ? 'PREMIUM'
                              : 'PLAN FREE',
                          color: (user?.isPremium ?? false)
                              ? AppColors.success
                              : AppColors.accent,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            );
          }),
          const SizedBox(height: 20),
          const AppSectionTitle(title: 'Datos de la cuenta'),
          const SizedBox(height: 10),
          Obx(() {
            final user = auth.currentUser.value;
            return AppCard(
              child: Column(
                children: [
                  _InfoRow(
                    icon: Icons.badge_outlined,
                    label: 'Nombre',
                    value: user?.nombre ?? '—',
                  ),
                  _InfoRow(
                    icon: Icons.email_outlined,
                    label: 'Correo',
                    value: user?.email ?? '—',
                  ),
                  _InfoRow(
                    icon: Icons.phone_outlined,
                    label: 'Teléfono',
                    value: user?.telefono?.toString() ?? '—',
                  ),
                  _InfoRow(
                    icon: Icons.workspace_premium_outlined,
                    label: 'Plan',
                    value: (user?.isPremium ?? false) ? 'Premium' : 'Free',
                  ),
                  _InfoRow(
                    icon: Icons.calendar_today_outlined,
                    label: 'Registro',
                    value: (user?.fechaRegistro ?? '').isEmpty
                        ? '—'
                        : user!.fechaRegistro!.split('T').first,
                  ),
                  _InfoRow(
                    icon: Icons.event_available_outlined,
                    label: 'Expira',
                    value: (user?.fechaExpiracionPlan ?? '').isEmpty
                        ? '—'
                        : user!.fechaExpiracionPlan!,
                    showDivider: false,
                  ),
                ],
              ),
            );
          }),
          const SizedBox(height: 20),
          Row(
            children: [
              Expanded(
                child: AppButton(
                  label: 'Editar perfil',
                  icon: Icons.edit_outlined,
                  variant: AppButtonVariant.secondary,
                  onPressed: () => _editProfile(context, auth),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: AppButton(
                  label: 'Salir',
                  icon: Icons.logout_rounded,
                  variant: AppButtonVariant.danger,
                  onPressed: () => auth.logout(),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _editProfile(BuildContext context, AuthController auth) {
    final user = auth.currentUser.value;
    final nameCtrl = TextEditingController(text: user?.nombre ?? '');
    final passCtrl = TextEditingController();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) {
        return Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 20,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
          ),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const AppSectionTitle(
                  title: 'Editar perfil',
                  subtitle: 'Actualiza tu nombre o contraseña.',
                ),
                const SizedBox(height: 18),
                CustomTextfield(
                  label: 'Nombre',
                  prefixIcon: Icons.person_outline_rounded,
                  controller: nameCtrl,
                ),
                const SizedBox(height: 14),
                CustomTextfield(
                  label: 'Nueva contraseña',
                  prefixIcon: Icons.lock_outline_rounded,
                  isPassword: true,
                  controller: passCtrl,
                ),
                const SizedBox(height: 20),
                AppButton(
                  label: 'Guardar cambios',
                  icon: Icons.save_outlined,
                  onPressed: () async {
                    final ok = await auth.updateProfile(
                      nombre: nameCtrl.text.trim(),
                      password: passCtrl.text,
                    );
                    if (ok && ctx.mounted) Navigator.pop(ctx);
                  },
                ),
                const SizedBox(height: 8),
                TextButton(
                  onPressed: () => Navigator.pop(ctx),
                  child: const Text('Cancelar'),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.icon,
    required this.label,
    required this.value,
    this.showDivider = true,
  });

  final IconData icon;
  final String label;
  final String value;
  final bool showDivider;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Row(
            children: [
              Icon(icon, size: 18, color: AppColors.muted),
              const SizedBox(width: 12),
              Text(
                label,
                style: const TextStyle(fontSize: 13, color: AppColors.muted),
              ),
              const Spacer(),
              Flexible(
                child: Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.right,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          ),
        ),
        if (showDivider)
          Divider(
            height: 1,
            color: isDark ? AppColors.border : const Color(0xFFE2E8F0),
          ),
      ],
    );
  }
}
