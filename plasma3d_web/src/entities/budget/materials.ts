import type { Categoria } from '@/entities/budget/types';

export interface CategoryInterface {
  nombre: string;
  descripcion: string;
}

/** Unidad del precio: define qué medida de la pieza se cobra. */
export type PriceUnit = 'm2' | 'm3' | 'ml' | 'u';

export interface MaterialInterface {
  nombre: string;
  unidad: PriceUnit | string;
  precio_unitario: number;
  categoria: Categoria | string;
}

export interface PostMaterialInterface {
  categorias: CategoryInterface[];
  materiales: MaterialInterface[];
  /** true: la lista es completa y se borran los materiales viejos de esas categorías. */
  reemplazar?: boolean;
}

export const PRICE_UNITS: { id: PriceUnit; label: string; hint: string }[] = [
  { id: 'm2', label: 'm²', hint: 'por metro cuadrado (superficie)' },
  { id: 'm3', label: 'm³', hint: 'por metro cúbico (volumen)' },
  { id: 'ml', label: 'ml', hint: 'por metro lineal (largo)' },
  { id: 'u', label: 'u', hint: 'por pieza' },
];

export const CATEGORY_LABELS: Record<Categoria, string> = {
  wall: 'Paredes',
  door: 'Puertas',
  window: 'Ventanas',
  floor: 'Pisos',
  roof: 'Techos',
};

export const DEFAULT_CATEGORIES: CategoryInterface[] = [
  { nombre: 'wall', descripcion: 'Materiales para paredes' },
  { nombre: 'door', descripcion: 'Materiales para puertas' },
  { nombre: 'window', descripcion: 'Materiales para ventanas' },
  { nombre: 'floor', descripcion: 'Materiales para pisos' },
  { nombre: 'roof', descripcion: 'Materiales para techos' },
];

/**
 * DEBE coincidir con DEFAULT_PRECIOS de plasma3d_api/presupuesto/seed.py: el
 * backend siembra estos precios solo; aquí se usan para "Restablecer" y como
 * respaldo si el backend no responde.
 *
 * Precios iniciales. Los nombres son los del catálogo de materiales del
 * editor (Propiedades → Visualización 3D), así el presupuesto encuentra el
 * precio del material que tiene asignado cada pieza. El primero de cada
 * categoría es el precio de referencia para materiales sin precio.
 */
export const DEFAULT_MATERIALS: MaterialInterface[] = [
  { categoria: 'wall', nombre: 'Ladrillo rojo', unidad: 'm2', precio_unitario: 15 },
  { categoria: 'wall', nombre: 'Ladrillo blanco', unidad: 'm2', precio_unitario: 17 },
  { categoria: 'wall', nombre: 'Bloque hormigón', unidad: 'm2', precio_unitario: 12 },
  { categoria: 'wall', nombre: 'Piedra natural', unidad: 'm2', precio_unitario: 28 },
  { categoria: 'wall', nombre: 'Cemento', unidad: 'm2', precio_unitario: 10 },
  { categoria: 'wall', nombre: 'Yeso blanco', unidad: 'm2', precio_unitario: 6 },
  { categoria: 'wall', nombre: 'Estuco', unidad: 'm2', precio_unitario: 8 },

  { categoria: 'door', nombre: 'Roble', unidad: 'm2', precio_unitario: 60 },
  { categoria: 'door', nombre: 'Pino', unidad: 'm2', precio_unitario: 40 },
  { categoria: 'door', nombre: 'Nogal', unidad: 'm2', precio_unitario: 75 },
  { categoria: 'door', nombre: 'Acero', unidad: 'm2', precio_unitario: 90 },
  { categoria: 'door', nombre: 'Aluminio', unidad: 'm2', precio_unitario: 70 },

  { categoria: 'window', nombre: 'Vidrio transparente', unidad: 'm2', precio_unitario: 25 },
  { categoria: 'window', nombre: 'Vidrio esmerilado', unidad: 'm2', precio_unitario: 32 },
  { categoria: 'window', nombre: 'Vidrio templado azulado', unidad: 'm2', precio_unitario: 45 },
  { categoria: 'window', nombre: 'Aluminio', unidad: 'm2', precio_unitario: 55 },

  { categoria: 'floor', nombre: 'Ceramica piso', unidad: 'm2', precio_unitario: 12 },
  { categoria: 'floor', nombre: 'Cemento', unidad: 'm2', precio_unitario: 8 },
  { categoria: 'floor', nombre: 'Piedra natural', unidad: 'm2', precio_unitario: 30 },
  { categoria: 'floor', nombre: 'Roble', unidad: 'm2', precio_unitario: 35 },

  { categoria: 'roof', nombre: 'Cemento', unidad: 'm2', precio_unitario: 10 },
  { categoria: 'roof', nombre: 'Terracota', unidad: 'm2', precio_unitario: 18 },
  { categoria: 'roof', nombre: 'Acero', unidad: 'm2', precio_unitario: 22 },
];

/** Clave única de un precio (el mismo material puede estar en varias categorías). */
export function priceKey(m: Pick<MaterialInterface, 'categoria' | 'nombre'>): string {
  return `${String(m.categoria).toLowerCase()}::${m.nombre.toLowerCase()}`;
}
