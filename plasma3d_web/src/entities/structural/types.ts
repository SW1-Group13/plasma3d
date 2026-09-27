export interface ElementoBien {
  tipo: string;
  cantidad: number;
  material_usado: string;
  por_que_esta_bien?: string;
}

export interface ElementoMal {
  tipo: string;
  cantidad: number;
  material_usado: string;
  problema?: string;
  nivel_riesgo?: string;
}

export interface Recomendacion {
  para_elemento: string;
  cantidad_afectada: number;
  cambiar_de: string;
  cambiar_a: string;
  razon: string;
  urgencia?: string;
}

export interface ResumenGeneral {
  nivel_riesgo_global: string;
  elementos_correctos: number;
  elementos_incorrectos: number;
  comentario?: string;
}

export interface StructuralAnalysis {
  success: boolean;
  analisis: {
    elementos_bien_hechos: ElementoBien[];
    elementos_mal_hechos: ElementoMal[];
    recomendaciones: Recomendacion[];
    resumen_general: ResumenGeneral;
  };
  nombre_archivo: string;
  texturas_enviadas: number;
}
