import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../../config/app_colors.dart';
import '../../../../config/theme_controller.dart';
import 'plan_premiun.dart';
import 'soporte_ayuda.dart';
import '../../../widgets/ui/app_ui.dart';

class ConfigOptionsCard extends StatelessWidget {
  const ConfigOptionsCard({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
        children: [
          Text(
            'Configuración',
            style: theme.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 14),
          const AppSectionTitle(title: 'Apariencia'),
          const SizedBox(height: 10),
          GetBuilder<ThemeController>(
            builder: (themeCtrl) => AppCard(
              padding: EdgeInsets.zero,
              child: SwitchListTile(
                value: themeCtrl.isDarkMode,
                onChanged: (_) => themeCtrl.toggleTheme(),
                secondary: const Icon(Icons.dark_mode_outlined),
                title: const Text('Modo oscuro'),
                subtitle: const Text('Cambia entre tema claro y oscuro'),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppColors.radius),
                ),
              ),
            ),
          ),
          const SizedBox(height: 20),
          const AppSectionTitle(title: 'Cuenta y soporte'),
          const SizedBox(height: 10),
          AppCard(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                _OptionTile(
                  icon: Icons.workspace_premium_rounded,
                  label: 'Plan Premium',
                  subtitle: 'Modelos ilimitados y render HD',
                  onTap: () => Get.to(() => const PlanPremiumScreen()),
                ),
                Divider(
                  height: 1,
                  color: theme.brightness == Brightness.dark
                      ? AppColors.border
                      : const Color(0xFFE2E8F0),
                ),
                _OptionTile(
                  icon: Icons.help_outline_rounded,
                  label: 'Ayuda y soporte',
                  subtitle: 'Preguntas frecuentes y contacto',
                  onTap: () => Get.to(() => const HelpSupportScreen()),
                ),
              ],
            ),
          ),
          const SizedBox(height: 28),
          Center(
            child: Text(
              'Plasma3D Mobile · v1.0.0',
              style: theme.textTheme.bodySmall?.copyWith(
                color: AppColors.muted,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _OptionTile extends StatelessWidget {
  const _OptionTile({
    required this.icon,
    required this.label,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      onTap: onTap,
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: AppColors.primary.withValues(alpha: 0.14),
          borderRadius: BorderRadius.circular(AppColors.radiusSmall),
        ),
        child: Icon(icon, color: AppColors.primary, size: 20),
      ),
      title: Text(
        label,
        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
      ),
      subtitle: Text(
        subtitle,
        style: const TextStyle(fontSize: 12, color: AppColors.muted),
      ),
      trailing: const Icon(Icons.chevron_right_rounded, color: AppColors.muted),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppColors.radius),
      ),
    );
  }
}
