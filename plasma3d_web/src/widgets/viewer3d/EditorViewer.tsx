import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorEngine, type SelectedInfo, type TransformMode } from '@/widgets/viewer3d/engine';
import { TEXTURES, EMPTY_MODEL_URL } from '@/entities/model3D/three/textures';
import type { ElementType, ModelSummary } from '@/entities/model3D/three/Modelo3D';
import { useModelStore } from '@/entities/model3D/store';
import { useSession } from '@/entities/session/store';
import { env } from '@/shared/config/env';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Spinner } from '@/shared/ui/spinner';
import {
  CubeIcon,
  DownloadIcon,
  MoveIcon,
  PlusIcon,
  RotateIcon,
  SaveIcon,
  ScaleIcon,
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
  const [color, setColor] = useState('#ffffff');
  const [isBusy, setIsBusy] = useState(false);
  const [createHint, setCreateHint] = useState<ElementType | null>(null);

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
        if (model?.glb_model) {
          url = `${env.apiUrl}${String(model.glb_model).replace(/^\//, '')}`;
        }
      } catch {
        localStorage.removeItem('modelo');
      }
    }
    engine.loadModel(url, TEXTURES);

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    engineRef.current?.setSpace(space);
  }, [space]);

  useEffect(() => {
    engineRef.current?.setTranslationSnap(snap || null);
  }, [snap]);

  useEffect(() => {
    engineRef.current?.setRotationSnap(rotSnap || null);
  }, [rotSnap]);

  const startCreate = useCallback((type: ElementType) => {
    engineRef.current?.startCreate(type);
    setCreateHint(type);
    toast.info('Colocar elemento', 'Haz clic sobre el piso para ubicarlo.');
  }, []);

  async function buildFile(): Promise<File | null> {
    const engine = engineRef.current;
    if (!engine) return null;
    const raw = localStorage.getItem('modelo');
    let id = Date.now();
    try {
      id = JSON.parse(raw || '{}').id ?? id;
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
      const raw = localStorage.getItem('modelo');
      const id = JSON.parse(raw || '{}').id ?? Date.now();
      const { blob, filename } = await engine.exportGlb(`job_${id}.glb`);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename.endsWith('.glb') ? filename : `${filename}.glb`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
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
    } catch (error) {
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
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2">
          <ModeButton active={mode === 'translate'} onClick={() => setMode('translate')} title="Mover (W)">
            <MoveIcon width={16} height={16} /> Mover
          </ModeButton>
          <ModeButton active={mode === 'rotate'} onClick={() => setMode('rotate')} title="Rotar (E)">
            <RotateIcon width={16} height={16} /> Rotar
          </ModeButton>
          <ModeButton active={mode === 'scale'} onClick={() => setMode('scale')} title="Escalar (R)">
            <ScaleIcon width={16} height={16} /> Escalar
          </ModeButton>
          <span className="mx-1 h-6 w-px bg-slate-200" />
          <button
            className={cn(
              'rounded-md px-2 py-1 text-xs',
              space === 'local' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600',
            )}
            onClick={() => setSpace(space === 'local' ? 'world' : 'local')}
          >
            {space === 'local' ? 'Local' : 'Mundo'}
          </button>
          <span className="mx-1 h-6 w-px bg-slate-200" />
          <label className="flex items-center gap-1 text-xs text-slate-500">
            Snap
            <select
              className="rounded border border-slate-300 px-1 py-0.5 text-xs"
              value={snap}
              onChange={(e) => setSnap(Number(e.target.value))}
            >
              <option value={0}>off</option>
              <option value={0.25}>0.25</option>
              <option value={0.5}>0.5</option>
              <option value={1}>1</option>
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            Rot snap
            <select
              className="rounded border border-slate-300 px-1 py-0.5 text-xs"
              value={rotSnap}
              onChange={(e) => setRotSnap(Number(e.target.value))}
            >
              <option value={0}>off</option>
              <option value={15}>15°</option>
              <option value={45}>45°</option>
              <option value={90}>90°</option>
            </select>
          </label>
        </div>

        <div className="relative h-[60vh] min-h-[360px] overflow-hidden rounded-lg border border-slate-200 bg-slate-200">
          <canvas ref={canvasRef} className="h-full w-full" />
          {createHint && (
            <div className="absolute left-3 top-3 rounded-md bg-slate-900/80 px-3 py-1.5 text-xs text-white">
              Haz clic en el piso para colocar: {createHint}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => startCreate('wall')}>
            <PlusIcon width={16} height={16} /> Muro
          </Button>
          <Button variant="outline" size="sm" onClick={() => startCreate('door')}>
            <PlusIcon width={16} height={16} /> Puerta
          </Button>
          <Button variant="outline" size="sm" onClick={() => startCreate('window')}>
            <PlusIcon width={16} height={16} /> Ventana
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => engineRef.current?.deleteSelected()}
            disabled={!selected}
          >
            <TrashIcon width={16} height={16} /> Eliminar
          </Button>
          <Button variant="outline" size="sm" onClick={onExport} disabled={isBusy}>
            <DownloadIcon width={16} height={16} /> Exportar
          </Button>
          <Button variant="outline" size="sm" onClick={onSave} disabled={isBusy || !user}>
            <SaveIcon width={16} height={16} /> Guardar
          </Button>
          <Button variant="secondary" size="sm" onClick={onAnalyzeClick} disabled={isBusy}>
            Analizar
          </Button>
          <Button variant="secondary" size="sm" onClick={onBudgetClick}>
            Presupuesto
          </Button>
          <Button variant="ghost" size="sm" onClick={onOpenPrices}>
            Precios
          </Button>
        </div>
      </div>

      <aside className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <CubeIcon width={16} height={16} />
            {selected ? selected.name : 'Sin seleccion'}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {selected
              ? `Tamaño: ${selected.size.x.toFixed(2)} x ${selected.size.y.toFixed(2)} x ${selected.size.z.toFixed(2)}`
              : 'Selecciona una pieza en el visor.'}
          </p>
        </div>

        <AxisGroup
          label="Posicion"
          values={position}
          step={0.1}
          disabled={!selected}
          onChange={(axis, value) => engineRef.current?.updatePosition(axis, value)}
        />
        <AxisGroup
          label="Rotacion (grados)"
          values={rotation}
          step={1}
          disabled={!selected}
          onChange={(axis, value) => engineRef.current?.updateRotation(axis, value)}
        />
        <AxisGroup
          label="Escala"
          values={scale}
          step={0.1}
          min={0.01}
          disabled={!selected}
          onChange={(axis, value) => engineRef.current?.updateScale(axis, value)}
        />

        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Color</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={color}
              onChange={(e) => {
                setColor(e.target.value);
                engineRef.current?.setSelectedColor(e.target.value);
              }}
              className="h-8 w-10 cursor-pointer rounded border border-slate-300"
            />
            <Button variant="ghost" size="sm" onClick={() => engineRef.current?.resetScale()}>
              Reset escala
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
          <Label className="text-xs uppercase tracking-wide text-slate-500">Textura</Label>
          <select
            className="rounded-md border border-slate-300 px-2 py-2 text-sm"
            value={texturePart}
            onChange={(e) => setTexturePart(e.target.value)}
          >
            <option value="wall_internal">Paredes</option>
            <option value="door">Puertas</option>
            <option value="window">Ventanas</option>
          </select>
          <select
            className="rounded-md border border-slate-300 px-2 py-2 text-sm"
            value={textureUrl}
            onChange={(e) => setTextureUrl(e.target.value)}
          >
            {TEXTURES.map((texture) => (
              <option key={texture.url} value={texture.url}>
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

        {isBusy && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Spinner className="h-4 w-4" /> Procesando...
          </div>
        )}
      </aside>
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
        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition',
        active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
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
  return (
    <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <div className="grid grid-cols-3 gap-2">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <div key={axis} className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-slate-400">{axis}</span>
            <Input
              type="number"
              step={step}
              min={min}
              disabled={disabled}
              value={Number(values[axis].toFixed(2))}
              onChange={(e) => onChange(axis, Number(e.target.value))}
              className="h-8 px-2 text-sm"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
