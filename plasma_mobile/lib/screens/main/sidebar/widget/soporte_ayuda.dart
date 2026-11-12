import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../config/app_colors.dart';
import '../../../widgets/ui/app_ui.dart';

class HelpSupportScreen extends StatelessWidget {
  const HelpSupportScreen({super.key});

  Future<void> _openUrl(BuildContext context, String url) async {
    final uri = Uri.parse(url);
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('No se pudo abrir: $url')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Ayuda y soporte')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          AppCard(
            gradient: AppColors.heroGradient,
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Centro de ayuda',
                  style: theme.textTheme.titleLarge?.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'Encuentra respuestas rápidas o contacta a nuestro equipo.',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: Colors.white.withValues(alpha: 0.78),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          const AppSectionTitle(title: 'Preguntas frecuentes'),
          const SizedBox(height: 10),
          const _Faq(
            question: '¿Cómo genero un modelo 3D?',
            answer:
                'Abre “IA Diseño”, toma o selecciona una foto del plano y pulsa “Generar modelo 3D”.',
          ),
          const _Faq(
            question: '¿Dónde están mis modelos?',
            answer:
                'Todos tus proyectos aparecen en “Inicio” y puedes abrirlos para ver el modelo 3D.',
          ),
          const _Faq(
            question: '¿Qué incluye el Plan Premium?',
            answer:
                'Modelos ilimitados, render en HD, análisis de riesgo con IA y soporte prioritario.',
          ),
          const SizedBox(height: 20),
          const AppSectionTitle(title: 'Contacto'),
          const SizedBox(height: 10),
          AppCard(
            child: ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.public_rounded, color: AppColors.primary),
              title: const Text('Sitio web'),
              subtitle: const Text(
                'front-sw1.fournext.me',
                style: TextStyle(fontSize: 12, color: AppColors.muted),
              ),
              trailing: const Icon(
                Icons.open_in_new_rounded,
                size: 18,
                color: AppColors.muted,
              ),
              onTap: () => _openUrl(context, 'https://front-sw1.fournext.me/login'),
            ),
          ),
        ],
      ),
    );
  }
}

class _Faq extends StatelessWidget {
  const _Faq({required this.question, required this.answer});

  final String question;
  final String answer;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: isDark ? AppColors.surface : Colors.white,
        borderRadius: BorderRadius.circular(AppColors.radiusSmall),
        border: Border.all(
          color: isDark ? AppColors.border : const Color(0xFFE2E8F0),
        ),
      ),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          title: Text(
            question,
            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
          ),
          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
          children: [
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                answer,
                style: const TextStyle(
                  color: AppColors.muted,
                  fontSize: 13,
                  height: 1.4,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
