import { useCallback, useEffect, useRef, useState } from 'react';
import { model3DApi } from '@/entities/model3D/api';
import {
  EditorEngine,
  type DraftInfo,
  type DrawType,
  type RoofDrawKind,
  type RoofMode,
  type SelectedInfo,
  type TransformMode,
  type ViewName,
} from '@/widgets/viewer3d/engine';
import { ViewCube } from '@/widgets/viewer3d/ViewCube';
import { AgentChat } from '@/widgets/viewer3d/AgentChat';
import {
  MEASURE_COLORS,
  MEASURE_KINDS,
  type MeasureKind,
  type MeasureDetail,
  type MeasureUnit,
} from '@/widgets/viewer3d/measurements';
import { LayersDialog } from '@/widgets/viewer3d/LayersDialog';
import { MaterialsDialog } from '@/widgets/viewer3d/MaterialsDialog';
import { NewMaterialDialog } from '@/widgets/viewer3d/NewMaterialDialog';
import { patternFor, patternPreview } from '@/widgets/viewer3d/proceduralTextures';
import { EFFECT_LABEL, effectFamily } from '@/widgets/viewer3d/materialEffects';
import { KIND_LABELS, describeMaterial, groupMaterials, materialTags } from '@/entities/materials/descriptions';
import { TEXTURES } from '@/entities/model3D/three/textures';
import { useLayerStore } from '@/entities/layers/store';
import { useMaterialStore } from '@/entities/materials/store';
import type { ModelSummary } from '@/entities/model3D/three/Modelo3D';
import { useModelStore } from '@/entities/model3D/store';
import { useSession } from '@/entities/session/store';
import { useThemeStore } from '@/entities/theme/store';
import { assetUrl } from '@/shared/lib/assetUrl';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Spinner } from '@/shared/ui/spinner';
import { LoadingOverlay } from '@/shared/ui/loader';
import { MaskIcon } from '@/shared/ui/MaskIcon';
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
  PlayCircleIcon,
  PointerIcon,
  RotateIcon,
  SaveIcon,
  ScaleIcon,
  SparklesIcon,
  TagIcon,
  TrashIcon,
  XIcon,
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

const ROOF_MODES: RoofMode[] = ['visible', 'transparente', 'oculto'];
const ROOF_LABELS: Record<RoofMode, string> = {
  visible: 'Visible',
  transparente: 'Transparente',
  oculto: 'Oculto',
};
const ROOF_STORAGE_KEY = 'plasma3d.roofMode';
const ROOF_DRAW_STORAGE_KEY = 'plasma3d.roofDrawKind';

const DRAW_LABELS: Record<DrawType, string> = {
  wall: 'muro',
  door: 'puerta',
  window: 'ventana',
  floor: 'piso',
  roof: 'techo',
};

const MEASURES_STORAGE_KEY = 'plasma3d.measures';
const MEASURE_UNITS: { id: MeasureUnit; label: string }[] = [
  { id: 'cm', label: 'Centímetros (cm)' },
  { id: 'm', label: 'Metros (m)' },
  { id: 'in', label: 'Pulgadas (pulg)' },
];
const MEASURE_KIND_LABELS: Record<MeasureKind, string> = {
  wall: 'Pared',
  roof: 'Techo',
  floor: 'Suelo',
  window: 'Ventana',
  door: 'Puerta',
};
const UNIT_SHORT: Record<MeasureUnit, string> = { cm: 'cm', m: 'm', in: 'pulg' };

function readStoredMeasures(): { unit: MeasureUnit; kinds: MeasureKind[]; detail: MeasureDetail } {
  try {
    const raw = JSON.parse(localStorage.getItem(MEASURES_STORAGE_KEY) || '{}') as {
      unit?: string;
      kinds?: string[];
      detail?: string;
    };
    const unit = MEASURE_UNITS.some((u) => u.id === raw.unit) ? (raw.unit as MeasureUnit) : 'm';
    const kinds = Array.isArray(raw.kinds)
      ? (raw.kinds.filter((k) => MEASURE_KINDS.includes(k as MeasureKind)) as MeasureKind[])
      : [];
    const detail: MeasureDetail = raw.detail === 'completo' ? 'completo' : 'largo';
    return { unit, kinds, detail };
  } catch {
    return { unit: 'm', kinds: [], detail: 'largo' };
  }
}

/** Pantalla de celular (por debajo del breakpoint `sm` de Tailwind). */
function isMobileViewport(): boolean {
  try {
    return window.matchMedia('(max-width: 639px)').matches;
  } catch {
    return false;
  }
}

function readStoredRoofDrawKind(): RoofDrawKind {
  try {
    return localStorage.getItem(ROOF_DRAW_STORAGE_KEY) === 'dos_aguas' ? 'dos_aguas' : 'plano';
  } catch {
    return 'plano';
  }
}

function nextRoofMode(mode: RoofMode): RoofMode {
  return ROOF_MODES[(ROOF_MODES.indexOf(mode) + 1) % ROOF_MODES.length];
}

function readStoredRoofMode(): RoofMode {
  try {
    const stored = localStorage.getItem(ROOF_STORAGE_KEY) as RoofMode | null;
    return stored && ROOF_MODES.includes(stored) ? stored : 'visible';
  } catch {
    return 'visible';
  }
}

