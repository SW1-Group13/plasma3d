import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorEngine, type SelectedInfo, type TransformMode, type ViewName } from '@/widgets/viewer3d/engine';
import { ViewCube } from '@/widgets/viewer3d/ViewCube';
import { LayersDialog } from '@/widgets/viewer3d/LayersDialog';
import { MaterialsDialog } from '@/widgets/viewer3d/MaterialsDialog';
import { TEXTURES, EMPTY_MODEL_URL } from '@/entities/model3D/three/textures';
import { useLayerStore } from '@/entities/layers/store';
import { useMaterialStore } from '@/entities/materials/store';
import type { ElementType, ModelSummary } from '@/entities/model3D/three/Modelo3D';
import { useModelStore } from '@/entities/model3D/store';
import { useSession } from '@/entities/session/store';
import { assetUrl } from '@/shared/lib/assetUrl';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Spinner } from '@/shared/ui/spinner';
import { LoadingOverlay } from '@/shared/ui/loader';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import {
  CalculatorIcon,
  CubeIcon,
  DownloadIcon,
  GridIcon,
  ImageIcon,
  KeyboardIcon,
  LayersIcon,
  MoveIcon,
  PlusIcon,
  PointerIcon,
  RotateIcon,
  SaveIcon,
  ScaleIcon,
  SparklesIcon,
  TagIcon,
  TrashIcon,
} from '@/shared/ui/icons';
import { cn } from '@/shared/lib/utils';
import { toast } from '@/shared/ui/toast';

const VIEWS: { id: ViewName; label: string }[] = [
  { id: 'planta', label: 'Planta' },
  { id: 'alzado', label: 'Alzado' },
  { id: 'perfil', label: 'Perfil' },
  { id: 'isometrica', label: 'Iso' },
  { id: '3d', label: '3D' },
];

