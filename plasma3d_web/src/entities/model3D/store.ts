import { create } from 'zustand';
import { model3DApi } from '@/entities/model3D/api';
import type { Model3D } from '@/entities/model3D/types';

interface ModelStore {
  list: Model3D[];
  isLoading: boolean;
  fetch: () => Promise<void>;
  uploadPlan: (file: File, usuario: number) => Promise<Model3D>;
  updateGlb: (file: File, usuario: number) => Promise<void>;
  saveGlb: (file: File, usuario: number) => Promise<void>;
}

export const useModelStore = create<ModelStore>((set, get) => ({
  list: [],
  isLoading: false,

  fetch: async () => {
    const data = await model3DApi.list();
    set({ list: data });
  },

  uploadPlan: async (file, usuario) => {
    set({ isLoading: true });
    try {
      const model = await model3DApi.uploadPlan(file, usuario);
      await get().fetch();
      return model;
    } finally {
      set({ isLoading: false });
    }
  },

  updateGlb: async (file, usuario) => {
    set({ isLoading: true });
    try {
      const data = await model3DApi.updateGlb(file, usuario);
      set({ list: data });
    } finally {
      set({ isLoading: false });
    }
  },

  saveGlb: async (file, usuario) => {
    set({ isLoading: true });
    try {
      await model3DApi.saveGlb(file, usuario);
      await get().fetch();
    } finally {
      set({ isLoading: false });
    }
  },
}));
