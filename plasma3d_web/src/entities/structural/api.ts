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
};
