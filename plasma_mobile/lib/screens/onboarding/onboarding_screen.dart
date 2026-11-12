import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../config/app_colors.dart';
import '../auth/service/auth_controller.dart';
import '../../routes/routes.dart';
import '../widgets/ui/app_ui.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _pageController = PageController();
  int _currentPage = 0;

  static const _items = <_OnboardingItem>[
    _OnboardingItem(
      title: 'Modelos 3D automáticos',
      description:
          'Genera modelos estructurales en 3D a partir de planos arquitectónicos.',
      icon: Icons.auto_awesome_rounded,
    ),
    _OnboardingItem(
      title: 'Predicción de riesgos',
      description:
          'Detecta riesgos potenciales en diseño y construcción usando IA.',
      icon: Icons.health_and_safety_rounded,
    ),
    _OnboardingItem(
      title: 'Diseño interno asistido',
      description:
          'Optimiza el diseño interno con asistencia de IA para mayor seguridad.',
      icon: Icons.chair_rounded,
    ),
  ];

  void _finish() {
    Get.find<AuthController>().setFirstTimeDone();
    Get.offAllNamed(AppRoutes.signin);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: _finish,
                child: const Text('Omitir'),
              ),
            ),
            Expanded(
              child: PageView.builder(
                controller: _pageController,
                itemCount: _items.length,
                onPageChanged: (i) => setState(() => _currentPage = i),
                itemBuilder: (_, i) {
                  final item = _items[i];
                  return Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 28),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        AppCard(
                          padding: const EdgeInsets.all(36),
                          gradient: AppColors.heroGradient,
                          child: Icon(
                            item.icon,
                            size: 72,
                            color: AppColors.accent,
                          ),
                        ),
                        const SizedBox(height: 34),
                        Text(
                          item.title,
                          textAlign: TextAlign.center,
                          style: theme.textTheme.headlineSmall?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 12),
                        Text(
                          item.description,
                          textAlign: TextAlign.center,
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: AppColors.muted,
                            height: 1.5,
                          ),
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(_items.length, (i) {
                final active = i == _currentPage;
                return AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  margin: const EdgeInsets.symmetric(horizontal: 4),
                  width: active ? 22 : 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: active ? AppColors.primary : AppColors.borderStrong,
                    borderRadius: BorderRadius.circular(999),
                  ),
                );
              }),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 24, 24, 24),
              child: AppButton(
                label: _currentPage < _items.length - 1
                    ? 'Siguiente'
                    : 'Comenzar',
                icon: _currentPage < _items.length - 1
                    ? Icons.arrow_forward_rounded
                    : Icons.check_rounded,
                onPressed: () {
                  if (_currentPage < _items.length - 1) {
                    _pageController.nextPage(
                      duration: const Duration(milliseconds: 280),
                      curve: Curves.easeInOut,
                    );
                  } else {
                    _finish();
                  }
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OnboardingItem {
  const _OnboardingItem({
    required this.title,
    required this.description,
    required this.icon,
  });

  final String title;
  final String description;
  final IconData icon;
}
