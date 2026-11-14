import {
  SHEET_WIDTHS,
  sheetLayout,
  type BudgetReport,
  type CellKind,
} from '@/features/budget/export/report';

const BRAND = 'FF4F7CFF';
const ESTIMATED_FILL = 'FFFFF4CC';
const MONEY_FORMAT = '"$"#,##0.00';
const NUMBER_FORMAT = '#,##0.00';

/**
 * Genera el .xlsx con ExcelJS (se carga solo al exportar). El subtotal y el
 * total son fórmulas, así el archivo sigue siendo editable.
 */
export async function buildBudgetXlsx(report: BudgetReport): Promise<Blob> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Plasma3D';
  workbook.created = report.fecha;

  // --- Hoja principal ---
  const sheet = workbook.addWorksheet('Presupuesto', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.columns = SHEET_WIDTHS.map((width) => ({ width }));

  const styleFor = (kind: CellKind) => {
    switch (kind) {
      case 'title':
        return { font: { bold: true, size: 15, color: { argb: 'FF1E293B' } } };
      case 'label':
        return { font: { bold: true, color: { argb: 'FF475569' } } };
      case 'header':
        return {
          font: { bold: true, color: { argb: 'FFFFFFFF' } },
          fill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: BRAND } },
        };
      case 'total':
        return { font: { bold: true, size: 12, color: { argb: BRAND } } };
      case 'warn':
        return { font: { color: { argb: 'FFB45309' } } };
      case 'muted':
        return { font: { italic: true, color: { argb: 'FF64748B' } } };
      default:
        return {};
    }
  };

  sheetLayout(report).forEach((row, index) => {
    const excelRow = sheet.getRow(index + 1);
    row.cells.forEach((cell, c) => {
      if (!cell) return;
      const target = excelRow.getCell(c + 1);
      target.value = cell.formula ? { formula: cell.formula, result: cell.value } : cell.value;
      Object.assign(target, styleFor(cell.kind));
      if (cell.kind === 'money' || (cell.kind === 'total' && typeof cell.value === 'number')) target.numFmt = MONEY_FORMAT;
      else if (cell.kind === 'number') target.numFmt = NUMBER_FORMAT;
      if (typeof cell.value === 'number') target.alignment = { horizontal: 'right' };
      if (row.estimado) {
        target.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ESTIMATED_FILL } };
      }
    });
    if (row.cells[0]?.kind === 'title') excelRow.height = 22;
  });

  // --- Hoja de resumen ---
  const summary = workbook.addWorksheet('Resumen');
  summary.columns = [{ width: 20 }, { width: 18 }];
  summary.addRow([report.titulo]).getCell(1).font = { bold: true, size: 13 };
  summary.addRow([]);
  const header = summary.addRow(['Categoría', 'Total']);
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
  });
  const first = summary.rowCount + 1;
  report.resumen.forEach((item) => {
    const row = summary.addRow([item.categoria, item.sinPrecio ? 'Sin precio' : item.total]);
    const value = row.getCell(2);
    if (item.sinPrecio) value.font = { color: { argb: 'FFB45309' } };
    else value.numFmt = MONEY_FORMAT;
  });
  const last = summary.rowCount;
  const total = summary.addRow(['Total estimado', { formula: `SUM(B${first}:B${last})`, result: report.total }]);
  total.font = { bold: true };
  total.getCell(2).numFmt = MONEY_FORMAT;

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
