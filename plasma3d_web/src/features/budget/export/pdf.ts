import { money, qty, type BudgetReport } from '@/features/budget/export/report';

type RGB = [number, number, number];
const BRAND: RGB = [79, 124, 255];
const DARK: RGB = [15, 23, 42];
const MUTED: RGB = [100, 116, 139];
const BORDER: RGB = [226, 232, 240];
const WARN: RGB = [180, 83, 9];
const WARN_FILL: RGB = [255, 244, 204];

/** Las fuentes estándar del PDF solo cubren Latin-1: guion y viñeta simples. */
function pdfText(text: string): string {
  return text.replace(/[–—]/g, '-').replace(/•/g, '-');
}

/**
 * Genera el PDF (A4 vertical) con jsPDF + jspdf-autotable, cargados solo al
 * exportar.
 */
export async function buildBudgetPdf(report: BudgetReport): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;

  doc.setProperties({ title: pdfText(report.titulo), author: 'Plasma3D', creator: 'Plasma3D' });

  // --- Encabezado ---
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, pageWidth, 26, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('PLASMA3D', margin, 9);
  doc.setFontSize(16);
  doc.text(pdfText(report.titulo), margin, 18);

  // --- Datos del plano ---
  let y = 34;
  doc.setFontSize(9);
  const meta: [string, string][] = [
    ['Fecha', report.fechaTexto],
    ['Usuario', report.usuario.email ? `${report.usuario.nombre} (${report.usuario.email})` : report.usuario.nombre],
    ['Moneda', report.moneda],
  ];
  meta.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...MUTED);
    doc.text(label, margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...DARK);
    doc.text(pdfText(value || '-'), margin + 20, y);
    y += 5;
  });

  // --- Tarjetas de resumen por categoría ---
  y += 3;
  const gap = 3;
  const cardWidth = (contentWidth - gap * (report.resumen.length - 1)) / report.resumen.length;
  report.resumen.forEach((item, i) => {
    const x = margin + i * (cardWidth + gap);
    if (item.sinPrecio) doc.setFillColor(...WARN_FILL);
    else doc.setFillColor(248, 250, 252);
    doc.setDrawColor(...(item.sinPrecio ? WARN : BORDER));
    doc.roundedRect(x, y, cardWidth, 16, 2, 2, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(item.categoria.toUpperCase(), x + 3, y + 5.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...(item.sinPrecio ? WARN : DARK));
    doc.text(item.sinPrecio ? 'Sin precio' : money(item.total), x + 3, y + 12);
  });
  y += 21;

  // --- Total ---
  doc.setFillColor(238, 242, 255);
  doc.setDrawColor(...BRAND);
  doc.roundedRect(margin, y, contentWidth, 12, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...DARK);
  doc.text('Total estimado', margin + 4, y + 7.8);
  doc.setFontSize(14);
  doc.setTextColor(...BRAND);
  doc.text(money(report.total), margin + contentWidth - 4, y + 8, { align: 'right' });
  y += 18;

  // --- Detalle ---
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin, bottom: 18 },
    head: [['Categoría', 'Material', 'Piezas', 'Cantidad', 'Precio', 'Subtotal']],
    body: report.filas.map((fila) => [
      fila.categoria,
      pdfText(fila.nota ? `${fila.material}\n(${fila.nota})` : fila.material),
      String(fila.piezas),
      `${qty(fila.cantidad)} ${fila.unidad}`,
      `${money(fila.precio)}/${fila.unidad}`,
      money(fila.subtotal),
    ]),
    foot: [['', '', '', '', 'Total', money(report.total)]],
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.4, textColor: DARK, lineColor: BORDER, lineWidth: 0.2 },
    headStyles: { fillColor: BRAND, textColor: [255, 255, 255], fontStyle: 'bold' },
    footStyles: { fillColor: [238, 242, 255], textColor: BRAND, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 24 },
      2: { halign: 'right', cellWidth: 16 },
      3: { halign: 'right', cellWidth: 28 },
      4: { halign: 'right', cellWidth: 30 },
      5: { halign: 'right', cellWidth: 28, fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      if (data.section === 'head' && data.column.index >= 2) data.cell.styles.halign = 'right';
      if (data.section === 'foot' && data.column.index >= 4) data.cell.styles.halign = 'right';
      if (data.section === 'body' && report.filas[data.row.index]?.estimado) {
        data.cell.styles.fillColor = WARN_FILL;
      }
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 20) {
      doc.addPage();
      y = 20;
    }
  };

  // --- Avisos ---
  if (report.avisos.length > 0) {
    ensureSpace(10);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...WARN);
    doc.text('Sin precio propio (se estimó con el precio de referencia de su categoría):', margin, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    report.avisos.forEach((aviso) => {
      const lines = doc.splitTextToSize(`- ${pdfText(aviso)}`, contentWidth - 4) as string[];
      ensureSpace(lines.length * 4.5);
      doc.text(lines, margin + 2, y);
      y += lines.length * 4.5;
    });
    y += 3;
  }

  // --- Nota ---
  ensureSpace(10);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(doc.splitTextToSize(pdfText(report.nota), contentWidth) as string[], margin, y);

  // --- Pie de página ---
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setDrawColor(...BORDER);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(pdfText(`Plasma3D - ${report.titulo}`), margin, pageHeight - 7);
    doc.text(`Página ${page} de ${pages}`, pageWidth - margin, pageHeight - 7, { align: 'right' });
  }

  return doc.output('blob');
}
