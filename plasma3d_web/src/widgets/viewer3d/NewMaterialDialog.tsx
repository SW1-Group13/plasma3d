import { useState } from 'react';
import { useMaterialStore } from '@/entities/materials/store';
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
import { Label } from '@/shared/ui/label';
import { Spinner } from '@/shared/ui/spinner';
import { ImageIcon } from '@/shared/ui/icons';
import { toast } from '@/shared/ui/toast';

interface NewMaterialDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (id: string) => void;
}

export function NewMaterialDialog({ open, onClose, onCreated }: NewMaterialDialogProps) {
  const createMaterial = useMaterialStore((s) => s.create);

  const [nombre, setNombre] = useState('');
  const [categoria, setCategoria] = useState('Personalizado');
  const [color, setColor] = useState('#cccccc');
  const [rugosidad, setRugosidad] = useState(0.8);
  const [metalico, setMetalico] = useState(0);
  const [opacidad, setOpacidad] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSave() {
    if (!nombre.trim()) {
      toast.error('Falta el nombre', 'Escribe un nombre para el material.');
      return;
    }
    setSaving(true);
    try {
      const id = await createMaterial(
        {
          nombre: nombre.trim(),
          categoria,
          color_difuso: color,
          rugosidad,
          reflectividad: 0.1,
          metalico,
          opacidad,
          escala_textura: [1, 1],
        },
        file,
      );
      toast.success('Material creado', file ? 'Textura guardada en el backend.' : 'Guardado en la biblioteca.');
      onCreated?.(id);
      setNombre('');
      setFile(null);
      onClose();
    } catch {
      toast.error('Error', 'No se pudo crear el material.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon width={18} height={18} className="text-accent" /> Nuevo material
          </DialogTitle>
          <DialogDescription>Se guarda en la base de datos y la textura en /media.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div>
            <Label>Nombre</Label>
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Ladrillo gris" className="h-9" />
          </div>
          <div>
            <Label>Categoria</Label>
            <Input value={categoria} onChange={(e) => setCategoria(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label>Textura (imagen)</Label>
            <Input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="h-9" />
          </div>
          <div className="flex items-center gap-3">
            <div>
              <Label>Color difuso</Label>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded border border-border bg-surface-2"
              />
            </div>
            <div className="flex-1">
              <Label>Opacidad ({opacidad.toFixed(2)})</Label>
              <input type="range" min="0" max="1" step="0.05" value={opacidad} onChange={(e) => setOpacidad(Number(e.target.value))} className="w-full accent-[var(--color-primary)]" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Rugosidad ({rugosidad.toFixed(2)})</Label>
              <input type="range" min="0" max="1" step="0.05" value={rugosidad} onChange={(e) => setRugosidad(Number(e.target.value))} className="w-full accent-[var(--color-primary)]" />
            </div>
            <div>
              <Label>Metalico ({metalico.toFixed(2)})</Label>
              <input type="range" min="0" max="1" step="0.05" value={metalico} onChange={(e) => setMetalico(Number(e.target.value))} className="w-full accent-[var(--color-primary)]" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving && <Spinner className="h-4 w-4" />}
            Crear material
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
