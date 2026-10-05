import { create } from 'zustand';
import type { Layer } from '@/entities/layers/types';

export const DEFAULT_LAYERS: Layer[] = [
  {
    id: 'layer-0',
    nombre: '0',
    color: '#e8ecf4',
    visible: true,
    bloqueada: false,
    congelada: false,
    grosorLinea: 0.25,
    tipoLinea: 'continuous',
    transparencia: 0,
    descripcion: 'Capa base',
  },
  {
    id: 'layer-paredes',
    nombre: 'Paredes',
    color: '#ffffff',
    visible: true,
    bloqueada: false,
    congelada: false,
    grosorLinea: 0.3,
    tipoLinea: 'continuous',
    transparencia: 0,
    descripcion: 'Muros y tabiques',
  },
  {
    id: 'layer-puertas',
    nombre: 'Puertas',
    color: '#8a5a2b',
    visible: true,
    bloqueada: false,
    congelada: false,
    grosorLinea: 0.25,
    tipoLinea: 'continuous',
    transparencia: 0,
    descripcion: 'Vanos de puerta',
  },
  {
    id: 'layer-ventanas',
    nombre: 'Ventanas',
    color: '#9aa3af',
    visible: true,
    bloqueada: false,
    congelada: false,
    grosorLinea: 0.25,
    tipoLinea: 'continuous',
    transparencia: 0,
    descripcion: 'Vanos de ventana',
  },
  {
    id: 'layer-cotas',
    nombre: 'Cotas',
    color: '#fbbf24',
    visible: true,
    bloqueada: false,
    congelada: false,
    grosorLinea: 0.18,
    tipoLinea: 'continuous',
    transparencia: 0,
    descripcion: 'Mediciones',
  },
  {
    id: 'layer-ejes',
    nombre: 'Ejes',
    color: '#94a3b8',
    visible: true,
    bloqueada: false,
    congelada: false,
    grosorLinea: 0.13,
    tipoLinea: 'dashdot',
    transparencia: 0,
    descripcion: 'Referencias',
  },
];

interface LayerStore {
  layers: Layer[];
  currentLayerId: string;
  addLayer: () => string;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
  setCurrent: (id: string) => void;
  reset: () => void;
}

function uid() {
  return `layer-${Math.random().toString(36).slice(2, 9)}`;
}

export const useLayerStore = create<LayerStore>((set, get) => ({
  layers: DEFAULT_LAYERS.map((l) => ({ ...l })),
  currentLayerId: 'layer-paredes',

  addLayer: () => {
    const id = uid();
    const count = get().layers.length;
    set((s) => ({
      layers: [
        ...s.layers,
        {
          id,
          nombre: `Capa ${count}`,
          color: '#8ab4ff',
          visible: true,
          bloqueada: false,
          congelada: false,
          grosorLinea: 0.25,
          tipoLinea: 'continuous',
          transparencia: 0,
          descripcion: '',
        },
      ],
      currentLayerId: id,
    }));
    return id;
  },

  removeLayer: (id) =>
    set((s) => {
      if (id === 'layer-0' || s.layers.length <= 1) return s;
      const layers = s.layers.filter((l) => l.id !== id);
      const currentLayerId = s.currentLayerId === id ? layers[0].id : s.currentLayerId;
      return { layers, currentLayerId };
    }),

  updateLayer: (id, patch) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    })),

  setCurrent: (id) => set({ currentLayerId: id }),

  reset: () =>
    set({ layers: DEFAULT_LAYERS.map((l) => ({ ...l })), currentLayerId: 'layer-paredes' }),
}));
