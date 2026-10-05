import type { TextureRef } from '@/entities/model3D/types';

// Texturas locales servidas desde /public/textures (sin Cloudinary).
export const TEXTURES: TextureRef[] = [
  { name: 'Ladrillo', url: '/textures/ladrillo.jpg' },
  { name: 'Piedra', url: '/textures/patron-ladrillo-yeso.png' },
  { name: 'Cemento', url: '/textures/concreto.png' },
  { name: 'Madera tajibo', url: '/textures/madera-lisa.jpg' },
  { name: 'Madera ochoo', url: '/textures/puerta-madera.jpg' },
  { name: 'Madera roble', url: '/textures/tablas-desgastadas.jpg' },
  { name: 'Vidrio simple', url: '/textures/hielo.jpg' },
  { name: 'Vidrio escandinavo', url: '/textures/hielo.jpg' },
];

// Modelo vacio para "crear modelo" (local).
export const EMPTY_MODEL_URL = '/models/vacio_wama55.glb';

// Modelo del visor de inicio (local).
export const HOME_MODEL_URL = '/models/cartoon_cyberpunk_building.glb';
