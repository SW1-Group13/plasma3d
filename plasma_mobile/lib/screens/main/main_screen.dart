import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../config/app_colors.dart';
import '../../config/theme_controller.dart';
import '../../routes/routes.dart';
import '../auth/service/auth_controller.dart';
import '../dasboard/view/dashboard_screen.dart';
import '../main/perfil/profile_screen.dart';
import '../main/planVisualizador/visualizador3d_page.dart';
import '../main/sidebar/view/sidebar.dart';
import '../main/sidebar/widget/config_options_card.dart';
import '../main/sidebar/widget/diseno_ia.dart';
import '../widgets/navegacion/pill_bottom_nav.dart';
import '../widgets/ui/app_ui.dart';

class MainScreen extends StatefulWidget {
  const MainScreen({super.key});

  @override
  State<MainScreen> createState() => _MainScreenState();
}

class _MainScreenState extends State<MainScreen> {
  final _auth = Get.find<AuthController>();
  final _theme = Get.find<ThemeController>();

  int _selectedIndex = 0;

  static const _pages = <Widget>[
    DashboardScreen(),
    Visualizador3dPage(),
    ProfileScreen(),
    IADisenoScreen(),
    ConfigOptionsCard(),
  ];

  void _onItemSelected(int index) => setState(() => _selectedIndex = index);

  void _logout() {
    _auth.logout();
    Get.offAllNamed(AppRoutes.signin);
  }

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.of(context).size.width;
    final isDesktop = width >= 900;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    final body = IndexedStack(index: _selectedIndex, children: _pages);

    if (isDesktop) {
      return Scaffold(
        body: Row(
          children: [
            Sidebar(
              selectedIndex: _selectedIndex,
              onItemSelected: _onItemSelected,
              onLogout: _logout,
            ),
            Expanded(child: body),
          ],
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        backgroundColor: isDark ? AppColors.canvas : Colors.white,
        title: const AppLogo(size: 30),
        actions: [
          IconButton(
            tooltip: 'Cambiar tema',
            onPressed: _theme.toggleTheme,
            icon: Icon(
              isDark ? Icons.light_mode_rounded : Icons.dark_mode_rounded,
            ),
          ),
          IconButton(
            tooltip: 'Cerrar sesión',
            onPressed: _logout,
            icon: const Icon(Icons.logout_rounded),
            color: AppColors.danger,
          ),
          const SizedBox(width: 6),
        ],
      ),
      body: body,
      bottomNavigationBar: PillBottomNav(
        index: _selectedIndex,
        onTap: _onItemSelected,
      ),
    );
  }
}
