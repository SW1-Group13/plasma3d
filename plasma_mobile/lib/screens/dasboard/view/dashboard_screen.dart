import 'dart:io';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:image_picker/image_picker.dart';

import '../../../api/api_client.dart';
import '../../../api/models_service.dart';
import '../../../config/app_colors.dart';
import '../../auth/service/auth_controller.dart';
import '../../main/sidebar/widget/modelo_detalle_page.dart';
import '../../widgets/ui/app_ui.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  final _auth = Get.find<AuthController>();

  bool _loading = true;
  bool _busy = false;
  String? _error;
  List<ModelJob> _models = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final models = await ModelsService.list();
      if (!mounted) return;
      setState(() {
        _models = models;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e is ApiException
            ? e.message
            : 'No se pudieron cargar tus modelos.';
        _loading = false;
      });
    }
  }

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

  Future<void> _uploadPlan() async {
    final user = _auth.currentUser.value;
    if (user?.id == null) {
      _snack('Inicia sesión para subir un plano.');
      return;
    }

    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 90,
    );
    if (picked == null) return;

    setState(() => _busy = true);
    try {
      await ModelsService.uploadPlan(
        File(picked.path),
        usuario: user!.id!,
      );
      await _load();
      _snack('Plano procesado y modelo generado.', success: true);
    } catch (e) {
      _snack(e is ApiException ? e.message : 'No se pudo subir el plano.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _createEmpty() async {
    final id = _auth.currentUser.value?.id;
    if (id == null) {
      _snack('Inicia sesión para crear un modelo.');
      return;
    }

    setState(() => _busy = true);
    try {
      await ModelsService.createEmpty(usuario: id);
      await _load();
      _snack('Modelo vacío creado.', success: true);
    } catch (e) {
      _snack(e is ApiException ? e.message : 'No se pudo crear el modelo.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete(ModelJob model) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Eliminar proyecto'),
        content: Text(
          '¿Seguro que quieres eliminar el modelo #${model.id}? '
          'Esta acción no se puede deshacer.',
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

    try {
      await ModelsService.delete(model.id);
      await _load();
      _snack('Proyecto eliminado.', success: true);
    } catch (e) {
      _snack(e is ApiException ? e.message : 'No se pudo eliminar el proyecto.');
    }
  }

  void _open(ModelJob model) {
    Get.to(() => ModeloDetallePage(modelo: model.toJson()));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
          children: [
            _buildHero(context),
            const SizedBox(height: 18),
            _buildStats(context),
            const SizedBox(height: 24),
            AppSectionTitle(
              title: 'Mis modelos',
              subtitle: _models.isEmpty
                  ? 'Sin proyectos todavía'
                  : '${_models.length} proyecto(s)',
              trailing: Row(
                children: [
                  AppIconButton(
                    icon: Icons.refresh_rounded,
                    tooltip: 'Actualizar',
                    onPressed: _loading ? null : _load,
                  ),
                  const SizedBox(width: 8),
                  AppIconButton(
                    icon: Icons.add_rounded,
                    tooltip: 'Crear modelo vacío',
                    onPressed: _busy ? null : _createEmpty,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            if (_loading)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 48),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_error != null)
              _buildError()
            else if (_models.isEmpty)
              AppEmptyState(
                icon: Icons.view_in_ar_rounded,
                title: 'Aún no tienes modelos',
                message:
                    'Sube un plano para generarlo con IA o crea un modelo vacío para empezar.',
                action: AppButton(
                  label: 'Subir plano',
                  icon: Icons.upload_file_rounded,
                  onPressed: _uploadPlan,
                  expand: false,
                ),
              )
            else
              _buildGrid(),
          ],
        ),
      ),
    );
  }

  Widget _buildHero(BuildContext context) {
    final user = _auth.currentUser.value;
    final firstName = (user?.nombre ?? '').trim().split(' ').first;
    final theme = Theme.of(context);

    return AppCard(
      gradient: AppColors.heroGradient,
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              AppBadge(
                label: (user?.isPremium ?? false) ? 'PREMIUM' : 'PLAN FREE',
                color: (user?.isPremium ?? false)
                    ? AppColors.success
                    : AppColors.accent,
              ),
              const Spacer(),
              AppAvatar(
                name: user?.nombre ?? 'Usuario',
                imageUrl: user?.avatarUrl,
                size: 40,
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            firstName.isEmpty ? 'Hola de nuevo' : 'Hola, $firstName',
            style: theme.textTheme.headlineSmall?.copyWith(
              color: Colors.white,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Sube un plano y conviértelo en un modelo 3D con IA.',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: Colors.white.withValues(alpha: 0.78),
            ),
          ),
          const SizedBox(height: 18),
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: _busy ? null : _uploadPlan,
                  icon: _busy
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.upload_file_rounded, size: 18),
                  label: const Text('Subir plano'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _busy ? null : _createEmpty,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Colors.white,
                    side: BorderSide(color: Colors.white.withValues(alpha: 0.3)),
                  ),
                  icon: const Icon(Icons.add_rounded, size: 18),
                  label: const Text('Vacío'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildStats(BuildContext context) {
    final last = _models.isEmpty ? '—' : _models.first.createdLabel;
    return Row(
      children: [
        Expanded(
          child: _StatCard(
            icon: Icons.layers_rounded,
            label: 'Proyectos',
            value: '${_models.length}',
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _StatCard(
            icon: Icons.workspace_premium_rounded,
            label: 'Plan',
            value: (_auth.currentUser.value?.isPremium ?? false)
                ? 'Premium'
                : 'Free',
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _StatCard(
            icon: Icons.schedule_rounded,
            label: 'Último',
            value: last.isEmpty ? '—' : last,
          ),
        ),
      ],
    );
  }

  Widget _buildError() {
    return AppCard(
      child: Column(
        children: [
          const Icon(Icons.cloud_off_rounded, color: AppColors.danger, size: 36),
          const SizedBox(height: 10),
          Text(
            _error!,
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppColors.muted),
          ),
          const SizedBox(height: 14),
          AppButton(
            label: 'Reintentar',
            icon: Icons.refresh_rounded,
            onPressed: _load,
            expand: false,
          ),
        ],
      ),
    );
  }

  Widget _buildGrid() {
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = constraints.maxWidth >= 1000
            ? 4
            : constraints.maxWidth >= 680
                ? 3
                : 2;
        return GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: _models.length,
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: columns,
            crossAxisSpacing: 12,
            mainAxisSpacing: 12,
            childAspectRatio: 0.82,
          ),
          itemBuilder: (context, i) => _ModelCard(
            model: _models[i],
            onTap: () => _open(_models[i]),
            onDelete: () => _delete(_models[i]),
          ),
        );
      },
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return AppCard(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: AppColors.primary),
          const SizedBox(height: 10),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
          Text(
            label,
            style: const TextStyle(fontSize: 11, color: AppColors.muted),
          ),
        ],
      ),
    );
  }
}

