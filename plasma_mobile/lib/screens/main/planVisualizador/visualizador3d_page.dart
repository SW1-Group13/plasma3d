import 'package:flutter/material.dart';
import 'package:model_viewer_plus/model_viewer_plus.dart';

import '../../../api/api_client.dart';
import '../../../api/models_service.dart';
import '../../../config/app_colors.dart';
import '../../widgets/ui/app_ui.dart';

class Visualizador3dPage extends StatefulWidget {
  const Visualizador3dPage({super.key});

  @override
  State<Visualizador3dPage> createState() => _Visualizador3dPageState();
}

class _Visualizador3dPageState extends State<Visualizador3dPage> {
  bool _loading = true;
  String? _error;
  List<ModelJob> _models = const [];
  ModelJob? _selected;

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
      final withModel = models.where((m) => m.hasModel).toList();
      if (!mounted) return;
      setState(() {
        _models = withModel;
        _selected = withModel.isEmpty ? null : withModel.first;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e is ApiException ? e.message : 'No se pudieron cargar los modelos.';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_error != null) {
      return Center(
        child: AppEmptyState(
          icon: Icons.cloud_off_rounded,
          title: 'No se pudo cargar',
          message: _error,
          action: AppButton(
            label: 'Reintentar',
            icon: Icons.refresh_rounded,
            onPressed: _load,
            expand: false,
          ),
        ),
      );
    }

    if (_models.isEmpty) {
      return const AppEmptyState(
        icon: Icons.view_in_ar_rounded,
        title: 'Sin modelos 3D',
        message: 'Genera un modelo desde “IA Diseño” o sube un plano desde Inicio.',
      );
    }

    final selected = _selected ?? _models.first;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                'Visualizador 3D',
                style: Theme.of(context)
                    .textTheme
                    .headlineSmall
                    ?.copyWith(fontWeight: FontWeight.w700),
              ),
            ),
            IconButton(
              tooltip: 'Actualizar',
              onPressed: _load,
              icon: const Icon(Icons.refresh_rounded),
            ),
          ],
        ),
        const SizedBox(height: 8),
        AppSectionTitle(
          title: 'Tus modelos',
          subtitle: '${_models.length} modelo(s) disponibles',
        ),
        const SizedBox(height: 10),
        SizedBox(
          height: 40,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: _models.length,
            separatorBuilder: (_, _) => const SizedBox(width: 8),
            itemBuilder: (context, i) {
              final model = _models[i];
              final active = model.id == selected.id;
              return ChoiceChip(
                label: Text('Modelo #${model.id}'),
                selected: active,
                onSelected: (_) => setState(() => _selected = model),
                selectedColor: AppColors.primary.withValues(alpha: 0.18),
                labelStyle: TextStyle(
                  color: active ? AppColors.primary : AppColors.muted,
                  fontWeight: active ? FontWeight.w600 : FontWeight.w500,
                ),
                side: BorderSide(
                  color: active ? AppColors.primary : AppColors.border,
                ),
                backgroundColor: Colors.transparent,
              );
            },
          ),
        ),
        const SizedBox(height: 14),
        AppCard(
          padding: EdgeInsets.zero,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(AppColors.radius),
            child: SizedBox(
              height: 420,
              child: ModelViewer(
                key: ValueKey(selected.glbUrl),
                src: selected.glbUrl,
                alt: 'Modelo 3D',
                ar: true,
                autoRotate: true,
                cameraControls: true,
                shadowIntensity: 1,
                backgroundColor: AppColors.surface2,
              ),
            ),
          ),
        ),
        const SizedBox(height: 14),
        AppCard(
          child: Row(
            children: [
              const Icon(Icons.info_outline_rounded, color: AppColors.primary),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Arrastra para rotar · pellizca para zoom · usa AR para verlo en tu espacio.',
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: AppColors.muted),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
