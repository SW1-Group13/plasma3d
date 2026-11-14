import { useEffect, useState } from 'react';
import axios from 'axios';
import {
  CATEGORY_LABELS,
  DEFAULT_CATEGORIES,
  DEFAULT_MATERIALS,
  PRICE_UNITS,
  priceKey,
  type MaterialInterface,
} from '@/entities/budget/materials';
import type { Categoria } from '@/entities/budget/types';
import { budgetApi } from '@/entities/budget/api';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Spinner } from '@/shared/ui/spinner';
import { toast } from '@/shared/ui/toast';

interface PricesDialogProps {
  open: boolean;
  onClose: () => void;
}

const CATEGORY_ORDER: Categoria[] = ['wall', 'door', 'window', 'floor', 'roof'];

function cloneDefaults(): MaterialInterface[] {
  return DEFAULT_MATERIALS.map((m) => ({ ...m }));
}

/** Precios por defecto con lo guardado encima (lo guardado gana). */
function mergeWithSaved(saved: MaterialInterface[]): MaterialInterface[] {
  const byKey = new Map(saved.map((m) => [priceKey(m), m]));
  return DEFAULT_MATERIALS.map((def) => {
    const stored = byKey.get(priceKey(def));
    return stored
      ? { ...def, unidad: stored.unidad || def.unidad, precio_unitario: Number(stored.precio_unitario) }
      : { ...def };
  });
}

export function PricesDialog({ open, onClose }: PricesDialogProps) {
  const [materials, setMaterials] = useState<MaterialInterface[]>(cloneDefaults);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Al abrir: traer los precios guardados para editarlos (no los por defecto).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setIsLoading(true);
    budgetApi
      .listMaterials()
      .then((saved) => !cancelled && setMaterials(mergeWithSaved(saved)))
      .catch(() => !cancelled && setMaterials(cloneDefaults()))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open]);

  function update(key: string, patch: Partial<MaterialInterface>) {
    setMaterials((prev) => prev.map((m) => (priceKey(m) === key ? { ...m, ...patch } : m)));
  }

  async function onSave() {
    setIsSaving(true);
    try {
      // Lista completa: el backend borra los precios viejos que ya no se usan.
      await budgetApi.postMaterials(DEFAULT_CATEGORIES, materials, true);
      toast.success('Exito', 'Precios actualizados correctamente.');
      onClose();
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? error.response?.data?.detail || 'Error al actualizar precios'
        : 'Error al actualizar precios';
      toast.error('Error', String(message));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Precios de materiales</DialogTitle>
          <DialogDescription>
            Precio por unidad de cada material del catálogo. La unidad define qué se cobra: m² (superficie),
            m³ (volumen), ml (largo) o u (por pieza).
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
            <Spinner className="h-4 w-4" /> Cargando precios guardados...
          </div>
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
            {CATEGORY_ORDER.map((cat) => {
              const rows = materials.filter((m) => m.categoria === cat);
              if (rows.length === 0) return null;
              return (
                <section key={cat} className="flex flex-col gap-2">
                  <h3 className="sticky top-0 z-10 bg-surface py-1 text-xs font-semibold uppercase tracking-wide text-muted">
                    {CATEGORY_LABELS[cat]}
                  </h3>
                  {rows.map((material, index) => {
                    const key = priceKey(material);
                    return (
                      <div key={key} className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[1fr_5.5rem_7rem]">
                        <p className="col-span-2 text-sm font-medium text-foreground sm:col-span-1">
                          {material.nombre}
                          {index === 0 && (
                            <span
                              className="ml-2 text-[10px] font-normal text-muted"
                              title="Se usa para materiales de esta categoría que no tengan precio"
                            >
                              (referencia)
                            </span>
                          )}
                        </p>
                        <select
                          aria-label={`Unidad de ${material.nombre}`}
                          value={material.unidad}
                          onChange={(e) => update(key, { unidad: e.target.value })}
                          className="h-10 cursor-pointer rounded-md border border-border bg-surface-2 px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                        >
                          {PRICE_UNITS.map((u) => (
                            <option key={u.id} value={u.id} title={u.hint}>
                              $ / {u.label}
                            </option>
                          ))}
                        </select>
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          aria-label={`Precio de ${material.nombre}`}
                          value={material.precio_unitario}
                          onChange={(e) => {
                            const price = parseFloat(e.target.value);
                            update(key, { precio_unitario: Number.isNaN(price) ? 0 : price });
                          }}
                          className="h-10 tabular-nums"
                        />
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setMaterials(cloneDefaults())} disabled={isLoading || isSaving}>
            Restablecer
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={isSaving || isLoading}>
            {isSaving && <Spinner className="h-4 w-4" />}
            Guardar precios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
