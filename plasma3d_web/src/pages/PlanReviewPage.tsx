import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { model3DApi, type GapMode, type RoofType } from '@/entities/model3D/api';
import type { DetectionClass, PlanDetections } from '@/entities/model3D/types';
import { CLASS_COLOR, DOUBT_SCORE, toDetections, toItems, wallThickness } from '@/features/planReview/geometry';
import { useReviewStore, type ReviewTool } from '@/features/planReview/store';
import { PlanReviewCanvas } from '@/features/planReview/ui/PlanReviewCanvas';
import { assetUrl } from '@/shared/lib/assetUrl';
import { Button } from '@/shared/ui/button';
import { BackgroundTask } from '@/shared/ui/loader';
import { toast } from '@/shared/ui/toast';

const TOOLS: { id: ReviewTool; label: string; key: string; hint: string }[] = [
  { id: 'select', label: 'Seleccionar', key: 'V', hint: 'Clic para elegir, arrastrar para mover. Arrastra en vacío para seleccionar varios.' },
  { id: 'erase', label: 'Borrar zona', key: 'E', hint: 'Arrastra un rectángulo: borra todo lo que quede dentro (mesas, cocina...). Clic sobre un elemento lo borra.' },
  { id: 'wall', label: 'Muro', key: 'W', hint: 'Arrastra de un extremo al otro. Se endereza a 0/90° y se engancha a otros muros.' },
  { id: 'door', label: 'Puerta', key: 'D', hint: 'Arrastra un rectángulo sobre el muro: se encaja en él.' },
  { id: 'window', label: 'Ventana', key: 'N', hint: 'Arrastra un rectángulo sobre el muro: se encaja en él.' },
];

const CLASS_LABEL: Record<DetectionClass, string> = { wall: 'Muros', door: 'Puertas', window: 'Ventanas' };

function serverMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: { detail?: string } } })?.response?.data;
  return typeof data?.detail === 'string' && data.detail ? data.detail : fallback;
}

