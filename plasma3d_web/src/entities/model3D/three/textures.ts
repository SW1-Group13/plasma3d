import type { TextureRef } from '@/entities/model3D/types';

// Texturas servidas desde el backend (/static/textures).
export const TEXTURES: TextureRef[] = [
  { name: 'Ladrillo', url: '/static/textures/ladrillo.jpg' },
  { name: 'Piedra', url: '/static/textures/patron-ladrillo-yeso.png' },
  { name: 'Cemento', url: '/static/textures/concreto.png' },
  { name: 'Madera tajibo', url: '/static/textures/madera-lisa.jpg' },
  { name: 'Madera ochoo', url: '/static/textures/puerta-madera.jpg' },
  { name: 'Madera roble', url: '/static/textures/tablas-desgastadas.jpg' },
  { name: 'Vidrio simple', url: '/static/textures/hielo.jpg' },
  { name: 'Vidrio escandinavo', url: '/static/textures/hielo.jpg' },
  { name: 'Ceramica', url: '/static/textures/textura_suelo.jpg' },
];

// Modelo del visor de inicio (servido desde el backend).
export const HOME_MODEL_URL = '/static/models/cartoon_cyberpunk_building.glb';
