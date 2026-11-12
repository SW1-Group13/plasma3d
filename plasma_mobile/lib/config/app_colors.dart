import 'package:flutter/material.dart';

/// Paleta alineada con `plasma3d_web` (design tokens de la web).
class AppColors {
  AppColors._();

  static const canvas = Color(0xFF0A0E1A);
  static const surface = Color(0xFF111726);
  static const surface2 = Color(0xFF1A2233);
  static const border = Color(0xFF232C42);
  static const borderStrong = Color(0xFF33405E);

  static const foreground = Color(0xFFE8ECF4);
  static const muted = Color(0xFF94A0B8);

  static const primary = Color(0xFF4F7CFF);
  static const primaryHover = Color(0xFF6B93FF);
  static const accent = Color(0xFF22D3EE);
  static const success = Color(0xFF34D399);
  static const warning = Color(0xFFFBBF24);
  static const danger = Color(0xFFF87171);

  static const radius = 16.0;
  static const radiusSmall = 12.0;

  static const primaryGradient = LinearGradient(
    colors: [primary, accent],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const heroGradient = LinearGradient(
    colors: [Color(0xFF142048), Color(0xFF0A0E1A)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );
}
