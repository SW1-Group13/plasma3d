import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../../api/api_client.dart';
import '../../../../config/app_colors.dart';
import '../../../auth/service/auth_controller.dart';
import '../../../widgets/ui/app_ui.dart';

class PlanPremiumScreen extends StatefulWidget {
  const PlanPremiumScreen({super.key});

  @override
  State<PlanPremiumScreen> createState() => _PlanPremiumScreenState();
}

class _PlanPremiumScreenState extends State<PlanPremiumScreen> {
  final _auth = Get.find<AuthController>();
  bool _loading = false;

  Future<void> _upgrade() async {
    setState(() => _loading = true);
    try {
      final data = await ApiClient.postJson(
        'api/users/payment/process/',
        {'plan': 'usuario_premium', 'monto': 12},
      );
      if (data is Map && data['usuario'] is Map) {
        _auth.applyUser(Map<String, dynamic>.from(data['usuario'] as Map));
      }
      Get.snackbar(
        '¡Bienvenido a Premium!',
        'Tu plan se actualizó correctamente.',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: AppColors.success.withValues(alpha: 0.95),
        colorText: Colors.white,
        margin: const EdgeInsets.all(16),
        borderRadius: 12,
      );
      Get.back();
    } catch (e) {
      Get.snackbar(
        'No se pudo actualizar',
        e is ApiException ? e.message : 'Inténtalo de nuevo.',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: AppColors.danger.withValues(alpha: 0.95),
        colorText: Colors.white,
        margin: const EdgeInsets.all(16),
        borderRadius: 12,
      );
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Plan Premium')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          AppCard(
            gradient: AppColors.heroGradient,
            padding: const EdgeInsets.all(22),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const AppBadge(label: 'PREMIUM', color: AppColors.success),
                const SizedBox(height: 14),
                Text(
                  'Desbloquea todo el potencial de Plasma3D',
                  style: theme.textTheme.headlineSmall?.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'Modelos ilimitados, render HD y herramientas avanzadas.',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: Colors.white.withValues(alpha: 0.78),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          AppCard(
            child: Column(
              children: const [
                _Benefit(text: 'Modelos ilimitados'),
                _Benefit(text: 'Render en alta definición'),
                _Benefit(text: 'Análisis de riesgo con IA'),
                _Benefit(text: 'Soporte prioritario'),
              ],
            ),
          ),
          const SizedBox(height: 18),
          AppCard(
            child: Row(
              children: [
                Text(
                  '\$12',
                  style: theme.textTheme.headlineMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                    color: AppColors.primary,
                  ),
                ),
                const SizedBox(width: 4),
                const Text('/ mes', style: TextStyle(color: AppColors.muted)),
                const Spacer(),
                const AppBadge(label: 'Cancela cuando quieras'),
              ],
            ),
          ),
          const SizedBox(height: 20),
          AppButton(
            label: 'Actualizar a Premium',
            icon: Icons.workspace_premium_rounded,
            loading: _loading,
            onPressed: _upgrade,
          ),
        ],
      ),
    );
  }
}

class _Benefit extends StatelessWidget {
  const _Benefit({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 9),
      child: Row(
        children: [
          const Icon(Icons.check_circle_rounded, color: AppColors.success, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
            ),
          ),
        ],
      ),
    );
  }
}