const SHORTCUTS: { title: string; items: { action: string; keys: string }[] }[] = [
  {
    title: 'Vistas',
    items: [
      { action: 'Planta / Alzado / Perfil / Iso / 3D', keys: '1 / 2 / 3 / 4 / 5' },
      { action: 'Zoom', keys: 'Rueda' },
      { action: 'Desplazar (pan)', keys: 'Botón derecho' },
    ],
  },
  {
    title: 'Transformar',
    items: [
      { action: 'Mover', keys: 'W' },
      { action: 'Rotar', keys: 'E' },
      { action: 'Escalar', keys: 'R' },
    ],
  },
  {
    title: 'Herramientas',
    items: [
      { action: 'Seleccionar', keys: 'V' },
      { action: 'Mano / desplazar la vista (pan)', keys: 'H' },
    ],
  },
  {
    title: 'Dibujo',
    items: [
      { action: 'Dibujar muro / puerta / ventana', keys: 'Arrastrar' },
      { action: 'Restringir a 0/90° (Orto)', keys: 'Shift' },
      { action: 'Mostrar / ocultar grilla', keys: 'G' },
      { action: 'Cancelar dibujo', keys: 'Esc' },
    ],
  },
  {
    title: 'Selección',
    items: [
      { action: 'Seleccionar', keys: 'Clic' },
      { action: 'Agregar / quitar de la selección', keys: 'Ctrl + Clic' },
      { action: 'Marco de selección (vistas fijas)', keys: 'Arrastrar' },
      { action: 'Eliminar selección', keys: 'Supr' },
    ],
  },
];

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
  const layers = useLayerStore((s) => s.layers);
  const currentLayerId = useLayerStore((s) => s.currentLayerId);
  const materials = useMaterialStore((s) => s.materials);
  const showTextures = useMaterialStore((s) => s.showTextures);
  const setShowTextures = useMaterialStore((s) => s.setShowTextures);

  const [selected, setSelected] = useState<SelectedInfo | null>(null);
  const [mode, setMode] = useState<TransformMode>('translate');
  const [space, setSpace] = useState<'local' | 'world'>('local');
  const [snap, setSnap] = useState(0);
  const [rotSnap, setRotSnap] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [createHint, setCreateHint] = useState<ElementType | null>(null);
  const [modelLoading, setModelLoading] = useState(true);
  const [gridVisible, setGridVisible] = useState(true);
  const [propsOpen, setPropsOpen] = useState(true);
  const [view, setViewState] = useState<ViewName>('planta');
  const [ortho, setOrtho] = useState(false);
  const [draft, setDraft] = useState<{ type: ElementType; length: number } | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [tool, setTool] = useState<'select' | 'hand'>('select');
  const [modelId] = useState<number | string>(() => {
    try {
      return JSON.parse(localStorage.getItem('modelo') || '{}').id ?? '—';
    } catch {
      return '—';
    }
  });

  const applyView = useCallback((next: ViewName) => {
    setViewState(next);
    engineRef.current?.setView(next);
  }, []);

  const getCameraQuaternion = useCallback(
    () => engineRef.current?.getCameraQuaternion() ?? null,
    [],
  );

  const handleDirection = useCallback((dir: { x: number; y: number; z: number }, ortho = true) => {
    const name = engineRef.current?.setViewDirection(dir.x, dir.y, dir.z, ortho);
    if (name) setViewState(name);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new EditorEngine(canvas);
    engineRef.current = engine;
    engine.setSelectionListener(setSelected);
    engine.setDraftListener((info) => {
      setDraft(info);
      if (!info) setCreateHint(null);
    });
    engine.setMarqueeListener(setMarquee);

    const raw = localStorage.getItem('modelo');
    let url = EMPTY_MODEL_URL;
    if (raw) {
      try {
        const model = JSON.parse(raw);
        if (model?.glb_model) url = assetUrl(String(model.glb_model));
      } catch {
        localStorage.removeItem('modelo');
      }
    }
    engine.loadModel(url, TEXTURES, () => {
      setModelLoading(false);
      engine.setView('planta');
    });
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
  useEffect(() => void engineRef.current?.setOrthoMode(ortho), [ortho]);
  useEffect(() => void engineRef.current?.setToolMode(tool), [tool]);
  useEffect(() => {
    engineRef.current?.setLayers(layers, currentLayerId);
  }, [layers, currentLayerId]);
  useEffect(() => {
    engineRef.current?.setMaterials(materials);
  }, [materials]);
  useEffect(() => {
    engineRef.current?.setShowTextures(showTextures);
  }, [showTextures]);

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
      else if (e.key === 'v' || e.key === 'V') setTool('select');
      else if (e.key === 'h' || e.key === 'H') setTool('hand');
      else if (e.key === '1') applyView('planta');
      else if (e.key === '2') applyView('alzado');
      else if (e.key === '3') applyView('perfil');
      else if (e.key === '4') applyView('isometrica');
      else if (e.key === '5') applyView('3d');
      else if (e.key === 'Escape') {
        engineRef.current?.cancelDraft();
        setCreateHint(null);
      } else if (e.key === 'Delete' || e.key === 'Backspace') engineRef.current?.deleteSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applyView]);

  const startCreate = useCallback((type: ElementType) => {
    engineRef.current?.startCreate(type);
    setCreateHint(type);
    toast.info('Dibujar elemento', 'Arrastra sobre el piso para definir inicio y fin. ESC para cancelar.');
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
    <div className="flex h-[calc(100dvh-4rem)] flex-col bg-canvas">
      {/* Barra superior fija (estilo ventana) */}
      <div className="shrink-0 border-b border-border bg-surface/95 shadow-lg shadow-black/20">
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
          <div className="flex items-center gap-2 pr-1">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary ring-1 ring-inset ring-primary/30">
              <CubeIcon width={16} height={16} />
            </span>
            <span className="text-sm font-semibold tracking-tight text-foreground">Plano #{modelId}</span>
          </div>

          <Divider />

          <div className="flex items-center gap-1">
            {VIEWS.map((v) => (
              <ViewButton key={v.id} active={view === v.id} onClick={() => applyView(v.id)} title={`Vista ${v.label}`}>
                {v.label}
              </ViewButton>
            ))}
          </div>

          <Divider />

          <RibbonAction onClick={onSave} disabled={isBusy || !user} title="Guardar en el servidor">
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

          <div className="ml-auto flex items-center gap-1">
            <RibbonAction onClick={() => setLayersOpen(true)} title="Administrar capas">
              <LayersIcon width={15} height={15} /> Capas
            </RibbonAction>
            <RibbonAction onClick={() => setMaterialsOpen(true)} title="Biblioteca de materiales">
              <ImageIcon width={15} height={15} /> Materiales
            </RibbonAction>
            <RibbonAction onClick={() => setShortcutsOpen(true)} title="Ver atajos de teclado">
              <KeyboardIcon width={15} height={15} /> Atajos
            </RibbonAction>
            <RibbonAction onClick={() => setPropsOpen((v) => !v)} active={propsOpen} title="Mostrar/ocultar propiedades">
              <CubeIcon width={15} height={15} /> Propiedades
            </RibbonAction>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 px-3 py-1.5">
          <span className="pr-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Transformar</span>
          <ModeButton active={mode === 'translate'} onClick={() => setMode('translate')} title="Mover (W)">
            <MoveIcon width={15} height={15} /> Mover
          </ModeButton>
          <ModeButton active={mode === 'rotate'} onClick={() => setMode('rotate')} title="Rotar (E)">
            <RotateIcon width={15} height={15} /> Rotar
          </ModeButton>
          <ModeButton active={mode === 'scale'} onClick={() => setMode('scale')} title="Escalar (R)">
            <ScaleIcon width={15} height={15} /> Escalar
          </ModeButton>

          <Divider />

          <button
            onClick={() => setSpace(space === 'local' ? 'world' : 'local')}
            className="cursor-pointer rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
            title="Alternar espacio local / mundo"
          >
            Espacio: {space === 'local' ? 'Local' : 'Mundo'}
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

          <Divider />

          <button
            onClick={() => setGridVisible((v) => !v)}
            className={cn(
              'inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70',
              gridVisible ? 'bg-primary/15 text-primary' : 'text-muted hover:bg-surface-2 hover:text-foreground',
            )}
            title="Mostrar/ocultar grilla (G)"
          >
            <GridIcon width={15} height={15} /> Grilla
          </button>
          <button
            onClick={() => setOrtho((v) => !v)}
            className={cn(
              'inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70',
              ortho ? 'bg-primary/15 text-primary' : 'text-muted hover:bg-surface-2 hover:text-foreground',
            )}
            title="Modo orto persistente (o manten Shift al dibujar)"
          >
            Orto
          </button>
          <button
            onClick={() => setShowTextures(!showTextures)}
            className={cn(
              'inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70',
              showTextures ? 'bg-primary/15 text-primary' : 'text-muted hover:bg-surface-2 hover:text-foreground',
            )}
            title="Mostrar texturas (Realista) / colores planos (Sombreado)"
          >
            Texturas: {showTextures ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Area de trabajo */}
      <div className="relative flex-1 overflow-hidden">
        <canvas ref={canvasRef} className={cn('absolute inset-0 h-full w-full', tool === 'hand' ? 'cursor-grab active:cursor-grabbing' : 'cursor-default')} />
        <LoadingOverlay show={modelLoading} label="Cargando modelo 3D..." />

        {marquee && (
          <div
            className="pointer-events-none absolute z-20 rounded-sm border border-primary bg-primary/20"
            style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
          />
        )}

        {createHint && (
          <div className="absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-lg border border-primary/40 bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary backdrop-blur">
            {draft
              ? `Dibujando ${createHint} · Longitud: ${draft.length.toFixed(2)} m · ESC cancela`
              : `Dibujar ${createHint}: arrastra sobre el piso (Shift = orto, ESC cancela)`}
          </div>
        )}

        {/* Paleta de herramientas (izquierda) */}
        <div className="absolute left-3 top-1/2 z-30 hidden -translate-y-1/2 sm:block">
          <div className="flex flex-col gap-1.5 rounded-xl border border-border/70 bg-surface/85 p-1.5 shadow-xl shadow-black/40 backdrop-blur-md">
            <ToolButton title="Seleccionar (V)" active={tool === 'select'} onClick={() => setTool('select')}>
              <PointerIcon width={18} height={18} />
            </ToolButton>
            <ToolButton title="Mano / Pan (H)" active={tool === 'hand'} onClick={() => setTool('hand')}>
              <MoveIcon width={18} height={18} />
            </ToolButton>
            <span className="my-0.5 h-px w-full bg-border" />
            <ToolButton title="Dibujar muro" onClick={() => startCreate('wall')}>
              <PlusIcon width={18} height={18} />
            </ToolButton>
            <ToolButton title="Dibujar puerta" onClick={() => startCreate('door')}>
              <LayersIcon width={18} height={18} />
            </ToolButton>
            <ToolButton title="Dibujar ventana" onClick={() => startCreate('window')}>
              <GridIcon width={18} height={18} />
            </ToolButton>
            <span className="my-0.5 h-px w-full bg-border" />
            <ToolButton
              title="Eliminar seleccion(es) (Supr)"
              variant="danger"
              onClick={() => engineRef.current?.deleteSelected()}
              disabled={!selected}
            >
              <TrashIcon width={18} height={18} />
            </ToolButton>
          </div>
        </div>

        {/* ViewCube / dado (esquina superior derecha) */}
        <ViewCube
          className="absolute right-3 top-3 z-30"
          getQuaternion={getCameraQuaternion}
          onDirection={handleDirection}
          onSelect={applyView}
        />

        {/* Propiedades (derecha, debajo del dado) */}
        {propsOpen && (
          <aside className="absolute right-3 top-48 bottom-3 z-30 flex w-72 flex-col gap-4 overflow-y-auto rounded-xl border border-border/70 bg-surface/90 p-4 shadow-xl shadow-black/40 backdrop-blur-md">
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

            {selected && (
              <>
                {/* General */}
                <div className="flex flex-col gap-2 border-t border-border pt-3">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted">General</span>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted">Capa</span>
                    <select
                      value={selected.layerId}
                      onChange={(e) => engineRef.current?.setSelectedLayer(e.target.value)}
                      className="w-40 cursor-pointer rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-foreground"
                    >
                      {layers.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.nombre}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted">Color</span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={selected.color !== 'bylayer' ? selected.color : selected.effectiveColor}
                        onChange={(e) => engineRef.current?.setSelectedColorOverride(e.target.value)}
                        className="h-7 w-9 cursor-pointer rounded border border-border bg-surface-2"
                        aria-label="Color del objeto"
                      />
                      <button
                        onClick={() => engineRef.current?.setSelectedColorOverride('bylayer')}
                        className={cn(
                          'rounded px-1.5 py-1 text-[10px]',
                          selected.color === 'bylayer' ? 'bg-primary/15 text-primary' : 'text-muted hover:bg-surface-2',
                        )}
                      >
                        ByLayer
                      </button>
                    </div>
                  </div>
                  <PropRow label="Tipo línea" value={selected.lineType} />
                  <PropRow label="Grosor" value={`${selected.lineWidth.toFixed(2)} mm`} />
                  <PropRow label="Transparencia" value={`${selected.transparency}%`} />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted">Elevación</span>
                    <input
                      type="number"
                      step="0.1"
                      value={Number(selected.elevation.toFixed(2))}
                      onChange={(e) => engineRef.current?.setSelectedElevation(Number(e.target.value))}
                      className="w-20 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs tabular-nums text-foreground"
                    />
                  </div>
                </div>

                {/* Transformar */}
                <AxisGroup label="Posicion" values={position} step={0.1} disabled={!selected || selected.count > 1} onChange={(axis, value) => engineRef.current?.updatePosition(axis, value)} />
                <AxisGroup label="Rotacion (grados)" values={rotation} step={1} disabled={!selected || selected.count > 1} onChange={(axis, value) => engineRef.current?.updateRotation(axis, value)} />
                <AxisGroup label="Escala" values={scale} step={0.1} min={0.01} disabled={!selected || selected.count > 1} onChange={(axis, value) => engineRef.current?.updateScale(axis, value)} />
                <Button variant="ghost" size="sm" onClick={() => engineRef.current?.resetScale()}>
                  Reset escala
                </Button>

                {/* Geometria */}
                {(selected.kind === 'wall' || selected.kind === 'door' || selected.kind === 'window') && (
                  <div className="flex flex-col gap-2 border-t border-border pt-3">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted">Geometria</span>
                    <div className="grid grid-cols-2 gap-2">
                      <DimField label="Longitud" value={selected.length} onChange={(v) => engineRef.current?.setSelectedDimension('length', v)} />
                      <DimField label="Angulo" value={selected.angle} onChange={(v) => engineRef.current?.updateRotation('y', v)} />
                      {selected.kind === 'wall' ? (
                        <DimField label="Grosor" value={selected.thickness} onChange={(v) => engineRef.current?.setSelectedDimension('thickness', v)} />
                      ) : (
                        <DimField label="Ancho" value={selected.width} onChange={(v) => engineRef.current?.setSelectedDimension('width', v)} />
                      )}
                      <DimField label="Altura" value={selected.height} onChange={(v) => engineRef.current?.setSelectedDimension('height', v)} />
                      {selected.kind === 'window' && (
                        <DimField label="Alfeizar" value={selected.sill} onChange={(v) => engineRef.current?.setSelectedElevation(v)} />
                      )}
                    </div>
                  </div>
                )}

                {/* Visualizacion 3D */}
                <div className="flex flex-col gap-2 border-t border-border pt-3">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted">Visualizacion 3D</span>
                  <select
                    value={selected.materialId}
                    onChange={(e) => engineRef.current?.setSelectedMaterial(e.target.value)}
                    className="cursor-pointer rounded-lg border border-border bg-surface-2 px-2 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                  >
                    <option value="">(sin material)</option>
                    {materials.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nombre}
                      </option>
                    ))}
                  </select>
                  {(() => {
                    const mat = materials.find((m) => m.id === selected.materialId);
                    if (!mat) return null;
                    return mat.textura_url ? (
                      <img src={mat.textura_url} alt={mat.nombre} className="h-20 w-full rounded-lg border border-border object-cover" />
                    ) : (
                      <div className="h-20 w-full rounded-lg border border-border" style={{ backgroundColor: mat.color_difuso }} />
                    );
                  })()}
                  <p className="text-[10px] text-muted">El material se ve con Texturas ON (Realista).</p>
                </div>
              </>
            )}
          </aside>
        )}
      </div>

      {/* Barra de estado fija */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-surface/95 px-4 py-1.5 text-xs text-muted">
        <span className="tabular-nums">
          {selected
            ? `X ${selected.position.x.toFixed(2)}  Y ${selected.position.y.toFixed(2)}  Z ${selected.position.z.toFixed(2)}`
            : 'Sin seleccion'}
        </span>
        <div className="flex items-center gap-3">
          {isBusy && (
            <span className="flex items-center gap-1.5 text-primary">
              <Spinner className="h-3.5 w-3.5" /> Procesando...
            </span>
          )}
          <span className="hidden sm:inline">Herramienta: {tool === 'hand' ? 'Mano' : 'Seleccionar'}</span>
          <span className="hidden sm:inline">Vista: {VIEWS.find((v) => v.id === view)?.label ?? view}</span>
          <span className="hidden md:inline">Modo: {mode === 'translate' ? 'Mover' : mode === 'rotate' ? 'Rotar' : 'Escalar'}</span>
          <span className="hidden lg:inline">1-5 vistas · W/E/R · G grilla · Ctrl+clic/marco multi · Shift orto · Supr borrar</span>
        </div>
      </div>

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyboardIcon width={18} height={18} className="text-accent" /> Atajos de teclado
            </DialogTitle>
            <DialogDescription>Trabaja mas rapido en el editor 3D.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 text-sm">
            {SHORTCUTS.map((group) => (
              <div key={group.title}>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  {group.title}
                </h4>
                <dl className="flex flex-col gap-1.5">
                  {group.items.map((item) => (
                    <div key={item.action} className="flex items-center justify-between gap-4">
                      <dd className="text-foreground/80">{item.action}</dd>
                      <dt className="flex shrink-0 gap-1">
                        {item.keys.split(' + ').map((k) => (
                          <kbd
                            key={k}
                            className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-foreground"
                          >
                            {k}
                          </kbd>
                        ))}
                      </dt>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <LayersDialog open={layersOpen} onClose={() => setLayersOpen(false)} />
      <MaterialsDialog
        open={materialsOpen}
        onClose={() => setMaterialsOpen(false)}
        onAssign={(id) => {
          engineRef.current?.setSelectedMaterial(id);
          toast.success('Material asignado', 'Se aplico a la seleccion.');
        }}
      />
    </div>
  );
}

function Divider() {
  return <span className="mx-0.5 hidden h-6 w-px bg-border sm:block" />;
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

function ViewButton({
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
        'cursor-pointer rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70',
        active ? 'bg-primary text-white shadow-sm shadow-primary/25' : 'text-muted hover:bg-surface-2 hover:text-foreground',
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

function PropRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-xs text-foreground/80">{value}</span>
    </div>
  );
}

function DimField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted">{label}</span>
      <input
        type="number"
        step="0.05"
        value={Number(value.toFixed(2))}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 rounded-md border border-border bg-surface-2 px-2 text-xs tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
      />
    </label>
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
