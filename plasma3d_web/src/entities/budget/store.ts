import { create } from 'zustand';
import { budgetApi } from '@/entities/budget/api';
import type { BudgetDetalle, BudgetResponse, Categoria } from '@/entities/budget/types';

interface BudgetStore {
  isLoading: boolean;
  total: number;
  detalle: BudgetDetalle[];
  noEncontrados: string[];
  totales: Record<Categoria, number>;
  sinPrecio: string[];
  generate: (modelJson: unknown) => Promise<void>;
  reset: () => void;
}

const EMPTY_TOTALS: Record<Categoria, number> = { wall: 0, door: 0, window: 0, floor: 0, roof: 0 };

export const useBudgetStore = create<BudgetStore>((set) => ({
  isLoading: false,
  total: 0,
  detalle: [],
  noEncontrados: [],
  totales: { ...EMPTY_TOTALS },
  sinPrecio: [],

  generate: async (modelJson) => {
    set({ isLoading: true });
    try {
      const response: BudgetResponse = await budgetApi.calculate(modelJson);
      set({
        total: response.total_estimado ?? 0,
        detalle: response.detalle ?? [],
        noEncontrados: response.materiales_no_encontrados ?? [],
        totales: { ...EMPTY_TOTALS, ...(response.totales_por_categoria ?? {}) },
        sinPrecio: response.categorias_sin_precio ?? [],
      });
    } finally {
      set({ isLoading: false });
    }
  },

  reset: () =>
    set({ total: 0, detalle: [], noEncontrados: [], totales: { ...EMPTY_TOTALS }, sinPrecio: [] }),
}));
