import { sheetLayout, type BudgetReport, type SheetCell } from '@/features/budget/export/report';

/**
 * CSV para Excel en español: separador ";" y decimales con coma, UTF-8 con
 * BOM (tildes, ñ y m² se ven bien). Mismas filas que la hoja de Excel.
 */
const SEPARATOR = ';';
const BOM = '﻿';

function numberText(value: number, decimals: number): string {
  return value.toFixed(decimals).replace('.', ',');
}

function escape(text: string): string {
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function cellText(cell: SheetCell | null): string {
  if (!cell) return '';
  if (typeof cell.value === 'string') return escape(cell.value);
  return cell.kind === 'int' ? String(cell.value) : numberText(cell.value, 2);
}

/** Contenido del CSV (sin BOM: para mostrarlo en la vista previa). */
export function buildBudgetCsv(report: BudgetReport): string {
  return sheetLayout(report)
    .map((row) => {
      const cells = row.cells.map(cellText);
      while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
      return cells.join(SEPARATOR);
    })
    .join('\r\n');
}

export function budgetCsvBlob(csv: string): Blob {
  return new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' });
}
