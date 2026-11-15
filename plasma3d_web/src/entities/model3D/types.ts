export interface Model3D {
  id: number;
  plan_file: string;
  plan_image?: string;
  detections_json: string;
  glb_model: string;
  widht: number;
  height: number;
  created_at: string;
  usuario: number;
  /** Informe de la detección (muros, puertas, escala, avisos). */
  calidad?: PlanQuality | null;
}

export type ScaleSource = 'usuario' | 'puertas' | 'puertas_dibujadas' | 'estimada';

export interface PlanQuality {
  muros: number;
  puertas: number;
  ventanas: number;
  escala: ScaleSource;
  ancho_m: number | null;
  avisos: string[];
}

export interface Detection {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ModelJson {
  points: Detection[];
  classes: { name: string }[];
}

export interface TextureRef {
  name: string;
  url: string;
}

export interface SaveModelResponse {
  url: string;
}