export function PlanReviewPage() {
  const { id } = useParams();
  const planId = Number(id);
  const navigate = useNavigate();

  const items = useReviewStore((s) => s.items);
  const selected = useReviewStore((s) => s.selected);
  const tool = useReviewStore((s) => s.tool);
  const dirty = useReviewStore((s) => s.dirty);
  const canUndo = useReviewStore((s) => s.past.length > 0);
  const canRedo = useReviewStore((s) => s.future.length > 0);
  const { load, undo, redo, setTool, removeSelected, setClassSelected, markSaved, select } = useReviewStore.getState();

  const [base, setBase] = useState<PlanDetections | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [task, setTask] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(0.9);
  const [showOverlay, setShowOverlay] = useState(true);
  const [hidden, setHidden] = useState<Record<DetectionClass, boolean>>({ wall: false, door: false, window: false });
  const [roofType, setRoofType] = useState<RoofType>('plano');
  const [gapMode, setGapMode] = useState<GapMode>('rellenar');

  useEffect(() => {
    if (!Number.isFinite(planId)) return;
    model3DApi
      .getDetections(planId)
      .then((data) => {
        setBase(data.detections);
        setImageUrl(assetUrl(data.plan_image));
        load(toItems(data.detections));
      })
      .catch((error) => toast.error('Error', serverMessage(error, 'No se pudo cargar el plano.')));
  }, [planId, load]);

  // Atajos de teclado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && k === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        removeSelected();
      } else if (e.key === 'Escape') {
        select([]);
        setTool('select');
      } else if (!e.ctrlKey && !e.metaKey) {
        const found = TOOLS.find((x) => x.key.toLowerCase() === k);
        if (found) setTool(found.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, removeSelected, select, setTool]);

  // Avisar si se sale con cambios sin guardar.
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  const counts = useMemo(() => {
    const c = { wall: 0, door: 0, window: 0, doubt: 0 };
    for (const it of items) {
      c[it.cls] += 1;
      if (it.score < DOUBT_SCORE) c.doubt += 1;
    }
    return c;
  }, [items]);

  const thickness = useMemo(() => wallThickness(base, items), [base, items]);

  async function save(): Promise<boolean> {
    if (!base) return false;
    try {
      const data = await model3DApi.saveDetections(planId, toDetections(base, items));
      setBase(data.detections);
      markSaved();
      return true;
    } catch (error) {
      toast.error('Error', serverMessage(error, 'No se pudieron guardar las correcciones.'));
      return false;
    }
  }

  async function onSave() {
    setTask('Guardando correcciones...');
    if (await save()) toast.success('Guardado', 'Correcciones guardadas.');
    setTask(null);
  }

  async function onBuild() {
    if (!counts.wall) {
      toast.error('Sin muros', 'Dibuja al menos un muro antes de generar el 3D.');
      return;
    }
    setTask('Guardando y generando el modelo 3D...');
    try {
      if (!(await save())) return;
      const model = await model3DApi.buildPlan(planId, roofType, gapMode);
      localStorage.setItem('modelo', JSON.stringify(model));
      toast.success('Listo', 'Modelo 3D generado con tus correcciones.');
      navigate('/private/editor');
    } catch (error) {
      toast.error('Error', serverMessage(error, 'No se pudo generar el modelo 3D.'));
    } finally {
      setTask(null);
    }
  }

  const activeHint = TOOLS.find((t) => t.id === tool)?.hint;

  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-[520px] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Revisar plano #{planId}</h1>
          <p className="text-xs text-muted">
            Borra lo que sobra (muebles), dibuja lo que falta y genera el 3D. Rueda: zoom · clic derecho o espacio + arrastrar: mover vista.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={roofType}
            onChange={(e) => setRoofType(e.target.value as RoofType)}
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm text-foreground"
            aria-label="Tipo de techo"
          >
            <option value="plano">Techo plano</option>
            <option value="dos_aguas">Dos aguas</option>
            <option value="ninguno">Sin techo</option>
          </select>
          <select
            value={gapMode}
            onChange={(e) => setGapMode(e.target.value as GapMode)}
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm text-foreground"
            aria-label="Huecos sin puerta"
          >
            <option value="rellenar">Huecos: rellenar</option>
            <option value="paso">Huecos: dejar paso</option>
          </select>
          <Button variant="outline" onClick={() => navigate('/private/dashboard')}>
            Volver
          </Button>
          <Button variant="outline" onClick={onSave} disabled={!dirty || !!task}>
            Guardar
          </Button>
          <Button onClick={onBuild} disabled={!base || !!task}>
            Generar 3D
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <aside className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto rounded-[var(--radius-card)] border border-border bg-surface p-3 text-sm">
          <section className="flex flex-col gap-1">
            <p className="text-xs font-semibold uppercase text-muted">Herramientas</p>
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTool(t.id)}
                title={t.hint}
                className={`flex items-center justify-between rounded-md px-2 py-1.5 text-left transition-colors ${
                  tool === t.id ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-surface-2'
                }`}
              >
                <span className="flex items-center gap-2">
                  {t.id in CLASS_COLOR && (
                    <span className="h-3 w-3 rounded-sm" style={{ background: CLASS_COLOR[t.id as DetectionClass] }} />
                  )}
                  {t.label}
                </span>
                <kbd className="text-[10px] opacity-70">{t.key}</kbd>
              </button>
            ))}
            {activeHint && <p className="mt-1 text-xs text-muted">{activeHint}</p>}
          </section>

          <section className="flex flex-col gap-1">
            <p className="text-xs font-semibold uppercase text-muted">Selección ({selected.length})</p>
            <div className="grid grid-cols-3 gap-1">
              {(['wall', 'door', 'window'] as DetectionClass[]).map((c) => (
                <Button key={c} size="sm" variant="outline" disabled={!selected.length} onClick={() => setClassSelected(c)}>
                  {c === 'wall' ? 'Muro' : c === 'door' ? 'Puerta' : 'Vent.'}
                </Button>
              ))}
            </div>
            <Button size="sm" variant="destructive" disabled={!selected.length} onClick={removeSelected}>
              Borrar (Supr)
            </Button>
            <div className="grid grid-cols-2 gap-1">
              <Button size="sm" variant="outline" disabled={!canUndo} onClick={undo}>
                Deshacer
              </Button>
              <Button size="sm" variant="outline" disabled={!canRedo} onClick={redo}>
                Rehacer
              </Button>
            </div>
          </section>

          <section className="flex flex-col gap-1">
            <p className="text-xs font-semibold uppercase text-muted">Capas</p>
            {(['wall', 'door', 'window'] as DetectionClass[]).map((c) => (
              <label key={c} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!hidden[c]}
                  onChange={(e) => setHidden((h) => ({ ...h, [c]: !e.target.checked }))}
                />
                <span className="h-3 w-3 rounded-sm" style={{ background: CLASS_COLOR[c] }} />
                {CLASS_LABEL[c]} ({counts[c]})
              </label>
            ))}
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!showOverlay} onChange={(e) => setShowOverlay(!e.target.checked)} />
              Ver plano original
            </label>
            <label className="mt-1 flex flex-col gap-1 text-xs text-muted">
              Opacidad
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.05}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
              />
            </label>
          </section>

          {counts.doubt > 0 && (
            <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-foreground">
              {counts.doubt} elemento(s) dudoso(s) con borde punteado naranja: revísalos primero.
            </p>
          )}
        </aside>

        <div className="relative min-w-0 flex-1 overflow-hidden rounded-[var(--radius-card)] border border-border">
          {base && imageUrl ? (
            <PlanReviewCanvas
              imageUrl={imageUrl}
              width={base.Width}
              height={base.Height}
              thickness={thickness}
              overlayOpacity={opacity}
              hidden={hidden}
              showOverlay={showOverlay}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted">Cargando plano...</div>
          )}
        </div>
      </div>

      <BackgroundTask show={!!task} label={task ?? ''} />
    </div>
  );
}
