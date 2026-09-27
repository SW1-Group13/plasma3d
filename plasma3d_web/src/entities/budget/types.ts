export type Categoria = 'wall' | 'door' | 'window';

export type MaterialNombre =
  | 'Ladrillo'
  | 'Madera'
  | 'Vidrio'
  | 'Metal'
  | 'Cemento'
  | 'Piedra'
  | 'Personalizado';

export interface BudgetDetalle {
  material: MaterialNombre | string;
  categoria: Categoria | string;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
  subtotal: number;
}

export interface BudgetResponse {
  total_estimado: number;
  detalle: BudgetDetalle[];
  materiales_no_encontrados: string[];
}
