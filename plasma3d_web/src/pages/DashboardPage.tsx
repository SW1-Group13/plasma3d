import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useModelStore } from '@/entities/model3D/store';
import type { GapMode, RoofType } from '@/entities/model3D/api';
import type { PlanQuality } from '@/entities/model3D/types';
import { useSession } from '@/entities/session/store';
import { structuralApi } from '@/entities/structural/api';
import type { StructuralAnalysis } from '@/entities/structural/types';
import { RiskDialog } from '@/features/risk/ui/RiskDialog';
import { assetUrl } from '@/shared/lib/assetUrl';
import { BackgroundTask } from '@/shared/ui/loader';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { Skeleton } from '@/shared/ui/spinner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { CubeIcon, LayersIcon, PlusIcon, SparklesIcon, TrashIcon, UploadIcon } from '@/shared/ui/icons';
import { toast } from '@/shared/ui/toast';

function serverMessage(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return typeof detail === 'string' && detail.length > 0 ? detail : fallback;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const user = useSession((s) => s.user);

  const list = useModelStore((s) => s.list);
  const isLoading = useModelStore((s) => s.isLoading);
  const fetchModels = useModelStore((s) => s.fetch);
  const uploadPlan = useModelStore((s) => s.uploadPlan);
  const uploadGlb = useModelStore((s) => s.saveGlb);
  const createEmpty = useModelStore((s) => s.createEmpty);
  const removeModel = useModelStore((s) => s.remove);
  const regenerateModel = useModelStore((s) => s.regenerate);
  const [regenId, setRegenId] = useState<number | null>(null);

  const planInputRef = useRef<HTMLInputElement>(null);
  const glbInputRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [task, setTask] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [riskOpen, setRiskOpen] = useState(false);
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskAnalysis, setRiskAnalysis] = useState<StructuralAnalysis | null>(null);
  const [riskPlanId, setRiskPlanId] = useState<number | null>(null);
  const [roofType, setRoofType] = useState<RoofType>('plano');
  const [gapMode, setGapMode] = useState<GapMode>('rellenar');
  // Ancho total real del plano en metros (opcional): escala exacta.
  const [realWidth, setRealWidth] = useState('');
  const realWidthM = (() => {
    const value = Number(realWidth.replace(',', '.'));
    return Number.isFinite(value) && value >= 1 && value <= 500 ? value : null;
  })();

  useEffect(() => {
    fetchModels().catch(() => toast.error('Error', 'No se pudieron cargar los modelos.'));
  }, [fetchModels]);

  async function onPlanSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !user) return;
    setTask('Subiendo y procesando plano...');
    try {
      await uploadPlan(file, user.id, roofType, gapMode, realWidthM);
      toast.success('Exito', 'Modelo subido con exito.');
    } catch (error) {
      toast.error('Error', serverMessage(error, 'No se pudo subir el modelo.'));
    } finally {
      setTask(null);
    }
  }

  async function onGlbSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !user) return;
    setTask('Subiendo modelo 3D...');
    try {
      await uploadGlb(file, user.id);
      toast.success('Exito', 'Modelo 3D subido con exito.');
    } catch (error) {
      toast.error('Error', serverMessage(error, 'No se pudo subir el modelo 3D.'));
    } finally {
      setTask(null);
    }
  }

  async function onCreateModel() {
    if (!user) return;
    setCreating(true);
    setTask('Creando modelo...');
    try {
      await createEmpty(user.id);
      toast.success('Exito', 'Modelo creado. Abrelo para dibujar.');
    } catch (error) {
      toast.error('Error', serverMessage(error, 'No se pudo crear el modelo.'));
    } finally {
      setCreating(false);
      setTask(null);
    }
  }

  async function onConfirmDelete() {
    if (deleteId == null) return;
    setTask('Eliminando proyecto...');
    try {
      await removeModel(deleteId);
      toast.success('Exito', 'Proyecto eliminado.');
    } catch {
      toast.error('Error', 'No se pudo eliminar el proyecto.');
    } finally {
      setDeleteId(null);
      setTask(null);
    }
  }

  async function onConfirmRegenerate() {
    if (regenId == null) return;
    const id = regenId;
    setRegenId(null);
    setTask('Regenerando modelo 3D...');
    try {
      await regenerateModel(id, gapMode, realWidthM);
      toast.success('Listo', 'Modelo regenerado con ventanas y puertas mejoradas.');
    } catch (error) {
      toast.error('Error', serverMessage(error, 'No se pudo regenerar el modelo.'));
    } finally {
      setTask(null);
    }
  }

  async function onAnalyzeRisk(model: (typeof list)[number]) {
    setRiskPlanId(model.id);
    setRiskAnalysis(null);
    setRiskOpen(true);
    setRiskLoading(true);
    try {
      const data = await structuralApi.analyzePlan(model.id);
      setRiskAnalysis(data);
    } catch (error) {
      setRiskOpen(false);
      toast.error('Error', serverMessage(error, 'No se pudo analizar el riesgo del modelo.'));
    } finally {
      setRiskLoading(false);
    }
  }

  function openModel(model: (typeof list)[number]) {
    localStorage.setItem('modelo', JSON.stringify(model));
    navigate('/private/editor');
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Mis modelos</h1>
          <p className="mt-1 text-sm text-muted">Sube un plano, un GLB o un GLTF y edítalo en 3D.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={planInputRef}
            type="file"
            accept="image/*,.pdf,.dxf,.dwg"
            hidden
            onChange={onPlanSelected}
          />
          <input ref={glbInputRef} type="file" accept=".glb,.gltf" hidden onChange={onGlbSelected} />
          <label className="flex items-center gap-2 text-sm text-muted">
            Techo
            <select
              value={roofType}
              onChange={(e) => setRoofType(e.target.value as RoofType)}
              disabled={isLoading}
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
              aria-label="Tipo de techo al subir un plano"
            >
              <option value="plano">Plano</option>
              <option value="dos_aguas">Dos aguas</option>
              <option value="ninguno">Sin techo</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-muted">
            Huecos sin puerta
            <select
              value={gapMode}
              onChange={(e) => setGapMode(e.target.value as GapMode)}
              disabled={isLoading}
              title="Espacios entre muros donde la IA no detectó puerta ni ventana. Donde hay puerta o ventana detectada nunca se rellena."
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
              aria-label="Huecos entre muros sin puerta detectada"
            >
              <option value="rellenar">Rellenar</option>
              <option value="paso">Dejar paso</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-muted" title="Opcional: ancho total de la casa según el plano (por ejemplo 16,76). Hace que las medidas del 3D sean exactas.">
            Ancho real
            <input
              value={realWidth}
              onChange={(e) => setRealWidth(e.target.value)}
              inputMode="decimal"
              placeholder="m (opcional)"
              disabled={isLoading}
              className="h-9 w-28 rounded-md border border-border bg-surface px-2 text-sm text-foreground placeholder:text-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
              aria-label="Ancho total real del plano en metros (opcional)"
            />
          </label>
          <Button variant="outline" onClick={() => planInputRef.current?.click()} disabled={isLoading}>
            <UploadIcon width={16} height={16} /> Subir plano
          </Button>
          <Button variant="outline" onClick={() => glbInputRef.current?.click()} disabled={isLoading}>
            <UploadIcon width={16} height={16} /> Subir GLB/GLTF
          </Button>
          <Button onClick={onCreateModel} disabled={creating || isLoading}>
            <PlusIcon width={16} height={16} /> Crear modelo
          </Button>
        </div>
      </div>

      {isLoading && list.length === 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
              <Skeleton className="h-40 w-full rounded-none" />
              <div className="flex flex-col gap-3 p-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-[var(--radius-card)] border border-dashed border-border bg-surface/50 p-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2 text-muted">
            <CubeIcon className="h-7 w-7" />
          </span>
          <div>
            <p className="font-medium text-foreground">No tienes modelos todavia</p>
            <p className="mt-1 text-sm text-muted">Sube un plano o crea un modelo vacio para empezar.</p>
          </div>
          <Button onClick={onCreateModel} disabled={creating}>
            <PlusIcon width={16} height={16} /> Crear modelo
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((model) => {
            const image = model.plan_image ? assetUrl(model.plan_image) : null;
            return (
              <article
                key={model.id}
                className="group flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-lg shadow-black/20 transition-all duration-150 hover:border-border-strong hover:shadow-xl hover:shadow-black/30"
              >
                <button
                  type="button"
                  onClick={() => image && setPreview(image)}
                  className="relative h-40 w-full cursor-pointer overflow-hidden border-b border-border bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/70"
                  aria-label={`Ver plano del modelo ${model.id}`}
                  disabled={!image}
                >
                  <img
                    src={image ?? '/assets/imagen-defecto.jpg'}
                    alt={`Plano del modelo ${model.id}`}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                  />
                  <span className="absolute left-2 top-2">
                    <Badge className="bg-black/60 text-white backdrop-blur">
                      <LayersIcon width={12} height={12} /> #{model.id}
                    </Badge>
                  </span>
                </button>

                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div>
                    <p className="font-semibold text-foreground">Modelo #{model.id}</p>
                    {model.calidad && <QualityNote quality={model.calidad} />}
                    <p className="mt-0.5 text-xs tabular-nums text-muted">
                      {model.widht ?? '-'} x {model.height ?? '-'} ·{' '}
                      {model.created_at ? new Date(model.created_at).toLocaleDateString() : '-'}
                    </p>
                  </div>

                  <div className="mt-auto flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={() => openModel(model)}>
                      Abrir editor
                    </Button>
                    {model.detections_json && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setRegenId(model.id)}
                        title="Reconstruir el 3D con ventanas (vidrio, marco, dintel) y puertas mejoradas"
                      >
                        Regenerar 3D
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onAnalyzeRisk(model)}
                      title="Analizar el riesgo estructural con IA"
                    >
                      <SparklesIcon width={14} height={14} /> Riesgo IA
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto text-muted hover:text-danger"
                      onClick={() => setDeleteId(model.id)}
                      aria-label={`Eliminar modelo ${model.id}`}
                    >
                      <TrashIcon width={15} height={15} /> Eliminar
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <BackgroundTask show={!!task} label={task ?? ''} />

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setPreview(null)}
          role="dialog"
          aria-modal="true"
        >
          <img src={preview} alt="Vista previa del plano" className="max-h-[85vh] max-w-[90vw] rounded-xl border border-border" />
        </div>
      )}

      <RiskDialog
        open={riskOpen}
        onOpenChange={setRiskOpen}
        analysis={riskAnalysis}
        loading={riskLoading}
        planId={riskPlanId}
      />

      <Dialog open={regenId != null} onOpenChange={(v) => !v && setRegenId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Regenerar modelo 3D</DialogTitle>
            <DialogDescription>
              Se reconstruirá el modelo #{regenId} desde el plano original, con ventanas con vidrio, marco y dintel, y
              puertas de 2.10 m encajadas en su muro, y muros continuos (une tramos y cierra esquinas).
              Huecos sin puerta: <strong>{gapMode === 'rellenar' ? 'se rellenan' : 'quedan como paso'}</strong>
              {' '}(se cambia arriba). Se conserva el tipo de techo.
              <strong className="mt-2 block text-warning">
                Se perderán los cambios que hiciste a mano en el editor para este plano.
              </strong>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegenId(null)}>
              Cancelar
            </Button>
            <Button onClick={onConfirmRegenerate}>Regenerar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteId != null} onOpenChange={(v) => !v && setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Eliminar proyecto</DialogTitle>
            <DialogDescription>
              Se eliminara el modelo #{deleteId} y sus archivos. Esta accion no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={onConfirmDelete}>
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const SCALE_LABEL: Record<string, string> = {
  usuario: 'medida indicada',
  puertas: 'por las puertas',
  puertas_dibujadas: 'por las puertas dibujadas',
  estimada: 'estimada',
};

/** Resumen de lo detectado en el plano y avisos si algo falló. */
function QualityNote({ quality }: { quality: PlanQuality }) {
  const avisos = quality.avisos ?? [];
  return (
    <div className="mt-1 flex flex-col gap-1 text-xs text-muted">
      <span className="tabular-nums">
        {quality.muros} muros · {quality.puertas} puertas · {quality.ventanas} ventanas
        {quality.ancho_m ? ` · ${quality.ancho_m.toLocaleString('es')} m de ancho` : ''} · escala{' '}
        {SCALE_LABEL[quality.escala] ?? quality.escala}
      </span>
      {avisos.map((aviso) => (
        <span key={aviso} className="rounded-md border border-warning/30 bg-warning/10 px-2 py-1 text-warning">
          {aviso}
        </span>
      ))}
    </div>
  );
}
