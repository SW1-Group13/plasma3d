import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorEngine, type SelectedInfo, type TransformMode } from '@/widgets/viewer3d/engine';
import { TEXTURES, EMPTY_MODEL_URL } from '@/entities/model3D/three/textures';
import type { ElementType, ModelSummary } from '@/entities/model3D/three/Modelo3D';
import { useModelStore } from '@/entities/model3D/store';
import { useSession } from '@/entities/session/store';
import { env } from '@/shared/config/env';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Spinner } from '@/shared/ui/spinner';
import { LoadingOverlay } from '@/shared/ui/loader';
import {
  CalculatorIcon,
  CubeIcon,
  DownloadIcon,
  GridIcon,
  LayersIcon,
  MoveIcon,
  PlusIcon,
  RotateIcon,
  SaveIcon,
  ScaleIcon,
  SparklesIcon,
  TagIcon,
  TrashIcon,
} from '@/shared/ui/icons';
import { cn } from '@/shared/lib/utils';
import { toast } from '@/shared/ui/toast';

interface EditorViewerProps {
  onBudget: (summary: ModelSummary) => void;
  onOpenPrices: () => void;
  onAnalyze: (file: File) => void;
}

export function EditorViewer({ onBudget, onOpenPrices, onAnalyze }: EditorViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<EditorEngine | null>(null);

  const updateGlb = useModelStore((s) => s.updateGlb);
  const user = useSession((s) => s.user);

  const [selected, setSelected] = useState<SelectedInfo | null>(null);
  const [mode, setMode] = useState<TransformMode>('translate');
  const [space, setSpace] = useState<'local' | 'world'>('local');
  const [snap, setSnap] = useState(0);
  const [rotSnap, setRotSnap] = useState(0);
  const [texturePart, setTexturePart] = useState('wall_internal');
  const [textureUrl, setTextureUrl] = useState(TEXTURES[0].url);
  const [color, setColor] = useState('#e2e8f0');
  const [isBusy, setIsBusy] = useState(false);
  const [createHint, setCreateHint] = useState<ElementType | null>(null);
  const [modelLoading, setModelLoading] = useState(true);
  const [gridVisible, setGridVisible] = useState(true);
  const [propsOpen, setPropsOpen] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new EditorEngine(canvas);
    engineRef.current = engine;
    engine.setSelectionListener(setSelected);

    const raw = localStorage.getItem('modelo');
    let url = EMPTY_MODEL_URL;
    if (raw) {
      try {
        const model = JSON.parse(raw);
        if (model?.glb_model) url = `${env.apiUrl}${String(model.glb_model).replace(/^\//, '')}`;
      } catch {
        localStorage.removeItem('modelo');
      }
    }
    engine.loadModel(url, TEXTURES, () => setModelLoading(false));
    const loadingFallback = window.setTimeout(() => setModelLoading(false), 25000);

    return () => {
      window.clearTimeout(loadingFallback);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => void engineRef.current?.setMode(mode), [mode]);
  useEffect(() => void engineRef.current?.setSpace(space), [space]);
  useEffect(() => void engineRef.current?.setTranslationSnap(snap || null), [snap]);
  useEffect(() => void engineRef.current?.setRotationSnap(rotSnap || null), [rotSnap]);
  useEffect(() => void engineRef.current?.setGridVisible(gridVisible), [gridVisible]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'SELECT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'w' || e.key === 'W') setMode('translate');
      else if (e.key === 'e' || e.key === 'E') setMode('rotate');
      else if (e.key === 'r' || e.key === 'R') setMode('scale');
      else if (e.key === 'g' || e.key === 'G') setGridVisible((v) => !v);
      else if (e.key === 'Delete' || e.key === 'Backspace') engineRef.current?.deleteSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const startCreate = useCallback((type: ElementType) => {
    engineRef.current?.startCreate(type);
    setCreateHint(type);
    toast.info('Colocar elemento', 'Haz clic sobre el piso para ubicarlo.');
  }, []);

  async function buildFile(): Promise<File | null> {
    const engine = engineRef.current;
    if (!engine) return null;
    let id = Date.now();
    try {
      id = JSON.parse(localStorage.getItem('modelo') || '{}').id ?? id;
    } catch {
      /* ignore */
    }
    const { blob, filename } = await engine.exportGlb(`job_${id}.glb`);
    return new File([blob], filename, { type: 'model/gltf-binary' });
  }

  async function onExport() {
    const engine = engineRef.current;
    if (!engine) return;
    setIsBusy(true);
    try {
      const id = JSON.parse(localStorage.getItem('modelo') || '{}').id ?? Date.now();
      const { blob, filename } = await engine.exportGlb(`job_${id}.glb`);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename.endsWith('.glb') ? filename : `${filename}.glb`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      toast.error('Error', 'No se pudo exportar el modelo.');
    } finally {
      setIsBusy(false);
    }
  }

  async function onSave() {
    if (!user) return;
    setIsBusy(true);
    try {
      const file = await buildFile();
      if (!file) throw new Error('Sin modelo');
      await updateGlb(file, user.id);
      toast.success('Exito', 'Modelo guardado correctamente.');
    } catch {
      toast.error('Error', 'No se pudo guardar el modelo.');
    } finally {
      setIsBusy(false);
    }
  }

  async function onAnalyzeClick() {
    setIsBusy(true);
    try {
      const file = await buildFile();
      if (!file) throw new Error('Sin modelo');
      onAnalyze(file);
    } catch {
      toast.error('Error', 'No se pudo preparar el modelo.');
    } finally {
      setIsBusy(false);
    }
  }

  function onBudgetClick() {
    const summary = engineRef.current?.getSummary();
    if (!summary) {
      toast.error('Error', 'No hay modelo cargado.');
      return;
    }
    onBudget(summary);
  }

  const position = selected?.position ?? { x: 0, y: 0, z: 0 };
  const rotation = selected?.rotation ?? { x: 0, y: 0, z: 0 };
  const scale = selected?.scale ?? { x: 1, y: 1, z: 1 };

  return (
    <div className="relative h-[calc(100dvh-4rem)] w-full overflow-hidden bg-[#0a0e1a]">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <LoadingOverlay show={modelLoading} label="Cargando modelo 3D..." />

      {/* Ribbon superior (flotante) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center p-3">
        <div className="pointer-events-auto flex max-w-[95vw] flex-wrap items-center gap-1.5 rounded-xl border border-border/70 bg-surface/85 px-2 py-1.5 shadow-xl shadow-black/40 backdrop-blur-md">
          <ModeButton active={mode === 'translate'} onClick={() => setMode('translate')} title="Mover (W)">
            <MoveIcon width={15} height={15} /> Mover
          </ModeButton>
          <ModeButton active={mode === 'rotate'} onClick={() => setMode('rotate')} title="Rotar (E)">
            <RotateIcon width={15} height={15} /> Rotar
          </ModeButton>
          <ModeButton active={mode === 'scale'} onClick={() => setMode('scale')} title="Escalar (R)">
            <ScaleIcon width={15} height={15} /> Escalar
          </ModeButton>

          <span className="mx-1 h-6 w-px bg-border" />

          <button
            onClick={() => setSpace(space === 'local' ? 'world' : 'local')}
            className="cursor-pointer rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
            title="Alternar espacio local / mundo"
          >
            {space === 'local' ? 'Local' : 'Mundo'}
          </button>

          <select
            aria-label="Snap de traslacion"
            className="cursor-pointer rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
            value={snap}
            onChange={(e) => setSnap(Number(e.target.value))}
            title="Snap traslacion"
          >
            <option value={0}>Snap off</option>
            <option value={0.25}>Snap .25</option>
            <option value={0.5}>Snap .5</option>
            <option value={1}>Snap 1</option>
          </select>

          <select
            aria-label="Snap de rotacion"
            className="cursor-pointer rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
            value={rotSnap}
            onChange={(e) => setRotSnap(Number(e.target.value))}
            title="Snap rotacion"
          >
            <option value={0}>Rot off</option>
            <option value={15}>15°</option>
            <option value={45}>45°</option>
            <option value={90}>90°</option>
          </select>

          <span className="mx-1 h-6 w-px bg-border" />

          <RibbonAction onClick={onSave} disabled={isBusy || !user} title="Guardar (servidor)">
            <SaveIcon width={15} height={15} /> Guardar
          </RibbonAction>
          <RibbonAction onClick={onExport} disabled={isBusy} title="Exportar GLB">
            <DownloadIcon width={15} height={15} /> Exportar
          </RibbonAction>
          <RibbonAction onClick={onAnalyzeClick} disabled={isBusy} title="Analisis estructural">
            <SparklesIcon width={15} height={15} /> Analizar
          </RibbonAction>
          <RibbonAction onClick={onBudgetClick} disabled={isBusy} title="Generar presupuesto">
            <CalculatorIcon width={15} height={15} /> Presupuesto
          </RibbonAction>
          <RibbonAction onClick={onOpenPrices} title="Precios de materiales">
            <TagIcon width={15} height={15} /> Precios
          </RibbonAction>

          <span className="mx-1 h-6 w-px bg-border" />

          <RibbonAction
            onClick={() => setPropsOpen((v) => !v)}
            active={propsOpen}
            title="Mostrar/ocultar propiedades"
          >
            <CubeIcon width={15} height={15} /> Propiedades
          </RibbonAction>
        </div>
      </div>

      {createHint && (
        <div className="absolute left-1/2 top-20 z-30 -translate-x-1/2 rounded-lg border border-primary/40 bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary backdrop-blur">
          Haz clic en el piso para colocar: {createHint}
        </div>
      )}

      {/* Paleta de herramientas (izquierda) */}
      <div className="absolute left-3 top-1/2 z-30 hidden -translate-y-1/2 sm:block">
        <div className="flex flex-col gap-1.5 rounded-xl border border-border/70 bg-surface/85 p-1.5 shadow-xl shadow-black/40 backdrop-blur-md">
          <ToolButton title="Muro" onClick={() => startCreate('wall')}>
            <PlusIcon width={18} height={18} />
          </ToolButton>
          <ToolButton title="Puerta" onClick={() => startCreate('door')}>
            <LayersIcon width={18} height={18} />
          </ToolButton>
          <ToolButton title="Ventana" onClick={() => startCreate('window')}>
            <GridIcon width={18} height={18} />
          </ToolButton>
          <span className="my-0.5 h-px w-full bg-border" />
          <ToolButton
            title="Eliminar seleccion (Supr)"
            variant="danger"
            onClick={() => engineRef.current?.deleteSelected()}
            disabled={!selected}
          >
            <TrashIcon width={18} height={18} />
          </ToolButton>
          <ToolButton
            title="Mostrar/ocultar grilla (G)"
            active={gridVisible}
            onClick={() => setGridVisible((v) => !v)}
          >
            <GridIcon width={18} height={18} />
          </ToolButton>
        </div>
      </div>

      {/* Propiedades (derecha, flotante) */}
      {propsOpen && (
        <aside className="absolute right-3 top-20 bottom-12 z-30 flex w-72 flex-col gap-4 overflow-y-auto rounded-xl border border-border/70 bg-surface/90 p-4 shadow-xl shadow-black/40 backdrop-blur-md">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <CubeIcon width={16} height={16} className="text-primary" />
              {selected ? selected.name : 'Sin seleccion'}
            </h3>
            <p className="mt-1 text-xs text-muted">
              {selected
                ? `Tamaño: ${selected.size.x.toFixed(2)} x ${selected.size.y.toFixed(2)} x ${selected.size.z.toFixed(2)}`
                : 'Selecciona una pieza en el visor.'}
            </p>
          </div>

          <AxisGroup label="Posicion" values={position} step={0.1} disabled={!selected} onChange={(axis, value) => engineRef.current?.updatePosition(axis, value)} />
          <AxisGroup label="Rotacion (grados)" values={rotation} step={1} disabled={!selected} onChange={(axis, value) => engineRef.current?.updateRotation(axis, value)} />
          <AxisGroup label="Escala" values={scale} step={0.1} min={0.01} disabled={!selected} onChange={(axis, value) => engineRef.current?.updateScale(axis, value)} />

          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">Color</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color}
                onChange={(e) => {
                  setColor(e.target.value);
                  engineRef.current?.setSelectedColor(e.target.value);
                }}
                className="h-9 w-11 cursor-pointer rounded-md border border-border bg-surface-2"
                aria-label="Color del objeto"
              />
              <Button variant="ghost" size="sm" onClick={() => engineRef.current?.resetScale()}>
                Reset
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">Textura</span>
            <select
              className="cursor-pointer rounded-lg border border-border bg-surface-2 px-2 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
              value={texturePart}
              onChange={(e) => setTexturePart(e.target.value)}
            >
              <option value="wall_internal">Paredes</option>
              <option value="door">Puertas</option>
              <option value="window">Ventanas</option>
            </select>
            <select
              className="cursor-pointer rounded-lg border border-border bg-surface-2 px-2 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
              value={textureUrl}
              onChange={(e) => setTextureUrl(e.target.value)}
            >
              {TEXTURES.map((texture) => (
                <option key={texture.name} value={texture.url}>
                  {texture.name}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              onClick={() => {
                engineRef.current?.applyTexture(texturePart, textureUrl);
                toast.success('Textura aplicada', 'Se aplico la textura seleccionada.');
              }}
            >
              Aplicar textura
            </Button>
          </div>
        </aside>
      )}

      {/* Barra de estado (abajo) */}
      <div className="absolute inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-border/70 bg-surface/85 px-4 py-1.5 text-xs text-muted backdrop-blur-md">
        <div className="flex items-center gap-4">
          <span className="tabular-nums">
            {selected
              ? `X ${selected.position.x.toFixed(2)}  Y ${selected.position.y.toFixed(2)}  Z ${selected.position.z.toFixed(2)}`
              : 'Sin seleccion'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {isBusy && (
            <span className="flex items-center gap-1.5 text-primary">
              <Spinner className="h-3.5 w-3.5" /> Procesando...
            </span>
          )}
          <span className="hidden sm:inline">Modo: {mode === 'translate' ? 'Mover' : mode === 'rotate' ? 'Rotar' : 'Escalar'}</span>
          <span className="hidden md:inline">Espacio: {space === 'local' ? 'Local' : 'Mundo'}</span>
          <span className="hidden lg:inline">Snap: {snap || 'off'}</span>
          <span className="hidden lg:inline">W/E/R · G grilla · Supr borrar</span>
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70',
        active ? 'bg-primary text-white shadow-sm shadow-primary/25' : 'bg-surface-2 text-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function RibbonAction({
  onClick,
  disabled,
  title,
  active,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 disabled:cursor-not-allowed disabled:opacity-50',
        active ? 'bg-primary/15 text-primary' : 'text-muted hover:bg-surface-2 hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function ToolButton({
  title,
  onClick,
  disabled,
  active,
  variant,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  variant?: 'default' | 'danger';
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'bg-primary/15 text-primary'
          : variant === 'danger'
            ? 'text-muted hover:bg-danger/15 hover:text-danger'
            : 'text-muted hover:bg-surface-2 hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function AxisGroup({
  label,
  values,
  step,
  min,
  disabled,
  onChange,
}: {
  label: string;
  values: { x: number; y: number; z: number };
  step: number;
  min?: number;
  disabled?: boolean;
  onChange: (axis: 'x' | 'y' | 'z', value: number) => void;
}) {
  const axes = [
    { key: 'x' as const, tint: 'text-danger' },
    { key: 'y' as const, tint: 'text-success' },
    { key: 'z' as const, tint: 'text-primary' },
  ];
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      <div className="grid grid-cols-3 gap-2">
        {axes.map(({ key, tint }) => (
          <div key={key} className="flex flex-col gap-1">
            <span className={cn('text-[10px] font-semibold uppercase', tint)}>{key}</span>
            <Input
              type="number"
              step={step}
              min={min}
              disabled={disabled}
              value={Number(values[key].toFixed(2))}
              onChange={(e) => onChange(key, Number(e.target.value))}
              className="h-9 px-2 text-sm tabular-nums"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
