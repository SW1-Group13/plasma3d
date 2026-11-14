import { http } from '@/shared/api/http';
import type { Model3D, SaveModelResponse } from '@/entities/model3D/types';

/** Techo que el backend genera junto con la losa de piso. */
export type RoofType = 'plano' | 'dos_aguas' | 'ninguno';

export const model3DApi = {
  async list(): Promise<Model3D[]> {
    const { data } = await http.get<Model3D[]>('api/set_plan/lista_modelos/');
    return data;
  },

  async uploadPlan(file: File, usuario: number, roofType: RoofType = 'plano'): Promise<Model3D> {
    const formData = new FormData();
    formData.append('plan_file', file);
    formData.append('usuario', usuario.toString());
    formData.append('roof_type', roofType);
    const { data } = await http.post<Model3D>('api/set_plan/plans/', formData);
    return data;
  },

  async updateGlb(file: File, usuario: number): Promise<Model3D[]> {
    const formData = new FormData();
    formData.append('file_glb', file);
    formData.append('usuario', usuario.toString());
    await http.post('api/set_plan/reemplazar_glb/', formData);
    return model3DApi.list();
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
  async regenerate(id: number): Promise<Model3D> {
    const { data } = await http.post<Model3D>(`api/set_plan/plans/${id}/regenerar/`, {});
    return data;
  },
};
