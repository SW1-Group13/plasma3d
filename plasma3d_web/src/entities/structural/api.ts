import { http } from '@/shared/api/http';
import type { StructuralAnalysis } from '@/entities/structural/types';

export const structuralApi = {
  async analyze(file: File): Promise<StructuralAnalysis> {
    const formData = new FormData();
    formData.append('archivo', file);
    const { data } = await http.post<StructuralAnalysis>(
      'api/suggestion_risk/analizar/',
      formData,
    );
    return data;
  },

  /** Analiza el modelo guardado (GLB/GLTF) sin volver a subir el archivo. */
  async analyzePlan(planId: number): Promise<StructuralAnalysis> {
    const { data } = await http.post<StructuralAnalysis>(
      `api/suggestion_risk/plans/${planId}/analizar/`,
      {},
    );
    return data;
  },

  async history(planId: number) {
    const { data } = await http.get<
      { id: number; nivel_riesgo: string; fuente: string; created_at: string; resultado: StructuralAnalysis['analisis'] }[]
    >(`api/suggestion_risk/plans/${planId}/analisis/`);
    return data;
  },
};
