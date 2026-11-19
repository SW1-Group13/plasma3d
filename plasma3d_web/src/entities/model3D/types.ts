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
  /** 'review': detectado y esperando corrección 2D (todavía sin GLB). */
  status?: 'review' | 'built' | 'failed';
}

export type DetectionClass = 'wall' | 'door' | 'window';

/** Caja en píxeles de la imagen rasterizada (plan_image). */
export interface DetectionBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Muros girados: eje [ax, ay, bx, by] en px. */
  line?: [number, number, number, number];
  thickness?: number;
}

/** JSON de detecciones completo tal como lo guarda el backend. */
export interface PlanDetections {
  Width: number;
  Height: number;
  points: DetectionBox[];
  classes: { name: string }[];
  scores?: number[];
  quality?: Record<string, unknown> & { thickness_px?: number };
  [key: string]: unknown;
}

export type Model3DWithDetections = Model3D & { detections: PlanDetections };

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
