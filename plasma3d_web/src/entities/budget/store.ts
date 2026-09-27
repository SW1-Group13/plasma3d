import { create } from 'zustand';
import { budgetApi } from '@/entities/budget/api';
import type { BudgetDetalle, BudgetResponse } from '@/entities/budget/types';

interface BudgetStore {
  isLoading: boolean;
  total: number;
  detalle: BudgetDetalle[];
  noEncontrados: string[];
  totalWall: number;
  totalDoor: number;
  totalWindow: number;
  categoryAndMaterials: { categoria: string; material: string; total: number }[];
  generate: (modelJson: unknown) => Promise<void>;
  reset: () => void;
}

export const useBudgetStore = create<BudgetStore>((set) => ({
  isLoading: false,
  total: 0,
  detalle: [],
  noEncontrados: [],
  totalWall: 0,
  totalDoor: 0,
  totalWindow: 0,
  categoryAndMaterials: [],

  generate: async (modelJson) => {
    set({ isLoading: true });
    try {
      const response: BudgetResponse = await budgetApi.calculate(modelJson);
      const detalle = response.detalle ?? [];

      const grouped = Array.from(
        detalle
          .reduce((acc, item) => {
            const key = `${item.categoria}-${item.material}`;
            const current = acc.get(key) ?? {
              categoria: item.categoria,
              material: item.material,
              total: 0,
            };
            current.total += item.subtotal;
            acc.set(key, current);
            return acc;
          }, new Map<string, { categoria: string; material: string; total: number }>())
          .values(),
      );

      let totalWall = 0;
      let totalDoor = 0;
      let totalWindow = 0;
      detalle.forEach((item) => {
        if (item.categoria === 'wall') totalWall += item.subtotal;
        else if (item.categoria === 'door') totalDoor += item.subtotal;
        else if (item.categoria === 'window') totalWindow += item.subtotal;
      });

      set({
        total: response.total_estimado ?? 0,
        detalle,
        noEncontrados: response.materiales_no_encontrados ?? [],
        totalWall,
        totalDoor,
        totalWindow,
        categoryAndMaterials: grouped,
      });
    } finally {
      set({ isLoading: false });
    }
  },

  reset: () =>
    set({
      total: 0,
      detalle: [],
      noEncontrados: [],
      totalWall: 0,
      totalDoor: 0,
      totalWindow: 0,
      categoryAndMaterials: [],
    }),
}));
