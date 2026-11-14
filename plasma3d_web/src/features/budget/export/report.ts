import { CATEGORY_LABELS, PRICE_UNITS } from '@/entities/budget/materials';
import type { BudgetDetalle, Categoria } from '@/entities/budget/types';

/**
 * Reporte de presupuesto normalizado. Es la ÚNICA fuente de datos del
 * diálogo exportado: PDF, Excel, CSV y sus vistas previas salen de aquí,
 * así los tres formatos muestran exactamente los mismos números.
 */

export const CATEGORY_ORDER: Categoria[] = ['wall', 'door', 'window', 'floor', 'roof'];

export function money(value: number): string {
  return `$${value.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function qty(value: number): string {
  return value.toLocaleString('es', { maximumFractionDigits: 2 });
}

export function unitLabel(unit: string): string {
  return PRICE_UNITS.find((u) => u.id === unit)?.label ?? unit;
}

export function categoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat as Categoria] ?? cat;
}

export interface ReportRow {
  categoria: string;
  material: string;
  /** "precio de X" cuando el material no tenía precio propio. */
  nota: string;
  piezas: number;
  cantidad: number;
  unidad: string;
  precio: number;
  subtotal: number;
  estimado: boolean;
}

export interface ReportSummary {
  categoria: string;
  total: number;
  /** Hay piezas de la categoría pero ningún precio cargado. */
  sinPrecio: boolean;
}

export interface BudgetReport {
  titulo: string;
  planoId: string;
  fecha: Date;
  fechaTexto: string;
  usuario: { nombre: string; email: string };
  moneda: string;
  resumen: ReportSummary[];
  filas: ReportRow[];
  total: number;
  avisos: string[];
  nota: string;
  /** Nombre de archivo sin extensión. */
  archivo: string;
}

export interface BudgetReportInput {
  total: number;
  detalle: BudgetDetalle[];
  totales: Record<Categoria, number>;
  sinPrecio: string[];
  noEncontrados: string[];
  planoId: string | number | null;
  usuario: { nombre?: string; email?: string } | null;
  fecha?: Date;
}

/** Id del plano abierto en el editor (se guarda en localStorage al abrirlo). */
export function currentPlanId(): string | null {
  try {
    const id = JSON.parse(localStorage.getItem('modelo') || '{}').id;
    return id == null ? null : String(id);
  } catch {
    return null;
  }
}

function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function buildBudgetReport(input: BudgetReportInput): BudgetReport {
  const fecha = input.fecha ?? new Date();
  const planoId = input.planoId == null ? '' : String(input.planoId);

  const filas: ReportRow[] = input.detalle.map((item) => ({
    categoria: categoryLabel(String(item.categoria)),
    material: item.material,
    nota: item.estimado ? `precio de ${item.precio_de ?? 'referencia'}` : '',
    piezas: item.piezas,
    cantidad: item.cantidad,
    unidad: unitLabel(item.unidad),
    precio: item.precio_unitario,
    subtotal: item.subtotal,
    estimado: item.estimado,
  }));

  const resumen: ReportSummary[] = CATEGORY_ORDER.map((cat) => ({
    categoria: CATEGORY_LABELS[cat],
    total: input.totales[cat] ?? 0,
    sinPrecio: input.sinPrecio.includes(cat),
  }));

  return {
    titulo: planoId ? `Presupuesto estimado – Plano #${planoId}` : 'Presupuesto estimado',
    planoId,
    fecha,
    fechaTexto: fecha.toLocaleString('es', { dateStyle: 'long', timeStyle: 'short' }),
    usuario: { nombre: input.usuario?.nombre ?? '', email: input.usuario?.email ?? '' },
    moneda: 'USD',
    resumen,
    filas,
    total: input.total,
    avisos: input.noEncontrados,
    nota:
      'Estimación: materiales asignados a cada pieza del modelo × sus medidas reales × el precio cargado en Precios.',
    archivo: `presupuesto_plano-${planoId || 'sin-id'}_${isoDate(fecha)}`,
  };
}

