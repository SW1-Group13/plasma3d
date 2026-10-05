import { create } from 'zustand';
import type { Material } from '@/entities/materials/types';

interface Seed {
  nombre: string;
  categoria: string;
  textura_url?: string;
  color_difuso: string;
  rugosidad?: number;
  reflectividad?: number;
  metalico?: number;
  opacidad?: number;
}

const SEED: Seed[] = [
  { nombre: 'Ladrillo rojo', categoria: 'Mampostería', textura_url: '/textures/ladrillo.jpg', color_difuso: '#A0522D' },
  { nombre: 'Ladrillo blanco', categoria: 'Mampostería', color_difuso: '#E7E3DA' },
  { nombre: 'Bloque hormigón', categoria: 'Mampostería', textura_url: '/textures/concreto.png', color_difuso: '#B7B7B0' },
  { nombre: 'Piedra natural', categoria: 'Mampostería', textura_url: '/textures/piedra.jpg', color_difuso: '#9C9689' },
  { nombre: 'Yeso blanco', categoria: 'Revestimiento', color_difuso: '#F3F1EC', rugosidad: 0.95 },
  { nombre: 'Estuco', categoria: 'Revestimiento', color_difuso: '#E4DCCB' },
  { nombre: 'Cemento', categoria: 'Revestimiento', textura_url: '/textures/concreto.png', color_difuso: '#C9C9C4' },
  { nombre: 'Roble', categoria: 'Madera', textura_url: '/textures/madera-lisa.jpg', color_difuso: '#B98A54' },
  { nombre: 'Pino', categoria: 'Madera', textura_url: '/textures/puerta-madera.jpg', color_difuso: '#C9A06A' },
  { nombre: 'Nogal', categoria: 'Madera', textura_url: '/textures/tablas-desgastadas.jpg', color_difuso: '#5C4033' },
  { nombre: 'Barniz', categoria: 'Madera', color_difuso: '#8B5A2B', rugosidad: 0.35 },
  { nombre: 'Vidrio transparente', categoria: 'Vidrio', textura_url: '/textures/hielo.jpg', color_difuso: '#CFE8F5', opacidad: 0.25, rugosidad: 0.05 },
  { nombre: 'Vidrio esmerilado', categoria: 'Vidrio', textura_url: '/textures/hielo.jpg', color_difuso: '#D8E4E8', opacidad: 0.5, rugosidad: 0.4 },
  { nombre: 'Vidrio templado azulado', categoria: 'Vidrio', textura_url: '/textures/hielo.jpg', color_difuso: '#9CC3D9', opacidad: 0.3, rugosidad: 0.1 },
  { nombre: 'Aluminio', categoria: 'Metal', color_difuso: '#C0C4C8', metalico: 0.9, rugosidad: 0.3, reflectividad: 0.8 },
  { nombre: 'Acero', categoria: 'Metal', color_difuso: '#8A8F94', metalico: 0.95, rugosidad: 0.25, reflectividad: 0.85 },
  { nombre: 'Hierro forjado', categoria: 'Metal', color_difuso: '#4A4A4A', metalico: 0.85, rugosidad: 0.5, reflectividad: 0.6 },
  { nombre: 'Blanca mate', categoria: 'Pintura', color_difuso: '#F2F2F0', rugosidad: 0.9 },
  { nombre: 'Gris perla', categoria: 'Pintura', color_difuso: '#BFBFBF' },
  { nombre: 'Beige', categoria: 'Pintura', color_difuso: '#D9CBB3' },
  { nombre: 'Terracota', categoria: 'Pintura', color_difuso: '#B5623C' },
];

function build(seed: Seed, index: number): Material {
  return {
    id: `mat-${index}-${seed.nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    nombre: seed.nombre,
    categoria: seed.categoria,
    textura_url: seed.textura_url,
    color_difuso: seed.color_difuso,
    rugosidad: seed.rugosidad ?? 0.8,
    reflectividad: seed.reflectividad ?? 0.1,
    metalico: seed.metalico ?? 0,
    opacidad: seed.opacidad ?? 1,
    escala_textura: [1, 1],
  };
}

export const DEFAULT_MATERIALS: Material[] = SEED.map(build);

export function defaultMaterialIdForKind(kind: string): string | undefined {
  const find = (name: string) => DEFAULT_MATERIALS.find((m) => m.nombre === name)?.id;
  if (kind === 'wall') return find('Ladrillo rojo');
  if (kind === 'door') return find('Roble');
  if (kind === 'window') return find('Vidrio transparente');
  return undefined;
}

interface MaterialStore {
  materials: Material[];
  showTextures: boolean;
  add: (m: Omit<Material, 'id'>) => string;
  update: (id: string, patch: Partial<Material>) => void;
  duplicate: (id: string) => string | undefined;
  remove: (id: string) => void;
  setShowTextures: (value: boolean) => void;
}

export const useMaterialStore = create<MaterialStore>((set, get) => ({
  materials: DEFAULT_MATERIALS.map((m) => ({ ...m })),
  showTextures: false,

  add: (m) => {
    const id = `mat-${Math.random().toString(36).slice(2, 9)}`;
    set((s) => ({ materials: [...s.materials, { ...m, id }] }));
    return id;
  },

  update: (id, patch) =>
    set((s) => ({ materials: s.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),

  duplicate: (id) => {
    const source = get().materials.find((m) => m.id === id);
    if (!source) return undefined;
    const newId = `mat-${Math.random().toString(36).slice(2, 9)}`;
    set((s) => ({ materials: [...s.materials, { ...source, id: newId, nombre: `${source.nombre} (copia)` }] }));
    return newId;
  },

  remove: (id) => set((s) => ({ materials: s.materials.filter((m) => m.id !== id) })),

  setShowTextures: (value) => set({ showTextures: value }),
}));
