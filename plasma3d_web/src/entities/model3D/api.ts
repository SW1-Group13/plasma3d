import { http } from '@/shared/api/http';
import type { Model3D, SaveModelResponse } from '@/entities/model3D/types';

export const model3DApi = {
  async list(): Promise<Model3D[]> {
    const { data } = await http.get<Model3D[]>('api/set_plan/lista_modelos/');
    return data;
  },

  async uploadPlan(file: File, usuario: number): Promise<Model3D> {
    const formData = new FormData();
    formData.append('plan_file', file);
    formData.append('usuario', usuario.toString());
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
};
