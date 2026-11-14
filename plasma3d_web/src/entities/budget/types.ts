export type Categoria = 'wall' | 'door' | 'window' | 'floor' | 'roof';

export type MaterialNombre = string;

/** Una fila del presupuesto: un material dentro de una categoría. */
export interface BudgetDetalle {
  material: MaterialNombre;
  categoria: Categoria | string;
  /** Cantidad de piezas del modelo con ese material. */
  piezas: number;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
  subtotal: number;
  /** true: el material no tenía precio y se usó el de referencia de la categoría. */
  estimado: boolean;
  /** Material cuyo precio se usó cuando `estimado` es true. */
  precio_de: string | null;
}

export interface BudgetResponse {
  total_estimado: number;
  totales_por_categoria: Partial<Record<Categoria, number>>;
  /** Categorías con piezas en el modelo pero sin ningún precio cargado. */
  categorias_sin_precio?: string[];
  detalle: BudgetDetalle[];
  materiales_no_encontrados: string[];
}
