import { useMemo, useState } from 'react';
import { useMaterialStore } from '@/entities/materials/store';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Label } from '@/shared/ui/label';
import { Input } from '@/shared/ui/input';
import { ImageIcon, PlusIcon, TrashIcon } from '@/shared/ui/icons';
import { cn } from '@/shared/lib/utils';

interface MaterialsDialogProps {
  open: boolean;
  onClose: () => void;
  onAssign: (id: string) => void;
}

export function MaterialsDialog({ open, onClose, onAssign }: MaterialsDialogProps) {
  const materials = useMaterialStore((s) => s.materials);
  const addMaterial = useMaterialStore((s) => s.add);
  const updateMaterial = useMaterialStore((s) => s.update);
  const duplicateMaterial = useMaterialStore((s) => s.duplicate);
  const removeMaterial = useMaterialStore((s) => s.remove);

  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>(materials[0]?.id ?? '');

  const filtered = useMemo(
    () => materials.filter((m) => m.nombre.toLowerCase().includes(query.toLowerCase())),
    [materials, query],
  );

  const byCategory = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    filtered.forEach((m) => {
      const list = map.get(m.categoria) ?? [];
      list.push(m);
      map.set(m.categoria, list);
    });
    return Array.from(map.entries());
  }, [filtered]);

  const selected = materials.find((m) => m.id === selectedId) ?? materials[0];

  function patch(patchObj: Partial<typeof selected>) {
    if (selected) updateMaterial(selected.id, patchObj);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon width={18} height={18} className="text-accent" /> Biblioteca de materiales
          </DialogTitle>
          <DialogDescription>
            Clic en un material para asignarlo a la seleccion. Se aplica en modo texturas (Realista).
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col gap-3">
            <Input placeholder="Buscar material..." value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="max-h-[46vh] overflow-y-auto rounded-lg border border-border p-3">
              {byCategory.map(([categoria, items]) => (
                <div key={categoria} className="mb-4 last:mb-0">
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{categoria}</h4>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {items.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setSelectedId(m.id)}
                        onDoubleClick={() => onAssign(m.id)}
                        title={`${m.nombre} (doble clic para asignar)`}
                        className={cn(
                          'flex flex-col items-center gap-1 rounded-lg border p-1.5 text-center transition-colors',
                          selectedId === m.id ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-border-strong',
                        )}
                      >
                        {m.textura_url ? (
                          <img src={m.textura_url} alt={m.nombre} className="h-12 w-full rounded object-cover" loading="lazy" />
                        ) : (
                          <span className="h-12 w-full rounded" style={{ backgroundColor: m.color_difuso }} />
                        )}
                        <span className="line-clamp-2 text-[10px] leading-tight text-muted">{m.nombre}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {byCategory.length === 0 && <p className="text-sm text-muted">Sin resultados.</p>}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {selected && (
              <>
                <div className="flex items-center gap-3">
                  {selected.textura_url ? (
                    <img src={selected.textura_url} alt={selected.nombre} className="h-16 w-16 rounded-lg border border-border object-cover" />
                  ) : (
                    <span className="h-16 w-16 rounded-lg border border-border" style={{ backgroundColor: selected.color_difuso }} />
                  )}
                  <div className="flex-1">
                    <Label>Nombre</Label>
                    <Input value={selected.nombre} onChange={(e) => patch({ nombre: e.target.value })} className="h-9" />
                  </div>
                </div>

                <div>
                  <Label>Categoria</Label>
                  <Input value={selected.categoria} onChange={(e) => patch({ categoria: e.target.value })} className="h-9" />
                </div>

                <div>
                  <Label>Textura (URL)</Label>
                  <Input value={selected.textura_url ?? ''} onChange={(e) => patch({ textura_url: e.target.value })} className="h-9" placeholder="/textures/..." />
                </div>

                <div className="flex items-center gap-3">
                  <div>
                    <Label>Color difuso</Label>
                    <input
                      type="color"
                      value={selected.color_difuso}
                      onChange={(e) => patch({ color_difuso: e.target.value })}
                      className="h-9 w-12 cursor-pointer rounded border border-border bg-surface-2"
                    />
                  </div>
                  <div className="flex-1">
                    <Label>Opacidad ({selected.opacidad.toFixed(2)})</Label>
                    <input
                      type="range" min="0" max="1" step="0.05"
                      value={selected.opacidad}
                      onChange={(e) => patch({ opacidad: Number(e.target.value) })}
                      className="w-full accent-[var(--color-primary)]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Rugosidad ({selected.rugosidad.toFixed(2)})</Label>
                    <input type="range" min="0" max="1" step="0.05" value={selected.rugosidad} onChange={(e) => patch({ rugosidad: Number(e.target.value) })} className="w-full accent-[var(--color-primary)]" />
                  </div>
                  <div>
                    <Label>Metalico ({selected.metalico.toFixed(2)})</Label>
                    <input type="range" min="0" max="1" step="0.05" value={selected.metalico} onChange={(e) => patch({ metalico: Number(e.target.value) })} className="w-full accent-[var(--color-primary)]" />
                  </div>
                  <div className="col-span-2">
                    <Label>Reflectividad ({selected.reflectividad.toFixed(2)})</Label>
                    <input type="range" min="0" max="1" step="0.05" value={selected.reflectividad} onChange={(e) => patch({ reflectividad: Number(e.target.value) })} className="w-full accent-[var(--color-primary)]" />
                  </div>
                </div>

                <div className="mt-auto flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => onAssign(selected.id)}>
                    Asignar a seleccion
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => duplicateMaterial(selected.id)}>
                    Duplicar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted hover:text-danger"
                    onClick={() => {
                      removeMaterial(selected.id);
                      setSelectedId(materials.find((m) => m.id !== selected.id)?.id ?? '');
                    }}
                  >
                    <TrashIcon width={15} height={15} /> Eliminar
                  </Button>
                </div>
              </>
            )}

            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const id = addMaterial({
                  nombre: 'Nuevo material',
                  categoria: 'Personalizado',
                  color_difuso: '#cccccc',
                  rugosidad: 0.8,
                  reflectividad: 0.1,
                  metalico: 0,
                  opacidad: 1,
                  escala_textura: [1, 1],
                });
                setSelectedId(id);
              }}
            >
              <PlusIcon width={15} height={15} /> Nuevo material
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
