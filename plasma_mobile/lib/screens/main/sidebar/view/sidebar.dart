import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../../config/app_colors.dart';
import '../../../auth/service/auth_controller.dart';
import '../../../widgets/ui/app_ui.dart';

class Sidebar extends StatelessWidget {
  const Sidebar({
    super.key,
    required this.selectedIndex,
    required this.onItemSelected,
    required this.onLogout,
  });

  final int selectedIndex;
  final Function(int) onItemSelected;
  final VoidCallback onLogout;

  static const _items = <_SidebarData>[
    _SidebarData(Icons.space_dashboard_rounded, 'Inicio'),
    _SidebarData(Icons.view_in_ar_rounded, 'Visualizador 3D'),
    _SidebarData(Icons.person_rounded, 'Mi perfil'),
    _SidebarData(Icons.auto_awesome_rounded, 'IA Diseño'),
    _SidebarData(Icons.settings_rounded, 'Configuración'),
  ];

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final auth = Get.find<AuthController>();

    return Container(
      width: 264,
      margin: const EdgeInsets.all(12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isDark ? AppColors.surface : Colors.white,
        borderRadius: BorderRadius.circular(AppColors.radius),
        border: Border.all(
          color: isDark ? AppColors.border : const Color(0xFFE2E8F0),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 4),
            child: AppLogo(size: 36),
          ),
          const SizedBox(height: 20),
          Obx(() {
            final user = auth.currentUser.value;
            return AppCard(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  AppAvatar(
                    name: user?.nombre ?? 'Usuario',
                    imageUrl: user?.avatarUrl,
                    size: 40,
                  ),
                  const SizedBox(width: 10),
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
                              .bodyMedium
                              ?.copyWith(fontWeight: FontWeight.w600),
                        ),
                        Text(
                          user?.email ?? '',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 11,
                            color: AppColors.muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            );
          }),
          const SizedBox(height: 16),
          Expanded(
            child: ListView.separated(
              padding: EdgeInsets.zero,
              itemCount: _items.length,
              separatorBuilder: (_, _) => const SizedBox(height: 6),
              itemBuilder: (context, i) => _SidebarTile(
                data: _items[i],
                active: i == selectedIndex,
                onTap: () => onItemSelected(i),
              ),
            ),
          ),
          const SizedBox(height: 8),
          _SidebarTile(
            data: const _SidebarData(
              Icons.logout_rounded,
              'Cerrar sesión',
              danger: true,
            ),
            active: false,
            onTap: onLogout,
          ),
        ],
      ),
    );
  }
}

class _SidebarData {
  const _SidebarData(this.icon, this.label, {this.danger = false});
  final IconData icon;
  final String label;
  final bool danger;
}

class _SidebarTile extends StatelessWidget {
  const _SidebarTile({
    required this.data,
    required this.active,
    required this.onTap,
  });

  final _SidebarData data;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final color = data.danger
        ? AppColors.danger
        : active
            ? AppColors.primary
            : (isDark ? AppColors.muted : const Color(0xFF475569));

    return InkWell(
      borderRadius: BorderRadius.circular(AppColors.radiusSmall),
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
        decoration: BoxDecoration(
          color: active
              ? AppColors.primary.withValues(alpha: 0.14)
              : Colors.transparent,
          borderRadius: BorderRadius.circular(AppColors.radiusSmall),
        ),
        child: Row(
          children: [
            Icon(data.icon, size: 20, color: color),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                data.label,
                style: TextStyle(
                  color: color,
                  fontWeight: active ? FontWeight.w600 : FontWeight.w500,
                  fontSize: 14,
                ),
              ),
            ),
            if (active)
              const Icon(
                Icons.chevron_right_rounded,
                size: 18,
                color: AppColors.primary,
              ),
          ],
        ),
      ),
    );
  }
}
