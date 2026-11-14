import { useBudgetStore } from '@/entities/budget/store';
import { CATEGORY_LABELS, PRICE_UNITS } from '@/entities/budget/materials';
import type { Categoria } from '@/entities/budget/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { FullPageSpinner } from '@/shared/ui/spinner';
import { AlertTriangleIcon, TagIcon } from '@/shared/ui/icons';

interface BudgetDialogProps {
  open: boolean;
  onClose: () => void;
  /** Abre la ventana de Precios (para cargar o corregir precios). */
  onOpenPrices?: () => void;
}

const CATEGORY_ORDER: Categoria[] = ['wall', 'door', 'window', 'floor', 'roof'];

function money(value: number): string {
  return `$${value.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function qty(value: number): string {
  return value.toLocaleString('es', { maximumFractionDigits: 2 });
}

function unitLabel(unit: string): string {
  return PRICE_UNITS.find((u) => u.id === unit)?.label ?? unit;
}

function categoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat as Categoria] ?? cat;
}

export function BudgetDialog({ open, onClose, onOpenPrices }: BudgetDialogProps) {
  const { isLoading, total, detalle, noEncontrados, totales, sinPrecio } = useBudgetStore();
  const noPrices = !isLoading && detalle.length === 0 && noEncontrados.length > 0;

  function openPrices() {
    onClose();
    onOpenPrices?.();
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Presupuesto estimado</DialogTitle>
          <DialogDescription>
            Materiales asignados a cada pieza del modelo × sus medidas reales × el precio de la ventana Precios.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <FullPageSpinner label="Calculando presupuesto..." />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {CATEGORY_ORDER.map((cat) => (
                <SummaryCard
                  key={cat}
                  label={CATEGORY_LABELS[cat]}
                  value={totales[cat] ?? 0}
                  missing={sinPrecio.includes(cat)}
                  onFix={onOpenPrices ? openPrices : undefined}
                />
              ))}
            </div>

            <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/10 px-4 py-3">
              <span className="font-medium text-foreground">Total estimado</span>
              <span className="text-xl font-bold tabular-nums text-primary">{money(total)}</span>
            </div>

            {noPrices ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-6 text-center">
                <p className="text-sm text-muted">Todavía no hay precios cargados para los materiales del modelo.</p>
                {onOpenPrices && (
                  <Button onClick={openPrices}>
                    <TagIcon width={15} height={15} /> Cargar precios
                  </Button>
                )}
              </div>
            ) : (
              <div className="max-h-[45vh] overflow-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-border text-left text-muted">
                      <th className="px-3 py-2 font-medium">Categoría</th>
                      <th className="px-3 py-2 font-medium">Material</th>
                      <th className="px-3 py-2 text-right font-medium">Piezas</th>
                      <th className="px-3 py-2 text-right font-medium">Cantidad</th>
                      <th className="px-3 py-2 text-right font-medium">Precio</th>
                      <th className="px-3 py-2 text-right font-medium">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.map((item) => {
                      const unit = unitLabel(item.unidad);
                      return (
                        <tr
                          key={`${item.categoria}-${item.material}-${item.estimado}`}
                          className="border-b border-border/60 last:border-0"
                        >
                          <td className="px-3 py-2">
                            <Badge>{categoryLabel(item.categoria)}</Badge>
                          </td>
                          <td className="px-3 py-2 text-foreground">
                            <span className="inline-flex items-center gap-1.5">
                              {item.material}
                              {item.estimado && (
                                <span
                                  className="text-warning"
                                  title={`Sin precio propio: se usó el de ${item.precio_de ?? 'referencia'}. Agrégalo en Precios.`}
                                >
                                  <AlertTriangleIcon width={13} height={13} />
                                </span>
                              )}
                            </span>
                            {item.estimado && item.precio_de && (
                              <span className="block text-[11px] text-warning">precio de {item.precio_de}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted">{item.piezas}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted">
                            {qty(item.cantidad)} {unit}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted">
                            {money(item.precio_unitario)}/{unit}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-foreground">
                            {money(item.subtotal)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {noEncontrados.length > 0 && !noPrices && (
              <div className="flex flex-col gap-1 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                <p className="flex items-center gap-2 font-medium">
                  <AlertTriangleIcon width={14} height={14} />
                  Sin precio propio (se estimó con el precio de referencia de su categoría):
                </p>
                <ul className="ml-6 list-disc">
                  {noEncontrados.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
                {onOpenPrices && (
                  <button
                    type="button"
                    onClick={openPrices}
                    className="mt-1 self-start cursor-pointer font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                  >
                    Agregar precios
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SummaryCard({
  label,
  value,
  missing = false,
  onFix,
}: {
  label: string;
  value: number;
  /** Hay piezas de esta categoría pero ningún precio cargado. */
  missing?: boolean;
  onFix?: () => void;
}) {
  return (
    <div
      className={
        missing
          ? 'rounded-lg border border-warning/40 bg-warning/10 p-3'
          : 'rounded-lg border border-border bg-surface-2/40 p-3'
      }
    >
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      {missing ? (
        <p className="flex items-center gap-1.5 text-sm font-semibold text-warning">
          Sin precio
          {onFix && (
            <button
              type="button"
              onClick={onFix}
              className="cursor-pointer text-xs font-normal underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
            >
              cargar
            </button>
          )}
        </p>
      ) : (
        <p className="text-base font-semibold tabular-nums text-foreground">{money(value)}</p>
      )}
    </div>
  );
}
