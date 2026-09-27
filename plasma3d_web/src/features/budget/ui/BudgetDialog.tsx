import { useBudgetStore } from '@/entities/budget/store';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Badge } from '@/shared/ui/badge';
import { FullPageSpinner } from '@/shared/ui/spinner';
import { AlertTriangleIcon } from '@/shared/ui/icons';

interface BudgetDialogProps {
  open: boolean;
  onClose: () => void;
}

export function BudgetDialog({ open, onClose }: BudgetDialogProps) {
  const { isLoading, total, detalle, noEncontrados, totalWall, totalDoor, totalWindow } = useBudgetStore();

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Presupuesto estimado</DialogTitle>
          <DialogDescription>Calculo segun los materiales del modelo.</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <FullPageSpinner label="Calculando presupuesto..." />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3">
              <SummaryCard label="Paredes" value={totalWall} />
              <SummaryCard label="Puertas" value={totalDoor} />
              <SummaryCard label="Ventanas" value={totalWindow} />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/10 px-4 py-3">
              <span className="font-medium text-foreground">Total estimado</span>
              <span className="text-xl font-bold tabular-nums text-primary">${total.toFixed(2)}</span>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2/50 text-left text-muted">
                    <th className="px-3 py-2 font-medium">Categoria</th>
                    <th className="px-3 py-2 font-medium">Material</th>
                    <th className="px-3 py-2 text-right font-medium">Cantidad</th>
                    <th className="px-3 py-2 text-right font-medium">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {detalle.map((item, index) => (
                    <tr key={`${item.categoria}-${item.material}-${index}`} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2">
                        <Badge>{item.categoria}</Badge>
                      </td>
                      <td className="px-3 py-2 text-foreground">{item.material}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">
                        {item.cantidad.toFixed(2)} {item.unidad}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">
                        ${item.subtotal.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {noEncontrados.length > 0 && (
              <p className="flex items-center gap-2 text-sm text-warning">
                <AlertTriangleIcon width={15} height={15} />
                Materiales sin precio: {noEncontrados.join(', ')}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/40 p-3">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <p className="text-lg font-semibold tabular-nums text-foreground">${value.toFixed(2)}</p>
    </div>
  );
}
