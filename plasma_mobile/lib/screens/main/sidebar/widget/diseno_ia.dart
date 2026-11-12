import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:get/get.dart';
import 'package:image_picker/image_picker.dart';
import 'package:model_viewer_plus/model_viewer_plus.dart';

import '../../../../api/api_client.dart';
import '../../../../api/models_service.dart';
import '../../../../config/app_colors.dart';
import '../../../auth/controller/model_controller.dart';
import '../../../auth/service/auth_controller.dart';
import '../../../widgets/ui/app_ui.dart';

/// Pantalla para generar un modelo 3D a partir de una foto del plano.
class IADisenoScreen extends StatefulWidget {
  const IADisenoScreen({super.key});

  @override
  State<IADisenoScreen> createState() => _IADisenoScreenState();
}

class _IADisenoScreenState extends State<IADisenoScreen> {
  final _picker = ImagePicker();
  final _auth = Get.find<AuthController>();

  File? _image;
  ModelJob? _generated;
  bool _loading = false;

  void _snack(String message, {bool success = false}) {
    Get.snackbar(
      success ? 'Listo' : 'Ups',
      message,
      snackPosition: SnackPosition.BOTTOM,
      backgroundColor:
          (success ? AppColors.success : AppColors.danger).withValues(alpha: 0.95),
      colorText: Colors.white,
      margin: const EdgeInsets.all(16),
      borderRadius: 12,
    );
  }

  Future<void> _pick(ImageSource source) async {
    final picked = await _picker.pickImage(source: source, imageQuality: 90);
    if (picked == null) return;
    setState(() => _image = File(picked.path));
  }

  Future<void> _generate() async {
    if (_image == null) {
      _snack('Primero selecciona o toma una foto del plano.');
      return;
    }
    final user = _auth.currentUser.value;
    if (user?.id == null) {
      _snack('Inicia sesión para generar un modelo.');
      return;
    }

    setState(() {
      _loading = true;
      _generated = null;
    });

    try {
      final job = await ModelsService.uploadPlan(
        _image!,
        usuario: user!.id!,
      );
      if (!mounted) return;
      setState(() => _generated = job);
      Get.find<ModelController>().notifyRefresh();
      _snack('Modelo 3D generado correctamente.', success: true);
    } catch (e) {
      _snack(e is ApiException ? e.message : 'No se pudo generar el modelo.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _copy(String value) async {
    await Clipboard.setData(ClipboardData(text: value));
    if (!mounted) return;
    _snack('Enlace copiado al portapapeles.', success: true);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final glbUrl = _generated?.glbUrl ?? '';

    return Scaffold(
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          Text(
            'IA Diseño',
            style: theme.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 14),
          AppCard(
            gradient: AppColors.heroGradient,
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const AppBadge(label: 'GENERACIÓN CON IA', color: AppColors.accent),
                const SizedBox(height: 14),
                Text(
                  'Convierte tu plano en 3D',
                  style: theme.textTheme.headlineSmall?.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'Toma una foto nítida del plano. La IA detectará muros, '
                  'puertas y ventanas y generará el modelo automáticamente.',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: Colors.white.withValues(alpha: 0.78),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          AppSectionTitle(title: 'Plano de entrada'),
          const SizedBox(height: 10),
          AppCard(
            padding: EdgeInsets.zero,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(AppColors.radius),
              child: SizedBox(
                height: 230,
                width: double.infinity,
                child: _image == null
                    ? Container(
                        color: AppColors.surface2,
                        child: const Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.image_outlined,
                              size: 42,
                              color: AppColors.muted,
                            ),
                            SizedBox(height: 8),
                            Text(
                              'Sin imagen seleccionada',
                              style: TextStyle(color: AppColors.muted),
                            ),
                          ],
                        ),
                      )
                    : Image.file(_image!, fit: BoxFit.cover),
              ),
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _loading
                      ? null
                      : () => _pick(ImageSource.gallery),
                  icon: const Icon(Icons.photo_library_outlined, size: 18),
                  label: const Text('Galería'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _loading ? null : () => _pick(ImageSource.camera),
                  icon: const Icon(Icons.camera_alt_outlined, size: 18),
                  label: const Text('Cámara'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          AppButton(
            label: _loading ? 'Generando modelo...' : 'Generar modelo 3D',
            icon: Icons.auto_awesome_rounded,
            loading: _loading,
            onPressed: _generate,
          ),
          if (glbUrl.isNotEmpty) ...[
            const SizedBox(height: 24),
            AppSectionTitle(
              title: 'Modelo generado',
              subtitle: 'ID #${_generated!.id}',
              trailing: AppIconButton(
                icon: Icons.copy_rounded,
                tooltip: 'Copiar enlace',
                onPressed: () => _copy(glbUrl),
              ),
            ),
            const SizedBox(height: 10),
            AppCard(
              padding: EdgeInsets.zero,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(AppColors.radius),
                child: SizedBox(
                  height: 360,
                  child: ModelViewer(
                    src: glbUrl,
                    alt: 'Modelo generado',
                    ar: true,
                    autoRotate: true,
                    cameraControls: true,
                    backgroundColor: AppColors.surface2,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 10),
            AppButton(
              label: 'Ver en pantalla completa',
              icon: Icons.open_in_full_rounded,
              variant: AppButtonVariant.secondary,
              onPressed: () => Get.to(
                () => _FullScreenModelPage(modelUrl: glbUrl),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _FullScreenModelPage extends StatelessWidget {
  const _FullScreenModelPage({required this.modelUrl});

  final String modelUrl;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Visor 3D')),
      body: ModelViewer(
        src: modelUrl,
        alt: 'Modelo 3D fullscreen',
        ar: true,
        autoRotate: true,
        cameraControls: true,
      ),
    );
  }
}
