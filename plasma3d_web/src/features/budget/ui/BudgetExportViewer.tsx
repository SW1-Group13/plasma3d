import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildBudgetCsv, budgetCsvBlob } from '@/features/budget/export/csv';
import { buildBudgetPdf } from '@/features/budget/export/pdf';
import { buildBudgetXlsx } from '@/features/budget/export/xlsx';
import {
  SHEET_COLUMNS,
  cellDisplay,
  sheetLayout,
  type BudgetReport,
  type CellKind,
} from '@/features/budget/export/report';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';
import { Button } from '@/shared/ui/button';
import { Spinner } from '@/shared/ui/spinner';
import { DownloadIcon, FileTextIcon, PrinterIcon, SheetIcon } from '@/shared/ui/icons';
import { cn } from '@/shared/lib/utils';
import { toast } from '@/shared/ui/toast';

export type ExportFormat = 'pdf' | 'xlsx' | 'csv';

const FORMATS: { id: ExportFormat; label: string; ext: string; Icon: typeof FileTextIcon; tone: string }[] = [
  { id: 'pdf', label: 'PDF', ext: 'pdf', Icon: FileTextIcon, tone: 'text-red-400' },
  { id: 'xlsx', label: 'Excel', ext: 'xlsx', Icon: SheetIcon, tone: 'text-emerald-400' },
  { id: 'csv', label: 'CSV', ext: 'csv', Icon: FileTextIcon, tone: 'text-sky-400' },
];

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isSmallScreen(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
}

interface BudgetExportViewerProps {
  open: boolean;
  format: ExportFormat;
  report: BudgetReport | null;
  onFormatChange: (format: ExportFormat) => void;
  onClose: () => void;
}

