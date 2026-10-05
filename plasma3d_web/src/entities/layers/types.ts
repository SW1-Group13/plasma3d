export type LineType = 'continuous' | 'dashed' | 'dotted' | 'dashdot';

export interface Layer {
  id: string;
  nombre: string;
  color: string;
  visible: boolean;
  bloqueada: boolean;
  congelada: boolean;
  grosorLinea: number; // mm
  tipoLinea: LineType;
  transparencia: number; // 0-100
  descripcion: string;
}

export type ColorRef = 'bylayer' | string; // 'bylayer' o '#rrggbb'