const SHORTCUTS: { title: string; items: { action: string; keys: string }[] }[] = [
  {
    title: 'Vistas',
    items: [
      { action: 'Planta / Alzado / Perfil / Iso / 3D', keys: '1 / 2 / 3 / 4 / 5' },
      { action: 'Techo: visible / transparente / oculto', keys: 'T' },
      { action: 'Menú de medidas (cotas)', keys: 'M' },
      { action: 'Abrir / cerrar Agente IA', keys: 'I' },
      { action: 'Modo Animado (presentación)', keys: 'P' },
      { action: 'Zoom', keys: 'Rueda' },
      { action: 'Desplazar (pan)', keys: 'Botón derecho' },
    ],
  },
  {
    title: 'Transformar',
    items: [
      { action: 'Mover', keys: 'W' },
      { action: 'Rotar', keys: 'E' },
      { action: 'Medidas con tiradores (extremos, ancho, alto)', keys: 'R' },
      { action: 'Arrastrar la pieza seleccionada sobre el piso', keys: 'Clic + arrastrar' },
      { action: 'Mover en altura con el gizmo', keys: 'Mantener Alt' },
      { action: 'Girar 90°', keys: 'Q' },
      { action: 'Duplicar', keys: 'Ctrl+D' },
      { action: 'Cortar pared o piso (Shift+clic: otro eje)', keys: 'C' },
      { action: 'Deshacer / Rehacer', keys: 'Ctrl+Z / Ctrl+Y' },
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
      { action: 'Dibujar piso / techo (rectángulo)', keys: 'Arrastrar esquina a esquina' },
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
  const theme = useThemeStore((s) => s.theme);
  const layers = useLayerStore((s) => s.layers);
  const currentLayerId = useLayerStore((s) => s.currentLayerId);
  const materials = useMaterialStore((s) => s.materials);
  const showTextures = useMaterialStore((s) => s.showTextures);
  const setShowTextures = useMaterialStore((s) => s.setShowTextures);

  const [selected, setSelected] = useState<SelectedInfo | null>(null);
  // Botón "Colocar": la selección está cerca de otra pieza y se puede encajar.
  const [canSnap, setCanSnap] = useState(false);
  const [mode, setMode] = useState<TransformMode>('translate');
  const [history, setHistory] = useState({ canUndo: false, canRedo: false, cutMode: false });
  const [space, setSpace] = useState<'local' | 'world'>('local');
  const [snap, setSnap] = useState(0);
  const [rotSnap, setRotSnap] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // Autoguardado: 'saved' | 'dirty' (cambios pendientes) | 'saving' | 'error'.
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const autosaveTimer = useRef<number | undefined>(undefined);
  const saveNowRef = useRef<(silent: boolean) => Promise<void>>(async () => {});

  const [createHint, setCreateHint] = useState<DrawType | null>(null);
  const [roofDrawKind, setRoofDrawKind] = useState<RoofDrawKind>(readStoredRoofDrawKind);
  const [measuresOpen, setMeasuresOpen] = useState(false);
  const [measureUnit, setMeasureUnit] = useState<MeasureUnit>(() => readStoredMeasures().unit);
  const [measureKinds, setMeasureKinds] = useState<MeasureKind[]>(() => readStoredMeasures().kinds);
  const [measureDetail, setMeasureDetail] = useState<MeasureDetail>(() => readStoredMeasures().detail);
  const [modelLoading, setModelLoading] = useState(true);
  const [gridVisible, setGridVisible] = useState(true);
  // En celular el panel arranca cerrado y se abre al tocar una pieza.
  const [propsOpen, setPropsOpen] = useState(() => !isMobileViewport());
  const [multiSelect, setMultiSelect] = useState(false);
  const [lockVertical, setLockVertical] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [animated, setAnimated] = useState(false);
  const [fillGap, setFillGap] = useState(true);
  const [view, setViewState] = useState<ViewName>('planta');
  const [ortho, setOrtho] = useState(false);
  const [draft, setDraft] = useState<DraftInfo | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [newMaterialOpen, setNewMaterialOpen] = useState(false);
  const [tool, setTool] = useState<'select' | 'hand'>('select');
  const [roofMode, setRoofMode] = useState<RoofMode>(readStoredRoofMode);
  const [hasRoof, setHasRoof] = useState(false);
  const roofModeRef = useRef(roofMode);
  const hasRoofRef = useRef(false);
  const [modelId] = useState<number | string>(() => {
    try {
      return JSON.parse(localStorage.getItem('modelo') || '{}').id ?? '—';
    } catch {
      return '—';
    }
  });

  const runSnap = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const results = engine.snapSelectedPieces();
    const bad = results.find((r) => !r.ok);
    if (bad) toast.error('No se pudo colocar', bad.mensaje);
    else toast.success('Colocada', results.map((r) => r.mensaje).join(' '));
    setCanSnap(engine.canSnapSelected());
  }, []);

  const applyView = useCallback((next: ViewName) => {
    setViewState(next);
    engineRef.current?.setView(next);
  }, []);

  /** Lo que el Agente IA puede usar del editor (motor, vista y medidas). */
  const getAgentHost = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return null;
    return {
      engine,
      setView: applyView,
      setMeasures: (kinds: MeasureKind[], unit?: MeasureUnit) => {
        setMeasureKinds(kinds);
        if (unit) setMeasureUnit(unit);
      },
    };
  }, [applyView]);

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
    engine.setHistoryListener(setHistory);
    engine.setChangeListener(() => {
      dirtyRef.current = true;
      setSaveState('dirty');
      window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = window.setTimeout(() => void saveNowRef.current(true), 3000);
    });
    engine.setSelectionListener((info) => {
      setSelected(info);
      setCanSnap(info ? engine.canSnapSelected() : false);
      // Celular: tocar una pieza abre la hoja de Propiedades.
      if (info && isMobileViewport()) setPropsOpen(true);
      // Se dispara al crear y al borrar: mantiene el botón "Techo" al día.
      hasRoofRef.current = engine.hasRoof();
      setHasRoof(hasRoofRef.current);
    });
    engine.setDraftListener((info) => {
      setDraft(info);
      if (!info) setCreateHint(null);
    });
    engine.setMarqueeListener(setMarquee);
    engine.setPresentationListener(setAnimated);

    const raw = localStorage.getItem('modelo');
    let stored: { id?: number; glb_model?: string } | null = null;
    if (raw) {
      try {
        stored = JSON.parse(raw);
      } catch {
        localStorage.removeItem('modelo');
      }
    }
    // Pedir al servidor la versión ACTUAL del plano (la guardada en el
    // navegador puede apuntar a un GLB viejo ya reemplazado).
    let cancelled = false;
    const fresh = stored?.id
      ? model3DApi
          .list()
          .then((list) => list.find((m) => m.id === stored?.id) ?? null)
          .catch(() => null)
      : Promise.resolve(null);
    void fresh.then((latest) => {
      if (cancelled || engineRef.current !== engine) return;
      const model = latest ?? stored;
      if (latest) localStorage.setItem('modelo', JSON.stringify(latest));
      let url: string | null = null;
      if (model?.glb_model) {
        const base = assetUrl(String(model.glb_model));
        // ?v= evita que el navegador o el service worker den una copia vieja.
        url = `${base}${base.includes('?') ? '&' : '?'}v=${Date.now()}`;
      }
      loadInto(url);
    });
    const loadInto = (url: string | null) => engine.loadModel(url, TEXTURES, () => {
      setModelLoading(false);
      engine.setView('planta');
      hasRoofRef.current = engine.hasRoof();
      setHasRoof(hasRoofRef.current);
      engine.setRoofMode(roofModeRef.current);
    });
    const loadingFallback = window.setTimeout(() => setModelLoading(false), 25000);

    return () => {
      cancelled = true;
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
  useEffect(() => void engineRef.current?.setTheme(theme), [theme]);
  useEffect(() => void engineRef.current?.setOrthoMode(ortho), [ortho]);
  useEffect(() => void engineRef.current?.setToolMode(tool), [tool]);
  useEffect(() => void engineRef.current?.setMultiSelect(multiSelect), [multiSelect]);
  useEffect(() => void engineRef.current?.setLockVertical(lockVertical), [lockVertical]);
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
    roofModeRef.current = roofMode;
    engineRef.current?.setRoofMode(roofMode);
    try {
      localStorage.setItem(ROOF_STORAGE_KEY, roofMode);
    } catch {
      /* almacenamiento no disponible: solo no se recuerda */
    }
  }, [roofMode]);

  useEffect(() => {
    useLayerStore.getState().fetch().catch(() => undefined);
    useMaterialStore.getState().fetch().catch(() => undefined);
  }, []);

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
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) engineRef.current?.redo();
        else engineRef.current?.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        engineRef.current?.redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        engineRef.current?.duplicateSelection();
        return;
      }
      if (e.ctrlKey || e.metaKey) return;
      if (e.key === 'Alt') {
        e.preventDefault();
        engineRef.current?.setAllowVertical(true);
        return;
      }
      if (e.key === 'q' || e.key === 'Q') {
        engineRef.current?.rotateSelection90();
        return;
      }
      if (e.key === 'k' || e.key === 'K') {
        runSnap();
        return;
      }
      if (e.key === 'c' || e.key === 'C') {
        const engine = engineRef.current;
        engine?.setCutMode(!engine.isCutMode());
        return;
      }
      if (e.key === 'Shift') engineRef.current?.setLockVertical(true);
      if (e.key === 'w' || e.key === 'W') setMode('translate');
      else if (e.key === 'e' || e.key === 'E') setMode('rotate');
      else if (e.key === 'r' || e.key === 'R') setMode('scale');
      else if (e.key === 'g' || e.key === 'G') setGridVisible((v) => !v);
      else if (e.key === 'v' || e.key === 'V') setTool('select');
      else if (e.key === 'h' || e.key === 'H') setTool('hand');
      else if ((e.key === 't' || e.key === 'T') && hasRoofRef.current) setRoofMode(nextRoofMode);
      else if (e.key === 'm' || e.key === 'M') setMeasuresOpen((v) => !v);
      else if (e.key === 'i' || e.key === 'I') setAgentOpen((v) => !v);
      else if (e.key === 'p' || e.key === 'P') {
        const engine = engineRef.current;
        engine?.setPresentationMode(!engine.isPresentationMode());
      }
      else if (e.key === '1') applyView('planta');
      else if (e.key === '2') applyView('alzado');
      else if (e.key === '3') applyView('perfil');
      else if (e.key === '4') applyView('isometrica');
      else if (e.key === '5') applyView('3d');
      else if (e.key === 'Escape') {
        engineRef.current?.setPresentationMode(false);
        engineRef.current?.setCutMode(false);
        setMeasuresOpen(false);
        engineRef.current?.cancelDraft();
        setCreateHint(null);
      } else if (e.key === 'Delete' || e.key === 'Backspace') engineRef.current?.deleteSelected();
    };
    window.addEventListener('keydown', onKey);
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') engineRef.current?.setLockVertical(false);
      if (e.key === 'Alt') engineRef.current?.setAllowVertical(false);
    };
    const onBlur = () => {
      engineRef.current?.setLockVertical(false);
      engineRef.current?.setAllowVertical(false);
    };
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [applyView, runSnap]);

  const startCreate = useCallback((type: DrawType) => {
    engineRef.current?.startCreate(type);
    setCreateHint(type);
    if (type === 'floor' || type === 'roof') {
      toast.info(`Dibujar ${DRAW_LABELS[type]}`, 'Arrastra de una esquina a la opuesta. ESC para cancelar.');
    } else {
      toast.info('Dibujar elemento', 'Arrastra sobre el piso para definir inicio y fin. ESC para cancelar.');
    }
  }, []);

  useEffect(() => {
    engineRef.current?.setMeasureConfig(measureUnit, measureKinds, measureDetail);
    try {
      localStorage.setItem(
        MEASURES_STORAGE_KEY,
        JSON.stringify({ unit: measureUnit, kinds: measureKinds, detail: measureDetail }),
      );
    } catch {
      /* sin almacenamiento: solo no se recuerda */
    }
  }, [measureUnit, measureKinds, measureDetail]);

  useEffect(() => {
    engineRef.current?.setRoofDrawKind(roofDrawKind);
    try {
      localStorage.setItem(ROOF_DRAW_STORAGE_KEY, roofDrawKind);
    } catch {
      /* sin almacenamiento: solo no se recuerda */
    }
  }, [roofDrawKind]);

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

  async function onExport(format: 'glb' | 'gltf' | 'stl') {
    const engine = engineRef.current;
    if (!engine) return;
    setExportOpen(false);
    setIsBusy(true);
    try {
      const id = JSON.parse(localStorage.getItem('modelo') || '{}').id ?? Date.now();
      const filename = `job_${id}.${format}`;
      const { blob, filename: out } =
        format === 'glb'
          ? await engine.exportGlb(filename)
          : format === 'gltf'
            ? await engine.exportGltf(filename)
            : await engine.exportStl(filename);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = out;
      link.click();
      URL.revokeObjectURL(link.href);
      toast.success('Exportado', `Modelo exportado en ${format.toUpperCase()}.`);
    } catch {
      toast.error('Error', `No se pudo exportar el modelo en ${format.toUpperCase()}.`);
    } finally {
      setIsBusy(false);
    }
  }

  async function saveNow(silent: boolean) {
    if (!user) return;
    window.clearTimeout(autosaveTimer.current);
    if (savingRef.current) {
      // Ya hay un guardado en curso: reintentar cuando termine.
      autosaveTimer.current = window.setTimeout(() => void saveNowRef.current(silent), 800);
      return;
    }
    savingRef.current = true;
    dirtyRef.current = false;
    setSaveState('saving');
    if (!silent) setIsBusy(true);
    try {
      const file = await buildFile();
      if (!file) throw new Error('Sin modelo');
      const updated = await updateGlb(file, user.id);
      // Guardar la URL NUEVA: sin esto, F5 vuelve a cargar el GLB viejo.
      localStorage.setItem('modelo', JSON.stringify(updated));
      setSaveState(dirtyRef.current ? 'dirty' : 'saved');
      if (!silent) toast.success('Exito', 'Modelo guardado correctamente.');
    } catch {
      dirtyRef.current = true;
      setSaveState('error');
      if (!silent) toast.error('Error', 'No se pudo guardar el modelo.');
    } finally {
      savingRef.current = false;
      if (!silent) setIsBusy(false);
      if (dirtyRef.current) {
        autosaveTimer.current = window.setTimeout(() => void saveNowRef.current(true), 3000);
      }
    }
  }
  saveNowRef.current = saveNow;

  async function onSave() {
    await saveNow(false);
  }

  // Avisar antes de recargar/cerrar si quedan cambios sin guardar.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current && !savingRef.current) return;
      void saveNowRef.current(true);
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

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
        {/* En celular cada fila es una tira deslizable (sin saltos de línea) */}
        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto [&>*]:shrink-0 px-2 py-1.5 sm:flex-wrap sm:overflow-visible sm:px-3 sm:py-2">
          <div className="flex shrink-0 items-center gap-2 pr-1">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary ring-1 ring-inset ring-primary/30">
              <CubeIcon width={16} height={16} />
            </span>
            <span className="hidden text-sm font-semibold tracking-tight text-foreground sm:inline">
              Plano #{modelId}
            </span>
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

          <RibbonAction onClick={onSave} disabled={isBusy || !user} title="Guardar en el servidor (se guarda solo a los 3 s de cada cambio)">
            <SaveIcon width={15} height={15} /> <Lbl>Guardar</Lbl>
          </RibbonAction>
           Updated upstream
          <div className="relative">
            <RibbonAction
              onClick={() => setExportOpen((v) => !v)}
              disabled={isBusy}
              title="Exportar modelo (GLB, GLTF o STL)"
            >
              <DownloadIcon width={15} height={15} /> <Lbl>Exportar</Lbl>
            </RibbonAction>
            {exportOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-40 cursor-default"
                  aria-label="Cerrar menu de exportacion"
                  onClick={() => setExportOpen(false)}
                />
                <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-lg border border-border bg-surface p-1 shadow-xl shadow-black/40">
                  {(
                    [
                      { id: 'glb', label: 'GLB (binario)' },
                      { id: 'gltf', label: 'GLTF (JSON)' },
                      { id: 'stl', label: 'STL (geometría)' },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => void onExport(option.id)}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                    >
                      <DownloadIcon width={14} height={14} /> {option.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <span
            className={cn(
              'hidden whitespace-nowrap px-1 text-[11px] sm:inline',
              saveState === 'saved' && 'text-emerald-400',
              saveState === 'saving' && 'text-muted',
              saveState === 'dirty' && 'text-amber-400',
              saveState === 'error' && 'text-red-400',
            )}
            title={saveState === 'error' ? 'No se pudo guardar; se reintentará al siguiente cambio o pulsa Guardar' : undefined}
          >
            {saveState === 'saved' ? 'Guardado ✓' : saveState === 'saving' ? 'Guardando…' : saveState === 'dirty' ? 'Sin guardar' : 'Error al guardar'}
          </span>
          
        
          <RibbonAction onClick={onAnalyzeClick} disabled={isBusy} title="Analisis estructural">
            <SparklesIcon width={15} height={15} /> <Lbl>Analizar</Lbl>
          </RibbonAction>
          <RibbonAction onClick={onBudgetClick} disabled={isBusy} title="Generar presupuesto">
            <CalculatorIcon width={15} height={15} /> <Lbl>Presupuesto</Lbl>
          </RibbonAction>
          <RibbonAction onClick={onOpenPrices} title="Precios de materiales">
            <TagIcon width={15} height={15} /> <Lbl>Precios</Lbl>
          </RibbonAction>
          {/* Agente IA: brilla en celeste mientras el chat está abierto */}
          <button
            type="button"
            onClick={() => setAgentOpen((v) => !v)}
            aria-pressed={agentOpen}
            title={agentOpen ? 'Cerrar Agente IA (I)' : 'Abrir Agente IA (I)'}
            className={cn(
              'inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300',
              agentOpen
                ? 'p3d-agent-glow bg-cyan-400/10 text-cyan-200'
                : 'text-muted hover:bg-surface-2 hover:text-cyan-200',
            )}
          >
            <SparklesIcon width={15} height={15} /> <Lbl>Agente IA</Lbl>
          </button>
          {/* Animado: vista de presentación del modelo abierto (brilla en celeste mientras está activa) */}
          <button
            type="button"
            onClick={() => {
              const engine = engineRef.current;
              engine?.setPresentationMode(!engine.isPresentationMode());
            }}
            disabled={modelLoading}
            aria-pressed={animated}
            title={animated ? 'Volver al editor (P)' : 'Ver el modelo animado (P)'}
            className={cn(
              'inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-50',
              animated
                ? 'p3d-agent-glow bg-cyan-400/10 text-cyan-200'
                : 'text-muted hover:bg-surface-2 hover:text-cyan-200',
            )}
          >
            <PlayCircleIcon width={15} height={15} />{' '}
            <Lbl>{animated ? `Animado · ${showTextures ? 'Texturas' : 'Colores'}` : 'Animado'}</Lbl>
          </button>

          <div className="flex shrink-0 items-center gap-1 sm:ml-auto">
            <RibbonAction onClick={() => setLayersOpen(true)} title="Administrar capas">
              <LayersIcon width={15} height={15} /> <Lbl>Capas</Lbl>
            </RibbonAction>
            <RibbonAction onClick={() => setMaterialsOpen(true)} title="Biblioteca de materiales">
              <ImageIcon width={15} height={15} /> <Lbl>Materiales</Lbl>
            </RibbonAction>
            <RibbonAction onClick={() => setShortcutsOpen(true)} title="Ver atajos de teclado">
              <KeyboardIcon width={15} height={15} /> <Lbl>Atajos</Lbl>
            </RibbonAction>
            <RibbonAction onClick={() => setPropsOpen((v) => !v)} active={propsOpen} title="Mostrar/ocultar propiedades">
              <CubeIcon width={15} height={15} /> <Lbl>Propiedades</Lbl>
            </RibbonAction>
          </div>
        </div>

        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto [&>*]:shrink-0 border-t border-border/60 px-2 py-1.5 sm:flex-wrap sm:overflow-visible sm:px-3">
          <span className="hidden pr-1 text-[10px] font-semibold uppercase tracking-wide text-muted sm:inline">
            Transformar
          </span>
          {/* Equivalentes táctiles de Ctrl+clic y Shift (solo celular) */}
          <MobileToggle
            active={multiSelect}
            onClick={() => setMultiSelect((v) => !v)}
            title="Multiselección: cada toque agrega o quita piezas (reemplaza Ctrl+clic)"
          >
            Multi
          </MobileToggle>
          <MobileToggle
            active={lockVertical}
            onClick={() => setLockVertical((v) => !v)}
            title="Bloquear vertical al mover (reemplaza mantener Shift)"
          >
            Bloq. Y
          </MobileToggle>
          <ModeButton active={mode === 'translate'} onClick={() => setMode('translate')} title="Mover (W)">
            <MoveIcon width={15} height={15} /> <Lbl>Mover</Lbl>
          </ModeButton>
          <ModeButton active={mode === 'rotate'} onClick={() => setMode('rotate')} title="Rotar (E)">
            <RotateIcon width={15} height={15} /> <Lbl>Rotar</Lbl>
          </ModeButton>
          <ModeButton active={mode === 'scale'} onClick={() => setMode('scale')} title="Escalar (R)">
            <ScaleIcon width={15} height={15} /> <Lbl>Escalar</Lbl>
          </ModeButton>
          <ModeButton
            active={history.cutMode}
            onClick={() => engineRef.current?.setCutMode(!history.cutMode)}
            title="Cortar pared/piso (C): clic donde cortar. Shift+clic corta en el otro eje. Luego Supr borra el trozo."
          >
            <span aria-hidden>✂</span> <Lbl>Cortar</Lbl>
          </ModeButton>
          <ModeButton active={false} onClick={() => engineRef.current?.undo()} title="Deshacer (Ctrl+Z)">
            <span aria-hidden className={history.canUndo ? '' : 'opacity-40'}>↶</span>
          </ModeButton>
          <ModeButton active={false} onClick={() => engineRef.current?.redo()} title="Rehacer (Ctrl+Y)">
            <span aria-hidden className={history.canRedo ? '' : 'opacity-40'}>↷</span>
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
            <GridIcon width={15} height={15} /> <Lbl>Grilla</Lbl>
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
          {hasRoof && (
            <button
              onClick={() => setRoofMode(nextRoofMode)}
              className={cn(
                'inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70',
                roofMode !== 'visible' ? 'bg-primary/15 text-primary' : 'text-muted hover:bg-surface-2 hover:text-foreground',
              )}
              title="Techo visible / transparente / oculto (T). Transparente u oculto: el clic lo atraviesa para medir y seleccionar el interior. No se borra al guardar."
            >
              Techo: {ROOF_LABELS[roofMode]}
            </button>
          )}
          <MeasuresMenu
            open={measuresOpen}
            onOpenChange={setMeasuresOpen}
            unit={measureUnit}
            onUnitChange={setMeasureUnit}
            kinds={measureKinds}
            onKindsChange={setMeasureKinds}
            detail={measureDetail}
            onDetailChange={setMeasureDetail}
          />
        </div>
      </div>

      {/* Area de trabajo */}
      <div className="relative flex-1 overflow-hidden">
        <canvas ref={canvasRef} className={cn('absolute inset-0 h-full w-full', tool === 'hand' ? 'cursor-grab active:cursor-grabbing' : 'cursor-default')} />
        <LoadingOverlay show={modelLoading} label="Cargando modelo 3D..." />

        {canSnap && selected && (
          <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2">
            <Button size="sm" onClick={runSnap} title="Encaja la pieza con la pared, piso, puerta o ventana más cercana (K)">
              Colocar (K)
            </Button>
          </div>
        )}

        {marquee && (
          <div
            className="pointer-events-none absolute z-20 rounded-sm border border-primary bg-primary/20"
            style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
          />
        )}

        {createHint && (
          <div className="absolute left-1/2 top-3 z-30 flex w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary backdrop-blur">
            <span className="text-center">
              {draft
                ? draft.width !== undefined && draft.depth !== undefined
                  ? `Dibujando ${DRAW_LABELS[createHint]} · ${draft.width.toFixed(2)} × ${draft.depth.toFixed(2)} m · ${(draft.width * draft.depth).toFixed(1)} m² · ESC cancela`
                  : `Dibujando ${DRAW_LABELS[createHint]} · Longitud: ${draft.length.toFixed(2)} m · ESC cancela`
                : createHint === 'floor' || createHint === 'roof'
                  ? `Dibujar ${DRAW_LABELS[createHint]}: arrastra de esquina a esquina (ESC cancela)`
                  : `Dibujar ${DRAW_LABELS[createHint]}: arrastra sobre el piso (Shift = orto, ESC cancela)`}
            </span>
            {createHint === 'roof' && (
              <span className="flex overflow-hidden rounded-md border border-primary/40">
                {(['plano', 'dos_aguas'] as RoofDrawKind[]).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setRoofDrawKind(kind)}
                    className={cn(
                      'cursor-pointer px-2 py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70',
                      roofDrawKind === kind ? 'bg-primary text-white' : 'hover:bg-primary/20',
                    )}
                  >
                    {kind === 'plano' ? 'Plano' : 'Dos aguas'}
                  </button>
                ))}
              </span>
            )}
            {/* Equivale a Esc: imprescindible en celular */}
            <button
              type="button"
              onClick={() => {
                engineRef.current?.cancelDraft();
                setCreateHint(null);
              }}
              className="cursor-pointer rounded-md border border-primary/40 px-2 py-0.5 hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
              title="Cancelar dibujo (Esc)"
            >
              Cancelar
            </button>
          </div>
        )}

        {/* Paleta de herramientas: barra inferior en celular, columna izquierda en escritorio */}
        <div
          className={cn(
            'absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 z-30 max-w-[calc(100%-1rem)] -translate-x-1/2',
            'sm:bottom-auto sm:left-3 sm:top-1/2 sm:max-w-none sm:translate-x-0 sm:-translate-y-1/2',
            // En celular, con la hoja de Propiedades abierta, la paleta se oculta
            (propsOpen || agentOpen) && 'hidden sm:block',
          )}
        >
          <div className="no-scrollbar flex flex-row gap-1.5 overflow-x-auto rounded-xl border border-border/70 bg-surface/85 p-1.5 shadow-xl shadow-black/40 backdrop-blur-md [&>*]:shrink-0 sm:flex-col sm:overflow-visible">
            <ToolButton title="Seleccionar (V)" active={tool === 'select'} onClick={() => setTool('select')}>
              <PointerIcon width={18} height={18} />
            </ToolButton>
            <ToolButton title="Mano / Pan (H)" active={tool === 'hand'} onClick={() => setTool('hand')}>
              <MoveIcon width={18} height={18} />
            </ToolButton>
            <span className="mx-0.5 h-auto w-px self-stretch bg-border sm:mx-0 sm:my-0.5 sm:h-px sm:w-full" />
            <ToolButton title="Dibujar muro" onClick={() => startCreate('wall')}>
              <MaskIcon src="/icons/wall.svg" className="h-[18px] w-[18px]" />
            </ToolButton>
            <ToolButton title="Dibujar puerta" onClick={() => startCreate('door')}>
              <MaskIcon src="/icons/door.svg" className="h-[18px] w-[18px]" />
            </ToolButton>
            <ToolButton title="Dibujar ventana" onClick={() => startCreate('window')}>
              <MaskIcon src="/icons/window.svg" className="h-[18px] w-[18px]" />
            </ToolButton>
            <ToolButton title="Dibujar piso (rectángulo)" onClick={() => startCreate('floor')}>
              <MaskIcon src="/icons/floor.svg" className="h-[18px] w-[18px]" />
            </ToolButton>
            <ToolButton title="Dibujar techo (rectángulo, plano o dos aguas)" onClick={() => startCreate('roof')}>
              <MaskIcon src="/icons/roof.svg" className="h-[18px] w-[18px]" />
            </ToolButton>
            <span className="mx-0.5 h-auto w-px self-stretch bg-border sm:mx-0 sm:my-0.5 sm:h-px sm:w-full" />
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

        {/* Agente IA: chat a la derecha de la paleta (hoja inferior en celular) */}
        <AgentChat
          open={agentOpen}
          onClose={() => setAgentOpen(false)}
          modelId={modelId}
          getHost={getAgentHost}
        />

        {/* ViewCube / dado (esquina superior derecha) */}
        <ViewCube
          className="absolute right-2 top-2 z-30 origin-top-right scale-[0.65] sm:right-3 sm:top-3 sm:scale-100"
          getQuaternion={getCameraQuaternion}
          onDirection={handleDirection}
          onSelect={applyView}
        />

        {/* Propiedades (derecha, debajo del dado) */}
        {propsOpen && (
          <aside
            className={cn(
              // Celular: hoja inferior a todo el ancho (45 % del alto).
              'absolute inset-x-0 bottom-0 z-30 flex max-h-[45%] flex-col gap-4 overflow-y-auto rounded-t-2xl border border-border/70 bg-surface/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl shadow-black/40 backdrop-blur-md',
              // Escritorio: panel a la derecha, debajo del dado (como antes).
              'sm:inset-x-auto sm:right-3 sm:top-48 sm:bottom-3 sm:max-h-none sm:w-72 sm:rounded-xl sm:bg-surface/90 sm:pb-4',
            )}
          >
            <span className="mx-auto -mt-2 h-1 w-10 shrink-0 rounded-full bg-border-strong sm:hidden" aria-hidden="true" />
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <CubeIcon width={16} height={16} className="shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate">{selected ? selected.name : 'Sin seleccion'}</span>
                <button
                  type="button"
                  onClick={() => setPropsOpen(false)}
                  className="-mr-1 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 sm:hidden"
                  aria-label="Cerrar propiedades"
                >
                  <XIcon width={16} height={16} />
                </button>
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
                <div className="grid grid-cols-3 gap-1">
                  <Button variant="ghost" size="sm" onClick={() => engineRef.current?.resetToOriginal()} title="Volver a la medida con la que se creó o cargó">
                    Medida original
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => engineRef.current?.rotateSelection90()} title="Girar 90° (Q)">
                    Girar 90°
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => engineRef.current?.duplicateSelection()} title="Duplicar (Ctrl+D)">
                    Duplicar
                  </Button>
                </div>

                {/* Geometria */}
                {selected.kind === 'floor' && (
                  <div className="flex flex-col gap-2 border-t border-border pt-3">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted">Geometria</span>
                    <div className="grid grid-cols-2 gap-2">
                      <DimField label="Largo" value={selected.length} onChange={(v) => engineRef.current?.setSelectedDimension('length', v)} />
                      <DimField label="Ancho" value={selected.thickness} onChange={(v) => engineRef.current?.setSelectedDimension('thickness', v)} />
                      <DimField label="Espesor" value={selected.height} onChange={(v) => engineRef.current?.setSelectedDimension('height', v)} />
                    </div>
                  </div>
                )}
                {(selected.kind === 'wall' || selected.kind === 'door' || selected.kind === 'window') && (
                  <div className="flex flex-col gap-2 border-t border-border pt-3">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted">Geometria</span>
                    {selected.kind === 'wall' ? (
                      <div className="grid grid-cols-2 gap-2">
                        <DimField label="Longitud" value={selected.length} onChange={(v) => engineRef.current?.setSelectedDimension('length', v)} />
                        <DimField label="Angulo" value={selected.angle} onChange={(v) => engineRef.current?.updateRotation('y', v)} />
                        <DimField label="Grosor" value={selected.thickness} onChange={(v) => engineRef.current?.setSelectedDimension('thickness', v)} />
                        <DimField label="Altura" value={selected.height} onChange={(v) => engineRef.current?.setSelectedDimension('height', v)} />
                      </div>
                    ) : (
                      <>
                        {/* Puerta/ventana: se reconstruye con la medida nueva (no se estira) */}
                        <div className="grid grid-cols-2 gap-2">
                          <DimField label="Ancho" value={selected.width} onChange={(v) => engineRef.current?.setSelectedDimension('width', v)} />
                          <DimField label="Alto" value={selected.height} onChange={(v) => engineRef.current?.setSelectedDimension('height', v)} />
                          <DimField label="Espesor" value={selected.thickness} onChange={(v) => engineRef.current?.setSelectedDimension('thickness', v)} />
                          {selected.kind === 'window' ? (
                            <DimField label="Alfeizar" value={selected.sill} onChange={(v) => engineRef.current?.setSelectedElevation(v)} />
                          ) : (
                            <DimField label="Angulo" value={selected.angle} onChange={(v) => engineRef.current?.updateRotation('y', v)} />
                          )}
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                          <input
                            type="checkbox"
                            checked={fillGap}
                            onChange={(e) => setFillGap(e.target.checked)}
                            className="h-3.5 w-3.5 accent-[var(--color-primary)]"
                          />
                          Rellenar hueco hasta los muros (≤ 30 cm)
                        </label>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const results = engineRef.current?.snapSelectedOpenings(fillGap) ?? [];
                            const bad = results.find((r) => !r.ok);
                            if (bad) toast.error('No se pudo ajustar', bad.mensaje);
                            else toast.success('Ajustada al muro', results.map((r) => r.mensaje).join(' '));
                          }}
                          title="Alinea la pieza con el muro más cercano, la centra en su eje y le da su espesor"
                        >
                          Ajustar al muro
                        </Button>
                      </>
                    )}
                  </div>
                )}

                {/* Visualizacion 3D */}
                <div className="flex flex-col gap-2 border-t border-border pt-3">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted">Visualizacion 3D</span>
                  <select
                    value={selected.materialId}
                    onChange={(e) => {
                      if (e.target.value === '__new__') {
                        setNewMaterialOpen(true);
                        return;
                      }
                      engineRef.current?.setSelectedMaterial(e.target.value);
                    }}
                    className="cursor-pointer rounded-lg border border-border bg-surface-2 px-2 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                  >
                    <option value="">(sin material)</option>
                    {(() => {
                      const { recommended, groups } = groupMaterials(materials, selected.kind);
                      return (
                        <>
                          {recommended.length > 0 && (
                            <optgroup label={`Recomendados para ${KIND_LABELS[selected.kind] ?? 'esta pieza'}`}>
                              {recommended.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.nombre}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {groups.map((group) => (
                            <optgroup key={group.key} label={group.label}>
                              {group.items.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.nombre}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </>
                      );
                    })()}
                    <option value="__new__">＋ Nuevo material…</option>
                  </select>
                  {(() => {
                    const mat = materials.find((m) => m.id === selected.materialId);
                    if (!mat) return null;
                    return (
                      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2/40 p-2">
                        <div className="relative h-16 w-full overflow-hidden rounded-md border border-border" style={{ backgroundColor: mat.color_difuso }}>
                          {(() => {
                            // Misma textura que se verá en el modelo (Texturas ON y Animado).
                            const pattern = patternFor(mat, selected.kind);
                            if (pattern === 'vidrio') return null;
                            const custom = mat.textura_url && !mat.textura_url.startsWith('/static/');
                            return (
                              <img
                                src={custom ? mat.textura_url : patternPreview(pattern, mat.color_difuso)}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            );
                          })()}
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-foreground">{mat.nombre}</p>
                          <p className="text-[11px] leading-snug text-muted">{describeMaterial(mat)}</p>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {materialTags(mat).map((tag) => (
                            <span key={tag} className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted">
                              {tag}
                            </span>
                          ))}
                        </div>
                        <p className="flex items-start gap-1 text-[11px] text-cyan-200">
                          <PlayCircleIcon width={12} height={12} className="mt-0.5 shrink-0" />
                          En Animado: {EFFECT_LABEL[effectFamily(mat)]}
                        </p>
                        <p className="text-[10px] text-muted">Cambiar el material también cambia el presupuesto.</p>
                      </div>
                    );
                  })()}
                  <p className="text-[10px] text-muted">Texturas ON muestra además la imagen del material.</p>
                </div>
              </>
            )}
          </aside>
        )}
      </div>

      {/* Barra de estado fija (oculta en celular: no hay espacio y es info de teclado) */}
      <div className="hidden shrink-0 items-center justify-between gap-3 border-t border-border bg-surface/95 px-4 py-1.5 text-xs text-muted sm:flex">
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
          <span className="hidden lg:inline">1-5 vistas · W/E/R · G grilla · T techo · M medidas · I agente · Ctrl+clic/marco multi · Shift: orto / bloquea vertical · arrastra la pieza para moverla · R tiradores · K colocar · Q girar · Ctrl+D duplicar · Alt altura · C cortar · Ctrl+Z deshacer · Supr borrar</span>
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
      <NewMaterialDialog
        open={newMaterialOpen}
        onClose={() => setNewMaterialOpen(false)}
        onCreated={(id) => engineRef.current?.setSelectedMaterial(id)}
      />
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

/** Texto de un botón de barra: en celular se oculta y queda solo el ícono (el title da el nombre). */
function Lbl({ children }: { children: React.ReactNode }) {
  return <span className="hidden md:inline">{children}</span>;
}

/** Interruptor visible solo en celular (equivalente táctil de una tecla). */
function MobileToggle({
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
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex cursor-pointer items-center rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 sm:hidden',
        active ? 'bg-primary text-white' : 'bg-surface-2 text-muted',
      )}
    >
      {children}
    </button>
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
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => onChange(Math.max(0.05, Number((value - 0.1).toFixed(3))))}
          className="h-8 w-6 shrink-0 cursor-pointer rounded-md border border-border bg-surface-2 text-xs text-muted hover:text-foreground"
          title="-10 cm"
        >
          −
        </button>
        <input
          type="number"
          step="0.05"
          value={Number(value.toFixed(2))}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-8 w-full min-w-0 rounded-md border border-border bg-surface-2 px-1.5 text-xs tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
        />
        <button
          type="button"
          onClick={() => onChange(Number((value + 0.1).toFixed(3)))}
          className="h-8 w-6 shrink-0 cursor-pointer rounded-md border border-border bg-surface-2 text-xs text-muted hover:text-foreground"
          title="+10 cm"
        >
          +
        </button>
      </div>
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