/** Vista previa a pantalla grande del presupuesto exportado (CU18). */
export function BudgetExportViewer({ open, format, report, onFormatChange, onClose }: BudgetExportViewerProps) {
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [csvAsTable, setCsvAsTable] = useState(false);
  const printFrameRef = useRef<HTMLIFrameElement | null>(null);
  const small = useMemo(isSmallScreen, []);

  const csv = useMemo(() => (report ? buildBudgetCsv(report) : ''), [report]);
  const sheet = useMemo(() => (report ? sheetLayout(report) : []), [report]);

  // El PDF se regenera si cambia el reporte.
  useEffect(() => {
    setPdfBlob(null);
  }, [report]);

  const ensurePdf = useCallback(async (): Promise<Blob | null> => {
    if (!report) return null;
    if (pdfBlob) return pdfBlob;
    const blob = await buildBudgetPdf(report);
    setPdfBlob(blob);
    return blob;
  }, [report, pdfBlob]);

  // Generar el PDF al abrir la pestaña PDF.
  useEffect(() => {
    if (!open || format !== 'pdf' || !report || pdfBlob) return;
    let alive = true;
    setBusy('Generando PDF...');
    buildBudgetPdf(report)
      .then((blob) => alive && setPdfBlob(blob))
      .catch(() => alive && toast.error('Error', 'No se pudo generar el PDF.'))
      .finally(() => alive && setBusy(null));
    return () => {
      alive = false;
    };
  }, [open, format, report, pdfBlob]);

  useEffect(() => {
    if (!pdfBlob) {
      setPdfUrl(null);
      return;
    }
    const url = URL.createObjectURL(pdfBlob);
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pdfBlob]);

  // Al cerrar: quitar el iframe de impresión.
  const removePrintFrame = useCallback(() => {
    const frame = printFrameRef.current;
    if (!frame) return;
    if (frame.dataset.url) URL.revokeObjectURL(frame.dataset.url);
    frame.remove();
    printFrameRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) removePrintFrame();
  }, [open, removePrintFrame]);

  async function onDownload() {
    if (!report) return;
    const current = FORMATS.find((f) => f.id === format)!;
    const filename = `${report.archivo}.${current.ext}`;
    setBusy(`Preparando ${current.label}...`);
    try {
      let blob: Blob | null = null;
      if (format === 'pdf') blob = await ensurePdf();
      else if (format === 'xlsx') blob = await buildBudgetXlsx(report);
      else blob = budgetCsvBlob(csv);
      if (blob) {
        downloadBlob(blob, filename);
        toast.success('Descarga lista', filename);
      }
    } catch {
      toast.error('Error', `No se pudo generar el ${current.label}.`);
    } finally {
      setBusy(null);
    }
  }

  async function onPrint() {
    setBusy('Preparando impresión...');
    try {
      const blob = await ensurePdf();
      if (!blob) return;
      removePrintFrame();
      const frame = document.createElement('iframe');
      frame.style.position = 'fixed';
      frame.style.width = '0';
      frame.style.height = '0';
      frame.style.border = '0';
      frame.style.right = '0';
      frame.style.bottom = '0';
      const url = URL.createObjectURL(blob);
      frame.onload = () => {
        setTimeout(() => {
          try {
            frame.contentWindow?.focus();
            frame.contentWindow?.print();
          } catch {
            window.open(url, '_blank', 'noopener');
          }
        }, 150);
      };
      frame.src = url;
      frame.dataset.url = url;
      document.body.appendChild(frame);
      printFrameRef.current = frame;
    } catch {
      toast.error('Error', 'No se pudo preparar la impresión.');
    } finally {
      setBusy(null);
    }
  }

  const active = FORMATS.find((f) => f.id === format)!;

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="flex h-[94vh] w-[97vw] max-w-none flex-col gap-0 overflow-hidden p-0 sm:h-[92vh] sm:w-[94vw]">
        {/* Barra superior: formato, acciones */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 pr-14">
          <div className="mr-2 min-w-0">
            <DialogTitle className="truncate text-base">{report?.titulo ?? 'Presupuesto'}</DialogTitle>
            <DialogDescription className="truncate text-xs">
              Vista previa · {report?.fechaTexto}
            </DialogDescription>
          </div>

          <div role="tablist" aria-label="Formato" className="flex rounded-lg border border-border bg-surface-2/50 p-0.5">
            {FORMATS.map(({ id, label, Icon, tone }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={format === id}
                onClick={() => onFormatChange(id)}
                className={cn(
                  'inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70',
                  format === id ? 'bg-surface text-foreground shadow-sm' : 'text-muted hover:text-foreground',
                )}
              >
                <Icon width={14} height={14} className={tone} /> {label}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {busy && (
              <span className="hidden items-center gap-2 text-xs text-muted sm:inline-flex">
                <Spinner className="h-4 w-4" /> {busy}
              </span>
            )}
            <Button size="sm" variant="outline" onClick={onPrint} disabled={!report || !!busy}>
              <PrinterIcon width={15} height={15} /> Imprimir
            </Button>
            <Button size="sm" onClick={onDownload} disabled={!report || !!busy}>
              <DownloadIcon width={15} height={15} /> Descargar .{active.ext}
            </Button>
          </div>
        </div>

        {/* Vista previa */}
        <div className="min-h-0 flex-1 overflow-auto bg-canvas">
          {!report ? null : format === 'pdf' ? (
            pdfUrl && !small ? (
              <iframe title="Vista previa del PDF" src={pdfUrl} className="h-full w-full border-0 bg-white" />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted">
                {pdfUrl ? (
                  <>
                    <FileTextIcon width={40} height={40} className="text-red-400" />
                    <p>Tu navegador no muestra PDFs dentro de la página.</p>
                    <Button onClick={() => window.open(pdfUrl, '_blank', 'noopener')}>Abrir PDF</Button>
                  </>
                ) : (
                  <>
                    <Spinner className="h-6 w-6 text-primary" /> Generando PDF...
                  </>
                )}
              </div>
            )
          ) : format === 'xlsx' ? (
            <SheetPreview rows={sheet} />
          ) : (
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs text-muted">
                <span>
                  {report.archivo}.csv · separador «;» · decimales con coma · UTF-8
                </span>
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={csvAsTable} onChange={(e) => setCsvAsTable(e.target.checked)} />
                  Ver como tabla
                </label>
              </div>
              {csvAsTable ? (
                <CsvTable csv={csv} />
              ) : (
                <pre className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-foreground">{csv}</pre>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const KIND_CLASS: Record<CellKind, string> = {
  title: 'font-bold text-[15px] text-slate-800',
  label: 'font-semibold text-slate-500',
  text: 'text-slate-800',
  header: 'bg-[#4f7cff] font-semibold text-white',
  int: 'text-right tabular-nums text-slate-800',
  number: 'text-right tabular-nums text-slate-800',
  money: 'text-right tabular-nums text-slate-800',
  total: 'text-right font-bold tabular-nums text-[#4f7cff]',
  warn: 'text-amber-700',
  muted: 'italic text-slate-500',
};

/** Vista tipo hoja de cálculo: mismas celdas que el .xlsx (columnas A–G). */
function SheetPreview({ rows }: { rows: ReturnType<typeof sheetLayout> }) {
  const letters = SHEET_COLUMNS.map((_, i) => String.fromCharCode(65 + i));
  return (
    <div className="min-h-full bg-white p-3">
      <table className="border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky top-0 w-10 border border-slate-300 bg-slate-100 text-slate-500" />
            {letters.map((letter) => (
              <th
                key={letter}
                className="sticky top-0 min-w-[90px] border border-slate-300 bg-slate-100 px-2 py-1 font-medium text-slate-500"
              >
                {letter}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => {
            // Textos largos (título, notas) ocupan toda la fila, como en Excel.
            const spans = row.cells.length === 1;
            return (
              <tr key={r} className={row.estimado ? 'bg-amber-50' : undefined}>
                <td className="border border-slate-300 bg-slate-100 px-1 text-center text-slate-500">{r + 1}</td>
                {spans ? (
                  <td colSpan={letters.length} className={cn('whitespace-nowrap border border-slate-200 px-2 py-1', KIND_CLASS[row.cells[0]!.kind])}>
                    {cellDisplay(row.cells[0])}
                  </td>
                ) : (
                  letters.map((letter, c) => {
                    const cell = row.cells[c] ?? null;
                    return (
                      <td
                        key={letter}
                        title={cell?.formula ? `=${cell.formula}` : undefined}
                        className={cn('whitespace-nowrap border border-slate-200 px-2 py-1', cell && KIND_CLASS[cell.kind])}
                      >
                        {cellDisplay(cell)}
                      </td>
                    );
                  })
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** El CSV leído como tabla (para revisar las columnas). */
function CsvTable({ csv }: { csv: string }) {
  const rows = useMemo(
    () =>
      csv.split('\r\n').map((line) => {
        const cells: string[] = [];
        let current = '';
        let quoted = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (quoted) {
            if (ch === '"' && line[i + 1] === '"') {
              current += '"';
              i++;
            } else if (ch === '"') quoted = false;
            else current += ch;
          } else if (ch === '"') quoted = true;
          else if (ch === ';') {
            cells.push(current);
            current = '';
          } else current += ch;
        }
        cells.push(current);
        return cells;
      }),
    [csv],
  );
  const width = Math.max(...rows.map((r) => r.length));
  return (
    <div className="flex-1 overflow-auto p-4">
      <table className="border-collapse text-xs">
        <tbody>
          {rows.map((cells, r) => (
            <tr key={r}>
              {Array.from({ length: width }, (_, c) => (
                <td key={c} className="whitespace-nowrap border border-border px-2 py-1 text-foreground">
                  {cells[c] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
