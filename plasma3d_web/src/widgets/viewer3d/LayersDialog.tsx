import { useLayerStore } from '@/entities/layers/store';
import type { LineType } from '@/entities/layers/types';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { LayersIcon, PlusIcon, TrashIcon } from '@/shared/ui/icons';
import { cn } from '@/shared/lib/utils';

const LINE_TYPES: LineType[] = ['continuous', 'dashed', 'dotted', 'dashdot'];

interface LayersDialogProps {
  open: boolean;
  onClose: () => void;
}

export function LayersDialog({ open, onClose }: LayersDialogProps) {
  const layers = useLayerStore((s) => s.layers);
  const currentLayerId = useLayerStore((s) => s.currentLayerId);
  const addLayer = useLayerStore((s) => s.addLayer);
  const removeLayer = useLayerStore((s) => s.removeLayer);
  const updateLayer = useLayerStore((s) => s.updateLayer);
  const setCurrent = useLayerStore((s) => s.setCurrent);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayersIcon width={18} height={18} className="text-accent" /> Capas
          </DialogTitle>
          <DialogDescription>
            Cada elemento pertenece a una capa. La capa actual recibe los elementos nuevos.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2/50 text-left text-xs text-muted">
                <th className="px-2 py-2 font-medium">Actual</th>
                <th className="px-2 py-2 font-medium">Nombre</th>
                <th className="px-2 py-2 text-center font-medium">On</th>
                <th className="px-2 py-2 text-center font-medium">Lock</th>
                <th className="px-2 py-2 text-center font-medium">Freeze</th>
                <th className="px-2 py-2 font-medium">Color</th>
                <th className="px-2 py-2 font-medium">Tipo línea</th>
                <th className="px-2 py-2 font-medium">Grosor</th>
                <th className="px-2 py-2 font-medium">Transp.</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {layers.map((layer) => (
                <tr key={layer.id} className="border-b border-border/60 last:border-0">
                  <td className="px-2 py-2">
                    <input
                      type="radio"
                      name="current-layer"
                      checked={currentLayerId === layer.id}
                      onChange={() => setCurrent(layer.id)}
                      aria-label={`Establecer ${layer.nombre} como capa actual`}
                      className="accent-[var(--color-primary)]"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={layer.nombre}
                      onChange={(e) => updateLayer(layer.id, { nombre: e.target.value })}
                      className="w-32 rounded border border-transparent bg-transparent px-1 py-0.5 text-foreground hover:border-border focus:border-primary focus:outline-none"
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={layer.visible}
                      onChange={(e) => updateLayer(layer.id, { visible: e.target.checked })}
                      aria-label="Visible"
                      className="accent-[var(--color-primary)]"
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={layer.bloqueada}
                      onChange={(e) => updateLayer(layer.id, { bloqueada: e.target.checked })}
                      aria-label="Bloqueada"
                      className="accent-[var(--color-primary)]"
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={layer.congelada}
                      onChange={(e) => updateLayer(layer.id, { congelada: e.target.checked })}
                      aria-label="Congelada"
                      className="accent-[var(--color-primary)]"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="color"
                      value={layer.color}
                      onChange={(e) => updateLayer(layer.id, { color: e.target.value })}
                      className="h-7 w-10 cursor-pointer rounded border border-border bg-surface-2"
                      aria-label="Color de capa"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={layer.tipoLinea}
                      onChange={(e) => updateLayer(layer.id, { tipoLinea: e.target.value as LineType })}
                      className="rounded border border-border bg-surface-2 px-1 py-1 text-xs text-foreground"
                    >
                      {LINE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={layer.grosorLinea}
                      onChange={(e) => updateLayer(layer.id, { grosorLinea: Number(e.target.value) })}
                      className="w-16 rounded border border-border bg-surface-2 px-1 py-1 text-xs tabular-nums text-foreground"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={layer.transparencia}
                      onChange={(e) => updateLayer(layer.id, { transparencia: Number(e.target.value) })}
                      className="w-14 rounded border border-border bg-surface-2 px-1 py-1 text-xs tabular-nums text-foreground"
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      onClick={() => removeLayer(layer.id)}
                      disabled={layer.id === 'layer-0'}
                      title="Eliminar capa"
                      className={cn(
                        'rounded p-1 text-muted transition-colors hover:bg-danger/15 hover:text-danger disabled:opacity-30',
                        layer.id === 'layer-0' && 'cursor-not-allowed',
                      )}
                    >
                      <TrashIcon width={15} height={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-between">
          <Button variant="outline" size="sm" onClick={() => addLayer()}>
            <PlusIcon width={15} height={15} /> Nueva capa
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
