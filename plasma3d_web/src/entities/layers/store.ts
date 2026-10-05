import { create } from 'zustand';
import type { Layer } from '@/entities/layers/types';
import { layersApi } from '@/entities/layers/api';

const FALLBACK: Layer[] = [
  { id: 'layer-paredes', nombre: 'Paredes', color: '#ffffff', visible: true, bloqueada: false, congelada: false, grosorLinea: 0.3, tipoLinea: 'continuous', transparencia: 0, descripcion: 'Muros y tabiques' },
  { id: 'layer-puertas', nombre: 'Puertas', color: '#8a5a2b', visible: true, bloqueada: false, congelada: false, grosorLinea: 0.25, tipoLinea: 'continuous', transparencia: 0, descripcion: 'Vanos de puerta' },
  { id: 'layer-ventanas', nombre: 'Ventanas', color: '#9aa3af', visible: true, bloqueada: false, congelada: false, grosorLinea: 0.25, tipoLinea: 'continuous', transparencia: 0, descripcion: 'Vanos de ventana' },
];

const timers: Record<string, number> = {};

interface LayerStore {
  layers: Layer[];
  currentLayerId: string;
  loaded: boolean;
  fetch: () => Promise<void>;
  addLayer: () => Promise<void>;
  removeLayer: (id: string) => Promise<void>;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
  setCurrent: (id: string) => void;
  reset: () => void;
}

export const useLayerStore = create<LayerStore>((set, get) => ({
  layers: FALLBACK.map((l) => ({ ...l })),
  currentLayerId: 'layer-paredes',
  loaded: false,

  fetch: async () => {
    const layers = await layersApi.list();
    if (layers.length === 0) {
      set({ loaded: true });
      return;
    }
    const current = layers.some((l) => l.id === get().currentLayerId)
      ? get().currentLayerId
      : layers.find((l) => l.nombre === 'Paredes')?.id ?? layers[0].id;
    set({ layers, currentLayerId: current, loaded: true });
  },

  addLayer: async () => {
    const created = await layersApi.create({
      nombre: `Capa ${Math.floor(Math.random() * 1000)}`,
      color: '#8ab4ff',
      grosorLinea: 0.25,
      tipoLinea: 'continuous',
    });
    set((s) => ({ layers: [...s.layers, created], currentLayerId: created.id }));
  },

  removeLayer: async (id) => {
    set((s) => {
      const layers = s.layers.filter((l) => l.id !== id);
      const currentLayerId = s.currentLayerId === id ? layers[0]?.id ?? '' : s.currentLayerId;
      return { layers, currentLayerId };
    });
    try {
      await layersApi.remove(id);
    } catch {
      /* ignore */
    }
  },

  updateLayer: (id, patch) => {
    set((s) => ({ layers: s.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
    if (timers[id]) window.clearTimeout(timers[id]);
    timers[id] = window.setTimeout(() => {
      layersApi.update(id, patch).catch(() => undefined);
    }, 400);
  },

  setCurrent: (id) => set({ currentLayerId: id }),

  reset: () => set({ layers: FALLBACK.map((l) => ({ ...l })), currentLayerId: 'layer-paredes', loaded: false }),
}));
