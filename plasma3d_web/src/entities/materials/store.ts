import { create } from 'zustand';
import type { Material } from '@/entities/materials/types';
import { materialsApi, type MaterialInput } from '@/entities/materials/api';

const timers: Record<string, number> = {};

interface MaterialStore {
  materials: Material[];
  showTextures: boolean;
  loaded: boolean;
  fetch: () => Promise<void>;
  create: (input: MaterialInput, file?: File | null) => Promise<string>;
  update: (id: string, patch: Partial<Material>) => void;
  duplicate: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setShowTextures: (value: boolean) => void;
}

function toInput(patch: Partial<Material>): Partial<MaterialInput> {
  const input: Partial<MaterialInput> = {};
  if (patch.nombre !== undefined) input.nombre = patch.nombre;
  if (patch.categoria !== undefined) input.categoria = patch.categoria;
  if (patch.color_difuso !== undefined) input.color_difuso = patch.color_difuso;
  if (patch.rugosidad !== undefined) input.rugosidad = patch.rugosidad;
  if (patch.reflectividad !== undefined) input.reflectividad = patch.reflectividad;
  if (patch.metalico !== undefined) input.metalico = patch.metalico;
  if (patch.opacidad !== undefined) input.opacidad = patch.opacidad;
  if (patch.escala_textura !== undefined) input.escala_textura = patch.escala_textura;
  return input;
}

export const useMaterialStore = create<MaterialStore>((set, get) => ({
  materials: [],
  showTextures: false,
  loaded: false,

  fetch: async () => {
    const materials = await materialsApi.list();
    set({ materials, loaded: true });
  },

  create: async (input, file) => {
    const created = await materialsApi.create(input, file);
    set((s) => ({ materials: [...s.materials, created] }));
    return created.id;
  },

  update: (id, patch) => {
    set((s) => ({ materials: s.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
    if (timers[id]) window.clearTimeout(timers[id]);
    timers[id] = window.setTimeout(() => {
      materialsApi.update(id, toInput(patch)).catch(() => undefined);
    }, 400);
  },

  duplicate: async (id) => {
    const source = get().materials.find((m) => m.id === id);
    if (!source) return;
    const created = await materialsApi.create({
      nombre: `${source.nombre} (copia)`,
      categoria: source.categoria,
      color_difuso: source.color_difuso,
      rugosidad: source.rugosidad,
      reflectividad: source.reflectividad,
      metalico: source.metalico,
      opacidad: source.opacidad,
      escala_textura: source.escala_textura,
      textura_path: source.textura_url?.startsWith('/') ? source.textura_url : undefined,
    });
    set((s) => ({ materials: [...s.materials, created] }));
  },

  remove: async (id) => {
    set((s) => ({ materials: s.materials.filter((m) => m.id !== id) }));
    try {
      await materialsApi.remove(id);
    } catch {
      /* ignore */
    }
  },

  setShowTextures: (value) => set({ showTextures: value }),
}));