class _ModelCard extends StatelessWidget {
  const _ModelCard({
    required this.model,
    required this.onTap,
    required this.onDelete,
  });

  final ModelJob model;
  final VoidCallback onTap;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return AppCard(
      padding: EdgeInsets.zero,
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Stack(
              fit: StackFit.expand,
              children: [
                ClipRRect(
                  borderRadius: const BorderRadius.vertical(
                    top: Radius.circular(AppColors.radius),
                  ),
                  child: model.planImageUrl.isEmpty
                      ? Container(
                          color: AppColors.surface2,
                          child: const Icon(
                            Icons.image_outlined,
                            color: AppColors.muted,
                          ),
                        )
                      : Image.network(
                          model.planImageUrl,
                          fit: BoxFit.cover,
                          errorBuilder: (_, _, _) => Container(
                            color: AppColors.surface2,
                            child: const Icon(
                              Icons.broken_image_outlined,
                              color: AppColors.muted,
                            ),
                          ),
                        ),
                ),
                Positioned(
                  top: 8,
                  left: 8,
                  child: AppBadge(
                    label: model.hasModel ? '3D' : 'Vacío',
                    color: model.hasModel
                        ? AppColors.success
                        : AppColors.warning,
                  ),
                ),
                Positioned(
                  top: 6,
                  right: 6,
                  child: IconButton(
                    onPressed: onDelete,
                    icon: const Icon(
                      Icons.delete_outline_rounded,
                      size: 18,
                      color: Colors.white,
                    ),
                    style: IconButton.styleFrom(
                      backgroundColor: Colors.black.withValues(alpha: 0.5),
                      minimumSize: const Size(34, 34),
                    ),
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Modelo #${model.id}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  model.createdLabel.isEmpty ? 'Sin fecha' : model.createdLabel,
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
  }
}