interface MeasuresMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unit: MeasureUnit;
  onUnitChange: (unit: MeasureUnit) => void;
  kinds: MeasureKind[];
  onKindsChange: (kinds: MeasureKind[]) => void;
  detail: MeasureDetail;
  onDetailChange: (detail: MeasureDetail) => void;
}

/** Botón "Medidas" + menú: unidad (cm/m/pulg) y qué piezas acotar. */
function MeasuresMenu({
  open,
  onOpenChange,
  unit,
  onUnitChange,
  kinds,
  onKindsChange,
  detail,
  onDetailChange,
}: MeasuresMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const active = kinds.length > 0;

  // Posición fija bajo el botón: la barra es deslizable en celular y recortaría
  // un menú `absolute`. Se mantiene dentro de la pantalla.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = 224;
      setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onOpenChange(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open, onOpenChange]);

  const toggleKind = (kind: MeasureKind) => {
    onKindsChange(
      kinds.includes(kind)
        ? kinds.filter((k) => k !== kind)
        : MEASURE_KINDS.filter((k) => k === kind || kinds.includes(k)),
    );
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-haspopup="true"
        className={cn(
          'inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70',
          active || open ? 'bg-primary/15 text-primary' : 'text-muted hover:bg-surface-2 hover:text-foreground',
        )}
        title="Mostrar medidas reales sobre el plano (M)"
      >
        Medidas{active ? `: ${UNIT_SHORT[unit]}` : ''}
      </button>

      {open && pos && (
        <div
          role="menu"
          style={{ top: pos.top, left: pos.left, maxHeight: `calc(100dvh - ${pos.top + 12}px)` }}
          className="fixed z-50 w-56 overflow-y-auto rounded-xl border border-border/70 bg-surface/95 p-2 text-xs shadow-xl shadow-black/40 backdrop-blur-md"
        >
          <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">Unidad</p>
          <div className="flex flex-col">
            {MEASURE_UNITS.map((u) => (
              <button
                key={u.id}
                type="button"
                role="menuitemradio"
                aria-checked={unit === u.id}
                onClick={() => onUnitChange(u.id)}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70',
                  unit === u.id ? 'bg-primary/15 text-primary' : 'text-foreground hover:bg-surface-2',
                )}
              >
                <span
                  className={cn(
                    'h-3 w-3 rounded-full border',
                    unit === u.id ? 'border-primary bg-primary' : 'border-border-strong',
                  )}
                />
                {u.label}
              </button>
            ))}
          </div>

          <div className="my-1.5 h-px bg-border" />

          <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Mostrar medidas de</p>
          <div className="flex flex-col">
            {MEASURE_KINDS.map((kind) => {
              const checked = kinds.includes(kind);
              return (
                <button
                  key={kind}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={checked}
                  onClick={() => toggleKind(kind)}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-foreground transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                >
                  <span
                    className={cn(
                      'flex h-3.5 w-3.5 items-center justify-center rounded-sm border text-[9px] leading-none',
                      checked ? 'border-primary bg-primary text-white' : 'border-border-strong',
                    )}
                  >
                    {checked ? '✓' : ''}
                  </span>
                  <span className="flex-1">{MEASURE_KIND_LABELS[kind]}</span>
                  {/* Leyenda: mismo color que sus etiquetas en el visor */}
                  <span
                    aria-hidden="true"
                    className={cn('h-3 w-5 rounded-sm border', checked ? 'opacity-100' : 'opacity-40')}
                    style={{ backgroundColor: MEASURE_COLORS[kind], borderColor: MEASURE_COLORS[kind] }}
                  />
                </button>
              );
            })}
          </div>
          <p className="px-2 pt-1 text-[10px] leading-snug text-muted">
            Largo de cada tramo detectado, de punta a punta (ver línea de cota). En esquinas puede incluir el
            espesor del muro que cruza. Clic en una pieza para resaltar su medida.
          </p>

          <div className="my-1.5 h-px bg-border" />

          <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Detalle de paredes</p>
          <div className="flex gap-1 px-1 pb-1">
            {(
              [
                { id: 'largo', label: 'Solo largo' },
                { id: 'completo', label: 'Largo · alto · espesor' },
              ] as { id: MeasureDetail; label: string }[]
            ).map((d) => (
              <button
                key={d.id}
                type="button"
                role="menuitemradio"
                aria-checked={detail === d.id}
                onClick={() => onDetailChange(d.id)}
                className={cn(
                  'flex-1 cursor-pointer rounded-md border px-1.5 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70',
                  detail === d.id
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-border text-muted hover:bg-surface-2 hover:text-foreground',
                )}
              >
                {d.label}
              </button>
            ))}
          </div>

          <div className="my-1.5 h-px bg-border" />

          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onKindsChange([...MEASURE_KINDS])}
              className="flex-1 cursor-pointer rounded-md px-2 py-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
            >
              Mostrar todas
            </button>
            <button
              type="button"
              onClick={() => onKindsChange([])}
              disabled={!active}
              className="flex-1 cursor-pointer rounded-md px-2 py-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Ocultar todas
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
