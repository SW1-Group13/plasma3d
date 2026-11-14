import { http } from '@/shared/api/http';
import type { BudgetResponse } from '@/entities/budget/types';
import type {
  CategoryInterface,
  MaterialInterface,
  PostMaterialInterface,
} from '@/entities/budget/materials';

export const budgetApi = {
  async calculate(modelJson: unknown): Promise<BudgetResponse> {
    const { data } = await http.post<BudgetResponse>('api/presupuesto/calcular/', modelJson);
    return data;
  },

  /** Precios guardados en el backend. */
  async listMaterials(): Promise<MaterialInterface[]> {
    const { data } = await http.get<MaterialInterface[]>('api/presupuesto/materiales/');
    return data;
  },

  async postMaterials(
    categorias: CategoryInterface[],
    materiales: MaterialInterface[],
    reemplazar = false,
  ): Promise<unknown> {
    const body: PostMaterialInterface = { categorias, materiales, reemplazar };
    const { data } = await http.post('api/presupuesto/materiales/cargar/', body);
    return data;
  },
};
