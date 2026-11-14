import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../api/api_client.dart';
import '../../../../config/app_colors.dart';
import '../../../../const/app_constants.dart';
import '../../../auth/service/auth_controller.dart';
import '../../../widgets/ui/app_ui.dart';

/// El pago con Stripe se hace en la web (CU22). Esta pantalla abre la página
/// de pagos y, al volver a la app, refresca el plan del usuario.
class PlanPremiumScreen extends StatefulWidget {
  const PlanPremiumScreen({super.key});

  @override
  State<PlanPremiumScreen> createState() => _PlanPremiumScreenState();
}

class _PlanPremiumScreenState extends State<PlanPremiumScreen>
    with WidgetsBindingObserver {
  final _auth = Get.find<AuthController>();
  bool _loading = false;
  bool _waitingPayment = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _waitingPayment) {
      _waitingPayment = false;
      _refreshUser();
    }
  }

  void _snack(String title, String message, {bool success = false}) {
    Get.snackbar(
      title,
      message,
      snackPosition: SnackPosition.BOTTOM,
      backgroundColor:
          (success ? AppColors.success : AppColors.danger).withValues(alpha: 0.95),
      colorText: Colors.white,
      margin: const EdgeInsets.all(16),
      borderRadius: 12,
    );
  }

  Future<void> _upgrade() async {
    final ok = await launchUrl(
      Uri.parse(AppConstants.webPaymentUrl),
      mode: LaunchMode.externalApplication,
    );
    if (!ok) {
      _snack('No se pudo abrir', 'Abre ${AppConstants.webPaymentUrl} en tu navegador.');
      return;
    }
    _waitingPayment = true;
  }

  Future<void> _refreshUser() async {
    final id = _auth.currentUser.value?.id;
    if (id == null) return;
    setState(() => _loading = true);
    try {
      final data = await ApiClient.get('api/users/usuarios/$id/');
      if (data is Map) {
        _auth.applyUser(Map<String, dynamic>.from(data));
        if (data['rol'] == 'usuario_premium') {
          _snack('¡Bienvenido a Premium!', 'Tu plan está activo.', success: true);
        }
      }
    } catch (e) {
      _snack(
        'No se pudo actualizar',
        e is ApiException ? e.message : 'Inténtalo de nuevo.',
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
                  '\$40',
                  style: theme.textTheme.headlineMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                    color: AppColors.primary,
                  ),
                ),
                const SizedBox(width: 4),
                const Text('/ 30 días', style: TextStyle(color: AppColors.muted)),
                const Spacer(),
                const AppBadge(label: 'Pago seguro con Stripe'),
              ],
            ),
          ),
          const SizedBox(height: 20),
          AppButton(
            label: 'Pagar en la web',
            icon: Icons.workspace_premium_rounded,
            loading: _loading,
            onPressed: _upgrade,
          ),
          const SizedBox(height: 10),
          const Text(
            'El pago se completa en la plataforma web con tu misma cuenta. '
            'Al volver a la app se actualizará tu plan.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppColors.muted, fontSize: 12),
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
