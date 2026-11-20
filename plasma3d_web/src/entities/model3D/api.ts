import { http } from '@/shared/api/http';
import type {
  Model3D,
  Model3DWithDetections,
  PlanDetections,
  SaveModelResponse,
} from '@/entities/model3D/types';

/** Techo que el backend genera junto con la losa de piso. */
export type RoofType = 'plano' | 'dos_aguas' | 'ninguno';

/** Huecos entre muros sin puerta/ventana detectada: rellenar o dejar paso. */
export type GapMode = 'rellenar' | 'paso';

export const model3DApi = {
  async list(): Promise<Model3D[]> {
    const { data } = await http.get<Model3D[]>('api/set_plan/lista_modelos/');
    return data;
  },

  async uploadPlan(
    file: File,
    usuario: number,
    roofType: RoofType = 'plano',
    gapMode: GapMode = 'rellenar',
    realWidthM?: number | null,
  ): Promise<Model3D> {
    const formData = new FormData();
    formData.append('plan_file', file);
    formData.append('usuario', usuario.toString());
    formData.append('roof_type', roofType);
    formData.append('fill_gaps', gapMode === 'rellenar' ? 'true' : 'false');
    if (realWidthM) formData.append('real_width_m', String(realWidthM));
    const { data } = await http.post<Model3D>('api/set_plan/plans/', formData);
    return data;
  },

  /** Revisión 2D, paso 1: detecta sin construir el 3D (job en estado 'review'). */
  async detectPlan(file: File, realWidthM?: number | null): Promise<Model3DWithDetections> {
    const formData = new FormData();
    formData.append('plan_file', file);
    if (realWidthM) formData.append('real_width_m', String(realWidthM));
    const { data } = await http.post<Model3DWithDetections>('api/set_plan/plans/detect/', formData);
    return data;
  },

  async getDetections(id: number): Promise<Model3DWithDetections> {
    const { data } = await http.get<Model3DWithDetections>(`api/set_plan/plans/${id}/detections/`);
    return data;
  },

  async saveDetections(id: number, detections: PlanDetections): Promise<Model3DWithDetections> {
    const { data } = await http.put<Model3DWithDetections>(`api/set_plan/plans/${id}/detections/`, {
      detections,
    });
    return data;
  },

  /** Revisión 2D, paso final: construye el GLB con las detecciones guardadas. */
  async buildPlan(id: number, roofType: RoofType = 'plano', gapMode: GapMode = 'rellenar'): Promise<Model3D> {
    const { data } = await http.post<Model3D>(`api/set_plan/plans/${id}/build/`, {
      roof_type: roofType,
      fill_gaps: gapMode === 'rellenar',
    });
    return data;
  },

  /** Reemplaza el GLB del plano y devuelve el plano con la URL nueva. */
  async updateGlb(file: File, usuario: number): Promise<Model3D> {
    const formData = new FormData();
    formData.append('file_glb', file);
    formData.append('usuario', usuario.toString());
    const { data } = await http.post<Model3D>('api/set_plan/reemplazar_glb/', formData);
    return data;
  },

  async saveGlb(file: File, usuario: number): Promise<SaveModelResponse> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('usuario', usuario.toString());
    const { data } = await http.post<SaveModelResponse>(
      'api/view_model/upload-glb/',
      formData,
    );
    return data;
  },

  async createEmpty(usuario: number): Promise<Model3D> {
    const { data } = await http.post<Model3D>('api/set_plan/plans/empty/', { usuario });
    return data;
  },

  async remove(id: number): Promise<void> {
    await http.delete(`api/set_plan/plans/${id}/`);
  },

  /**
   * Reconstruye el 3D desde las detecciones guardadas (vanos con dintel,
   * vidrio y marcos). Reemplaza el modelo: se pierden las ediciones manuales.
   */
  async regenerate(id: number, gapMode: GapMode = 'rellenar', realWidthM?: number | null): Promise<Model3D> {
    const { data } = await http.post<Model3D>(`api/set_plan/plans/${id}/regenerar/`, {
      fill_gaps: gapMode === 'rellenar',
      ...(realWidthM ? { real_width_m: realWidthM } : {}),
    });
    return data;
  },
};