// ---------------------------------------------------------------------------
// Diseño de hoja (lo usan el .xlsx, su vista previa y el .csv)
// ---------------------------------------------------------------------------

export type CellKind = 'title' | 'label' | 'text' | 'header' | 'int' | 'number' | 'money' | 'total' | 'warn' | 'muted';

export interface SheetCell {
  value: string | number;
  kind: CellKind;
  /** Fórmula de Excel (sin "="); `value` es su resultado. */
  formula?: string;
}

export interface SheetRow {
  cells: (SheetCell | null)[];
  /** Fila de un material con precio estimado (se resalta en amarillo). */
  estimado?: boolean;
}

export const SHEET_COLUMNS = ['Categoría', 'Material', 'Piezas', 'Cantidad', 'Unidad', 'Precio unitario', 'Subtotal'];
export const SHEET_WIDTHS = [14, 34, 9, 12, 9, 16, 16];

const col = (index: number) => String.fromCharCode(65 + index);

/** Filas de la hoja "Presupuesto" (columnas A–G). */
export function sheetLayout(report: BudgetReport): SheetRow[] {
  const rows: SheetRow[] = [];
  const blank = (): SheetRow => ({ cells: [] });
  const text = (value: string, kind: CellKind = 'text'): SheetCell => ({ value, kind });

  rows.push({ cells: [text(report.titulo, 'title')] });
  rows.push({ cells: [text('Fecha', 'label'), text(report.fechaTexto)] });
  rows.push({
    cells: [
      text('Usuario', 'label'),
      text(report.usuario.email ? `${report.usuario.nombre} (${report.usuario.email})` : report.usuario.nombre),
    ],
  });
  rows.push({ cells: [text('Moneda', 'label'), text(report.moneda)] });
  rows.push(blank());

  rows.push({ cells: SHEET_COLUMNS.map((name) => text(name, 'header')) });
  const firstDetail = rows.length + 1; // filas de Excel empiezan en 1
  report.filas.forEach((fila) => {
    const r = rows.length + 1;
    rows.push({
      estimado: fila.estimado,
      cells: [
        text(fila.categoria),
        text(fila.nota ? `${fila.material} (${fila.nota})` : fila.material),
        { value: fila.piezas, kind: 'int' },
        { value: fila.cantidad, kind: 'number' },
        text(fila.unidad),
        { value: fila.precio, kind: 'money' },
        { value: fila.subtotal, kind: 'money', formula: `${col(3)}${r}*${col(5)}${r}` },
      ],
    });
  });
  const lastDetail = rows.length;

  rows.push({
    cells: [
      null,
      null,
      null,
      null,
      null,
      text('Total estimado', 'total'),
      {
        value: report.total,
        kind: 'total',
        formula: report.filas.length > 0 ? `SUM(${col(6)}${firstDetail}:${col(6)}${lastDetail})` : undefined,
      },
    ],
  });
  rows.push(blank());

  rows.push({ cells: [text('Resumen por categoría', 'header'), text('Total', 'header')] });
  report.resumen.forEach((item) => {
    rows.push({
      cells: [
        text(item.categoria),
        item.sinPrecio ? text('Sin precio', 'warn') : { value: item.total, kind: 'money' },
      ],
    });
  });

  if (report.avisos.length > 0) {
    rows.push(blank());
    rows.push({ cells: [text('Sin precio propio (se estimó con el precio de referencia de su categoría):', 'warn')] });
    report.avisos.forEach((aviso) => rows.push({ cells: [text(`• ${aviso}`, 'warn')] }));
  }

  rows.push(blank());
  rows.push({ cells: [text(report.nota, 'muted')] });
  return rows;
}

/** Texto de una celda tal como se ve en la vista previa (formato es). */
export function cellDisplay(cell: SheetCell | null): string {
  if (!cell) return '';
  if (typeof cell.value === 'string') return cell.value;
  switch (cell.kind) {
    case 'int':
      return String(cell.value);
    case 'number':
      return qty(cell.value);
    default:
      return money(cell.value);
  }
}
