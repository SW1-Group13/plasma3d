export interface Material {
  id: string;
  nombre: string;
  categoria: string;
  textura_url?: string;
  color_difuso: string;
  rugosidad: number; // 0-1
  reflectividad: number; // 0-1
  metalico: number; // 0-1
  opacidad: number; // 0-1
  escala_textura: [number, number];
}
