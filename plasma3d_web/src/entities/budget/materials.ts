export interface CategoryInterface {
  nombre: string;
  descripcion: string;
}

export interface MaterialInterface {
  nombre: string;
  unidad: string;
  precio_unitario: number;
  categoria: string;
}

export interface PostMaterialInterface {
  categorias: CategoryInterface[];
  materiales: MaterialInterface[];
}

export const DEFAULT_CATEGORIES: CategoryInterface[] = [
  { nombre: 'wall', descripcion: 'Materiales para paredes' },
  { nombre: 'door', descripcion: 'Materiales para puertas' },
  { nombre: 'window', descripcion: 'Materiales para ventanas' },
];

export const DEFAULT_MATERIALS: MaterialInterface[] = [
  { nombre: 'Ladrillo', unidad: 'm2', precio_unitario: 15, categoria: 'wall' },
  { nombre: 'Cemento', unidad: 'kg', precio_unitario: 0.5, categoria: 'wall' },
  { nombre: 'Piedra', unidad: 'kg', precio_unitario: 0.5, categoria: 'wall' },
  { nombre: 'Madera tajibo', unidad: 'm3', precio_unitario: 50, categoria: 'door' },
  { nombre: 'Madera ochoo', unidad: 'm3', precio_unitario: 50, categoria: 'door' },
  { nombre: 'Madera roble', unidad: 'm3', precio_unitario: 50, categoria: 'door' },
  { nombre: 'Vidrio simple', unidad: 'm2', precio_unitario: 20, categoria: 'window' },
  { nombre: 'Vidrio escandinavo', unidad: 'm2', precio_unitario: 20, categoria: 'window' },
];
