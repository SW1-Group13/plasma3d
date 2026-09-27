import { useState } from 'react';
import axios from 'axios';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_MATERIALS,
  type MaterialInterface,
} from '@/entities/budget/materials';
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

export function PricesDialog({ open, onClose }: PricesDialogProps) {
  const [materials, setMaterials] = useState<MaterialInterface[]>(
    DEFAULT_MATERIALS.map((m) => ({ ...m })),
  );
  const [isSaving, setIsSaving] = useState(false);

  function updatePrice(index: number, value: string) {
    const price = parseFloat(value);
    setMaterials((prev) =>
      prev.map((material, i) =>
        i === index ? { ...material, precio_unitario: Number.isNaN(price) ? 0 : price } : material,
      ),
    );
  }

  async function onSave() {
    setIsSaving(true);
    try {
      await budgetApi.postMaterials(DEFAULT_CATEGORIES, materials);
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
          <DialogDescription>Ajusta el precio unitario por material.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {materials.map((material, index) => (
            <div
              key={material.nombre}
              className="grid grid-cols-[1fr_auto_7rem] items-center gap-3"
            >
              <div>
                <p className="text-sm font-medium text-slate-800">{material.nombre}</p>
                <p className="text-xs text-slate-500">
                  {material.categoria} · {material.unidad}
                </p>
              </div>
              <span className="text-sm text-slate-500">$/unidad</span>
              <Input
                type="number"
                step="0.1"
                min="0"
                value={material.precio_unitario}
                onChange={(e) => updatePrice(index, e.target.value)}
              />
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={isSaving}>
            {isSaving && <Spinner className="h-4 w-4" />}
            Guardar precios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
