import 'package:flutter/material.dart';
import 'package:model_viewer_plus/model_viewer_plus.dart';

import '../../config/app_colors.dart';
import '../widgets/ui/app_ui.dart';

class GlbViewerPage extends StatefulWidget {
  const GlbViewerPage({super.key});

  @override
  State<GlbViewerPage> createState() => _GlbViewerPageState();
}

class _GlbViewerPageState extends State<GlbViewerPage> {
  final _urlController = TextEditingController();
  String? _glbUrl;
  String? _errorMsg;

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  void _load() {
    FocusScope.of(context).unfocus();
    final url = _urlController.text.trim();
    setState(() {
      if (url.isEmpty || !(url.endsWith('.glb') || url.endsWith('.gltf'))) {
        _errorMsg = 'Ingresa una URL válida que termine en .glb o .gltf';
        _glbUrl = null;
      } else {
        _errorMsg = null;
        _glbUrl = url;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Visor 3D')),
      body: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        child: Column(
          children: [
            TextField(
              controller: _urlController,
              textInputAction: TextInputAction.go,
              onSubmitted: (_) => _load(),
              decoration: InputDecoration(
                hintText: 'https://.../modelo.glb',
                prefixIcon: const Icon(Icons.link_rounded),
                errorText: _errorMsg,
              ),
            ),
            const SizedBox(height: 12),
            AppButton(
              label: 'Cargar modelo',
              icon: Icons.cloud_download_rounded,
              onPressed: _load,
            ),
            const SizedBox(height: 14),
            Expanded(
              child: AppCard(
                padding: EdgeInsets.zero,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(AppColors.radius),
                  child: _glbUrl == null
                      ? const AppEmptyState(
                          icon: Icons.view_in_ar_rounded,
                          title: 'Sin modelo cargado',
                          message: 'Pega la URL de un archivo .glb o .gltf.',
                        )
                      : ModelViewer(
                          key: ValueKey(_glbUrl),
                          src: _glbUrl!,
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
          ],
        ),
      ),
    );
  }
}
