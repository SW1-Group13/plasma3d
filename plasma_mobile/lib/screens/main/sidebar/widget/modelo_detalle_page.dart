import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:get/get.dart';
import 'package:model_viewer_plus/model_viewer_plus.dart';

import '../../../../api/api_client.dart';
import '../../../../api/models_service.dart';
import '../../../../config/app_colors.dart';
import '../../../widgets/ui/app_ui.dart';

class ModeloDetallePage extends StatefulWidget {
  const ModeloDetallePage({super.key, required this.modelo});

  final Map<String, dynamic> modelo;

  @override
  State<ModeloDetallePage> createState() => _ModeloDetallePageState();
}

class _ModeloDetallePageState extends State<ModeloDetallePage> {
  bool _deleting = false;

  late final ModelJob _model = ModelJob.fromJson(widget.modelo);

  Future<void> _copy(String value) async {
    await Clipboard.setData(ClipboardData(text: value));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Enlace copiado al portapapeles')),
    );
  }

  Future<void> _delete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Eliminar proyecto'),
        content: Text(
          '¿Eliminar el modelo #${_model.id}? Esta acción no se puede deshacer.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Eliminar'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    setState(() => _deleting = true);
    try {
      await ModelsService.delete(_model.id);
      if (!mounted) return;
      Get.back(result: true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _deleting = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e is ApiException ? e.message : 'No se pudo eliminar el proyecto',
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final glbUrl = _model.glbUrl;
    final planUrl = _model.planImageUrl;

    return Scaffold(
      appBar: AppBar(
        title: Text('Modelo #${_model.id}'),
        actions: [
          IconButton(
            tooltip: 'Eliminar',
            onPressed: _deleting ? null : _delete,
            icon: _deleting
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.delete_outline_rounded),
            color: AppColors.danger,
          ),
          const SizedBox(width: 6),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          AppCard(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                AppBadge(
                  label: _model.hasModel ? 'MODELO 3D' : 'VACÍO',
                  color: _model.hasModel
                      ? AppColors.success
                      : AppColors.warning,
                ),
                const Spacer(),
                Text(
                  _model.createdLabel.isEmpty ? 'Sin fecha' : _model.createdLabel,
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          AppSectionTitle(
            title: 'Vista 3D',
            subtitle: 'Arrastra para rotar, pellizca para acercar',
          ),
          const SizedBox(height: 10),
          AppCard(
            padding: EdgeInsets.zero,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(AppColors.radius),
              child: SizedBox(
                height: 360,
                child: glbUrl.isEmpty
                    ? const AppEmptyState(
                        icon: Icons.view_in_ar_rounded,
                        title: 'Este modelo no tiene GLB',
                        message: 'Se creó vacío para dibujar en el editor web.',
                      )
                    : ModelViewer(
                        src: glbUrl,
                        alt: 'Modelo 3D generado',
                        ar: true,
                        autoRotate: true,
                        cameraControls: true,
                        backgroundColor: AppColors.surface2,
                      ),
              ),
            ),
          ),
          const SizedBox(height: 18),
          AppSectionTitle(title: 'Detalles'),
          const SizedBox(height: 10),
          AppCard(
            child: Column(
              children: [
                _InfoRow(label: 'ID', value: '${_model.id}'),
                _InfoRow(
                  label: 'Dimensiones',
                  value: '${_model.width} × ${_model.height} px',
                ),
                _InfoRow(label: 'Usuario', value: '${_model.usuario ?? '—'}'),
                _InfoRow(label: 'Creado', value: _model.createdLabel),
              ],
            ),
          ),
          if (glbUrl.isNotEmpty) ...[
            const SizedBox(height: 18),
            AppSectionTitle(title: 'Enlace del modelo'),
            const SizedBox(height: 10),
            AppCard(
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      glbUrl,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: AppColors.muted,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  AppIconButton(
                    icon: Icons.copy_rounded,
                    tooltip: 'Copiar',
                    onPressed: () => _copy(glbUrl),
                  ),
                ],
              ),
            ),
          ],
          if (planUrl.isNotEmpty) ...[
            const SizedBox(height: 18),
            AppSectionTitle(title: 'Plano original'),
            const SizedBox(height: 10),
            AppCard(
              padding: EdgeInsets.zero,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(AppColors.radius),
                child: Image.network(
                  planUrl,
                  fit: BoxFit.contain,
                  errorBuilder: (_, _, _) => const Padding(
                    padding: EdgeInsets.all(30),
                    child: Icon(
                      Icons.broken_image_outlined,
                      size: 48,
                      color: AppColors.muted,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(
              label,
              style: const TextStyle(fontSize: 13, color: AppColors.muted),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w500,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}
