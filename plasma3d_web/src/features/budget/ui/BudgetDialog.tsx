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

interface BudgetDialogProps {
  open: boolean;
  onClose: () => void;
}

export function BudgetDialog({ open, onClose }: BudgetDialogProps) {
  const { isLoading, total, detalle, noEncontrados, totalWall, totalDoor, totalWindow } =
    useBudgetStore();

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

            <div className="flex items-center justify-between rounded-lg bg-blue-50 px-4 py-3">
              <span className="font-medium text-blue-900">Total estimado</span>
              <span className="text-xl font-bold text-blue-700">${total.toFixed(2)}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-2">Categoria</th>
                    <th className="py-2">Material</th>
                    <th className="py-2 text-right">Cantidad</th>
                    <th className="py-2 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {detalle.map((item, index) => (
                    <tr key={`${item.categoria}-${item.material}-${index}`} className="border-b border-slate-100">
                      <td className="py-2">
                        <Badge>{item.categoria}</Badge>
                      </td>
                      <td className="py-2">{item.material}</td>
                      <td className="py-2 text-right">
                        {item.cantidad.toFixed(2)} {item.unidad}
                      </td>
                      <td className="py-2 text-right">${item.subtotal.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {noEncontrados.length > 0 && (
              <p className="text-sm text-amber-600">
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
    <div className="rounded-lg border border-slate-200 p-3">
      <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <p className="text-lg font-semibold text-slate-800">${value.toFixed(2)}</p>
    </div>
  );
}
