import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  agentApi,
  StreamUnavailableError,
  type AgentAction,
  type AgentActionResult,
  type AgentConfig,
  type AgentProvider,
  type AgentStep,
  type AgentStepRequest,
  type GeminiContent,
} from '@/entities/agent/api';
import { chipsFor } from '@/widgets/viewer3d/agentChips';
import {
  confirmAgentAction,
  prepareAgentAction,
  prepareAgentExtras,
  prepareAgentMoveAction,
  prepareAgentPlan,
  runAgentAction,
  type AgentHost,
  type AgentMovePreparation,
} from '@/widgets/viewer3d/agentActions';
import type { AgentMoveProposal, AgentPreviewExtra, AgentPreviewItem, EditorEngine } from '@/widgets/viewer3d/engine';
import { useSession } from '@/entities/session/store';
import { ImageIcon, SparklesIcon, XIcon } from '@/shared/ui/icons';
import { cn } from '@/shared/lib/utils';
import { toast } from '@/shared/ui/toast';

interface AgentChatProps {
  open: boolean;
  onClose: () => void;
  /** Id del plano: la conversación se guarda por plano. */
  modelId: number | string;
  /** Acceso al editor (motor, vista, medidas) para ejecutar acciones. */
  getHost: () => Omit<AgentHost, 'confirm'> | null;
  /** Selección actual del editor (para las sugerencias rápidas). */
  selection?: { kind?: string | null; count: number };
  /** El modelo tiene plano original (chip de comparar). */
  hasPlan?: boolean;
}

/** Elemento del hilo del chat. */
type ChatItem =
  | { kind: 'msg'; rol: 'usuario' | 'agente'; texto: string; imagen?: string; modelo?: string }
  | { kind: 'action'; id: number; texto: string; ok: boolean; transactionId?: number; undone?: boolean }
  | { kind: 'confirm'; id: number; texto: string; status: 'pending' | 'yes' | 'no' }
  | {
      kind: 'plan';
      id: number;
      titulo: string;
      pasos: Array<{ descripcion: string; texto?: string; error?: string }>;
      costo?: number;
      status: 'pending' | 'ejecutar' | 'cambiar' | 'cancelar';
    };

interface Stored {
  items: ChatItem[];
  historial: GeminiContent[];
}

type ActionStep = Extract<AgentStep, { estado: 'acciones' }>;
type PendingTurn =
  | {
      stage: 'request';
      turnId: string;
      text: string;
      round: number;
      request: AgentStepRequest;
      applied: Record<string, AgentActionResult>;
    }
  | { stage: 'applying'; turnId: string; text: string; round: number };

interface PreviewState {
  labels: string[];
  location: string;
  warnings: string[];
  revision: number;
  blockingReason?: string;
}

interface PreviewWaiter {
  engine: EditorEngine;
  items: AgentPreviewItem[];
  extras: AgentPreviewExtra[];
  moveProposal?: AgentMoveProposal;
  resolve: (apply: boolean) => void;
  revision: number;
  modelRevision: number;
}

const MAX_ITEMS = 80;
const MAX_ROUNDS = 8; // idas y vueltas acciones → resultados por pregunta (incluye autorrevisión)
const MAX_REVIEW_ROUNDS = 2;
const PROVIDER_LABEL: Record<string, string> = { gemini: 'Gemini', deepseek: 'DeepSeek', ollama: 'Ollama (local)' };

type PlanDecision = 'ejecutar' | 'cambiar' | 'cancelar';

interface LastTurn {
  text: string;
  imagen?: string;
  /** Historial antes de enviar el mensaje. */
  historial: GeminiContent[];
  /** Cuántas ediciones del agente había antes de este turno. */
  undoStart: number;
  /** Cantidad de elementos del chat antes del mensaje del usuario. */
  itemsBefore: number;
}

/** Herramientas que cambian el plano y tienen vista previa. */
const DRAW_ACTIONS = new Set([
  'dibujar_muro', 'dibujar_ambiente', 'agregar_puerta', 'agregar_ventana', 'dibujar_piso', 'dibujar_techo',
  'redimensionar_seleccion', 'rotar_seleccion', 'mover_seleccion',
]);

const WELCOME: ChatItem = {
  kind: 'msg',
  rol: 'agente',
  texto:
    'Hola, soy el Agente IA de Plasma3D. Puedo calcular costos con tus precios, dibujar muros, ambientes, puertas, ventanas, pisos y techos, cambiar materiales y proponerte mejoras. También puedes adjuntar una imagen o dictarme un audio. ¿Qué necesitas?',
};

function storageKey(userId: number | string, modelId: number | string) {
  return `plasma3d.agent.v4.${userId}.${modelId}`;
}

function pendingKey(userId: number | string, modelId: number | string) {
  return `plasma3d.agent.pending.v2.${userId}.${modelId}`;
}

/** Reduce la imagen y la devuelve como data URL JPEG (para enviarla al agente). */
function fileToDataUrl(file: File, maxDim = 1280): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('No se pudo procesar la imagen'));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      image.onerror = () => reject(new Error('Imagen inválida'));
      image.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.readAsDataURL(file);
  });
}

function load(userId: number | string, modelId: number | string): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(userId, modelId)) || 'null') as Stored | null;
    if (raw && Array.isArray(raw.items) && raw.items.length > 0) {
      // Las confirmaciones pendientes no sobreviven a una recarga.
      const items = raw.items.map((it): ChatItem =>
        it.kind === 'confirm' && it.status === 'pending' ? { ...it, status: 'no' as const }
          : it.kind === 'plan' && it.status === 'pending' ? { ...it, status: 'cancelar' as const } : it,
      );
      return { items, historial: Array.isArray(raw.historial) ? raw.historial : [] };
    }
  } catch {
    /* almacenamiento ilegible: conversación nueva */
  }
  return { items: [WELCOME], historial: [] };
}

function loadPending(userId: number | string, modelId: number | string): PendingTurn | null {
  try {
    const raw = JSON.parse(localStorage.getItem(pendingKey(userId, modelId)) || 'null') as PendingTurn | null;
    if (raw?.stage === 'applying' && typeof raw.text === 'string') return raw;
    if (raw?.stage === 'request' && raw.request && typeof raw.text === 'string') {
      return { ...raw, applied: raw.applied && typeof raw.applied === 'object' ? raw.applied : {} };
    }
  } catch {
    /* estado pendiente ilegible */
  }
  return null;
}

function actionKey(action: AgentAction): string {
  return action.id == null
    ? `${action.nombre}:${JSON.stringify(action.args ?? {})}`
    : `${action.nombre}:${action.id}`;
}

function errorText(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 401 || error.response?.status === 403) {
      return 'Tu sesión expiró. Vuelve a iniciar sesión para usar el agente.';
    }
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail;
    if (detail) return detail;
  }
  // Errores del streaming (fetch) traen el detalle del servidor en el mensaje.
  if (error instanceof Error && error.message && !/failed to fetch|networkerror|load failed/i.test(error.message)) {
    return error.message;
  }
  return 'No se pudo contactar al agente. Revisa tu conexión.';
}

/**
 * Chat flotante estilo Messenger con el Agente IA. El agente responde, calcula
 * costos (en el backend) y ejecuta acciones en el editor (aquí), con tarjetas
 * "Deshacer" y confirmación antes de borrar.
 */
export function AgentChat({ open, onClose, modelId, getHost, selection, hasPlan = false }: AgentChatProps) {
  const userId = useSession((s) => s.user?.id ?? 'anon');
  const [{ items, historial }, setStored] = useState<Stored>(() => load(userId, modelId));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<false | 'pensando' | 'actuando'>(false);
  const [error, setError] = useState<{ text: string; retry?: boolean } | null>(() => {
    const pending = loadPending(userId, modelId);
    if (!pending) return null;
    return pending.stage === 'request'
      ? { text: 'La respuesta quedó pendiente. Puedes continuar sin repetir los cambios del plano.', retry: true }
      : { text: 'La aplicación se interrumpió. Revisa el plano antes de iniciar otra conversación.' };
  });
  const [minimized, setMinimized] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    try {
      const stored = localStorage.getItem('plasma3d.agent.model');
      // Los antiguos "local-*" eran una simulación: ya no existen.
      if (stored && !stored.startsWith('local-')) return stored;
    } catch {
      /* sin almacenamiento */
    }
    return 'gemini';
  });
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState('');
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [aiConfig, setAiConfig] = useState<AgentConfig | null>(null);
  /** Texto que va llegando en streaming (respuesta en construcción). */
  const [streamText, setStreamText] = useState('');
  /** Aplicar cambios sin vista previa (borrar siempre pregunta). */
  const [autoApply, setAutoApply] = useState<boolean>(() => {
    try {
      return localStorage.getItem('plasma3d.agent.autoApply') === '1';
    } catch {
      return false;
    }
  });
  const [repeatOpen, setRepeatOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const streamOkRef = useRef(true);
  /** Último turno (para "Repetir con otro modelo"). */
  const lastTurnRef = useRef<LastTurn | null>(null);
  /** Rondas de autorrevisión en el turno actual (máx. 2). */
  const reviewRoundsRef = useRef(0);
  const planResolveRef = useRef(new Map<number, (decision: PlanDecision) => void>());
  const providers: AgentProvider[] = aiConfig?.providers?.length
    ? aiConfig.providers
    : [{ id: 'gemini', label: 'Gemini', vision: true }];
  const currentProvider = providers.find((p) => p.id === selectedModel) ?? providers[0];
  const visionEnabled = aiConfig ? (aiConfig.providers?.length ? currentProvider.vision || aiConfig.vision : aiConfig.vision) : true;
  const audioEnabled = aiConfig?.audio ?? true;

  useEffect(() => {
    let alive = true;
    agentApi
      .config()
      .then((config) => {
        if (alive) setAiConfig(config);
      })
      .catch(() => {
        if (alive) setAiConfig(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (aiConfig && !aiConfig.vision) {
      setImage(null);
      setImageName('');
    }
  }, [aiConfig]);
  const itemSeq = useRef(Math.max(0, ...items.map((it) => ('id' in it ? it.id : 0))));
  const pendingRef = useRef<PendingTurn | null>(loadPending(userId, modelId));
  const previewRef = useRef<PreviewWaiter | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const busyRef = useRef(false);
  const generationRef = useRef(0);
  const conversationUndoRef = useRef<number[]>([]);
  const confirmRef = useRef(new Map<number, (ok: boolean) => void>());

  const setItems = useCallback((fn: (prev: ChatItem[]) => ChatItem[]) => {
    setStored((s) => ({ ...s, items: fn(s.items) }));
  }, []);
  const setHistorial = useCallback((h: GeminiContent[]) => {
    setStored((s) => ({ ...s, historial: h }));
  }, []);

  function writePending(pending: PendingTurn | null) {
    pendingRef.current = pending;
    try {
      if (pending) localStorage.setItem(pendingKey(userId, modelId), JSON.stringify(pending));
      else localStorage.removeItem(pendingKey(userId, modelId));
    } catch {
      /* el estado permanece en memoria si el navegador bloquea almacenamiento */
    }
  }

  useEffect(() => {
    try {
      // No guardar las imagenes en localStorage: ocupan mucho y se pueden
      // recuperar del mensaje mientras la pestana siga abierta.
      const itemsForStorage = items.slice(-MAX_ITEMS).map((item) =>
        item.kind === 'msg' ? { ...item, imagen: undefined } : item,
      );
      localStorage.setItem(
        storageKey(userId, modelId),
        JSON.stringify({ items: itemsForStorage, historial }),
      );
    } catch {
      /* sin almacenamiento: la conversación dura solo esta sesión */
    }
  }, [items, historial, modelId, userId]);

  useEffect(() => {
    try {
      localStorage.setItem('plasma3d.agent.model', selectedModel);
    } catch {
      /* sin almacenamiento */
    }
  }, [selectedModel]);

  useEffect(() => {
    try {
      localStorage.setItem('plasma3d.agent.autoApply', autoApply ? '1' : '0');
    } catch {
      /* sin almacenamiento */
    }
  }, [autoApply]);

  // Si el proveedor guardado ya no está disponible, usar el del servidor.
  useEffect(() => {
    const list = aiConfig?.providers;
    if (list?.length && !list.some((p) => p.id === selectedModel)) {
      setSelectedModel(list.some((p) => p.id === aiConfig?.provider) ? aiConfig!.provider : list[0].id);
    }
  }, [aiConfig, selectedModel]);

  useEffect(() => () => {
    generationRef.current++;
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
      recorderRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    previewRef.current?.engine.clearAgentPreview();
    previewRef.current?.resolve(false);
    previewRef.current = null;
    confirmRef.current.forEach((resolve) => resolve(false));
    confirmRef.current.clear();
    planResolveRef.current.forEach((resolve) => resolve('cancelar'));
    planResolveRef.current.clear();
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (open) return;
    const waiter = previewRef.current;
    if (waiter) {
      waiter.engine.clearAgentPreview();
      previewRef.current = null;
      setPreview(null);
      waiter.resolve(false);
    }
    if (confirmRef.current.size) {
      confirmRef.current.forEach((resolve) => resolve(false));
      confirmRef.current.clear();
      setItems((prev) => prev.map((entry) => entry.kind === 'confirm' && entry.status === 'pending'
        ? { ...entry, status: 'no' } : entry));
    }
    if (planResolveRef.current.size) {
      planResolveRef.current.forEach((resolve) => resolve('cancelar'));
      planResolveRef.current.clear();
      setItems((prev) => prev.map((entry) => entry.kind === 'plan' && entry.status === 'pending'
        ? { ...entry, status: 'cancelar' } : entry));
    }
  }, [open, setItems]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, busy, minimized, open, error, preview]);

  useEffect(() => {
    if (open && !minimized) inputRef.current?.focus();
  }, [open, minimized]);

  /** Confirmación dentro del chat (resuelve cuando el usuario toca un botón). */
  const confirm = useCallback(
    (texto: string) =>
      new Promise<boolean>((resolve) => {
        const id = ++itemSeq.current;
        confirmRef.current.set(id, resolve);
        setItems((prev) => [...prev, { kind: 'confirm', id, texto, status: 'pending' }]);
        setMinimized(false);
      }),
    [setItems],
  );

  function answerConfirm(id: number, ok: boolean) {
    confirmRef.current.get(id)?.(ok);
    confirmRef.current.delete(id);
    setItems((prev) =>
      prev.map((it) => (it.kind === 'confirm' && it.id === id ? { ...it, status: ok ? 'yes' : 'no' } : it)),
    );
  }

  function answerPreview(apply: boolean) {
    const waiter = previewRef.current;
    if (!waiter) return;
    if (apply && waiter.moveProposal?.blockingReason) return;
    if (waiter.engine.getModelRevision() !== waiter.modelRevision) {
      waiter.engine.clearAgentPreview();
      previewRef.current = null;
      setPreview(null);
      setError({ text: 'El plano cambió mientras revisabas la propuesta. Se canceló para evitar aplicarla en otro plano.' });
      waiter.resolve(false);
      return;
    }
    if (apply && waiter.moveProposal) {
      const issue = waiter.engine.validateAgentMoveProposal(waiter.moveProposal);
      if (issue) {
        waiter.engine.clearAgentPreview();
        previewRef.current = null;
        setPreview(null);
        setError({ text: `${issue} Pide el movimiento de nuevo.` });
        waiter.resolve(false);
        return;
      }
    }
    if (apply && waiter.engine.getChangeRevision() !== waiter.revision) {
      if (waiter.moveProposal) {
        waiter.engine.clearAgentPreview();
        previewRef.current = null;
        setPreview(null);
        setError({ text: 'El plano cambió mientras revisabas el movimiento. Pídelo de nuevo.' });
        waiter.resolve(false);
        return;
      }
      waiter.revision = waiter.engine.getChangeRevision();
      const warnings = [
        ...waiter.engine.setAgentPreview(waiter.items),
        ...(waiter.extras.length ? waiter.engine.addAgentPreviewExtras(waiter.extras) : []),
      ];
      setPreview((current) => current && {
        ...current,
        revision: waiter.revision,
        warnings: ['El plano cambió desde la vista previa. Revísala de nuevo antes de aplicar.', ...warnings],
      });
      return;
    }
    waiter.engine.clearAgentPreview();
    previewRef.current = null;
    setPreview(null);
    waiter.resolve(apply);
  }

  function requestPreview(
    engine: EditorEngine,
    items: AgentPreviewItem[],
    labels: string[],
    extras: AgentPreviewExtra[] = [],
  ): Promise<boolean> {
    const revision = engine.getChangeRevision();
    const warnings = [
      ...engine.setAgentPreview(items),
      ...(extras.length ? engine.addAgentPreviewExtras(extras) : []),
    ];
    const xs = items.flatMap((item) => [item.x1, item.x2]);
    const zs = items.flatMap((item) => [item.z1, item.z2]);
    const location = items.length
      ? `Ubicación: X ${Math.min(...xs).toFixed(2)} a ${Math.max(...xs).toFixed(2)} m; Z ${Math.min(...zs).toFixed(2)} a ${Math.max(...zs).toFixed(2)} m.`
      : 'Rojo = se borra · celeste = resultado · naranja = cómo está ahora.';
    setMinimized(false);
    return new Promise<boolean>((resolve) => {
      previewRef.current = { engine, items, extras, resolve, revision, modelRevision: engine.getModelRevision() };
      setPreview({ labels, location, warnings, revision });
    });
  }

  /** Muestra la tarjeta del plan y espera la decisión del usuario. */
  function requestPlan(card: Omit<Extract<ChatItem, { kind: 'plan' }>, 'kind' | 'id' | 'status'>): Promise<PlanDecision> {
    return new Promise<PlanDecision>((resolve) => {
      const id = ++itemSeq.current;
      planResolveRef.current.set(id, resolve);
      setItems((prev) => [...prev, { kind: 'plan', id, status: 'pending', ...card }]);
      setMinimized(false);
    });
  }

  function answerPlan(id: number, decision: PlanDecision) {
    planResolveRef.current.get(id)?.(decision);
    planResolveRef.current.delete(id);
    setItems((prev) => prev.map((it) => (it.kind === 'plan' && it.id === id ? { ...it, status: decision } : it)));
    if (decision === 'cambiar') requestAnimationFrame(() => inputRef.current?.focus());
  }

  /** Ids de las piezas del plano (para saber qué se creó en un lote). */
  function pieceIds(engine: EditorEngine): Set<string> {
    try {
      return new Set(engine.getFloorPlan().items.map((it) => it.id));
    } catch {
      return new Set();
    }
  }

  /** Autorrevisión: problemas en lo recién dibujado/transformado (máx. 2 rondas por turno). */
  function reviewAfter(engine: EditorEngine, before: Set<string>, touchedSelection: boolean) {
    if (reviewRoundsRef.current >= MAX_REVIEW_ROUNDS) return undefined;
    const now = engine.getFloorPlan().items.map((it) => it.id);
    const created = now.filter((id) => !before.has(id));
    const ids = touchedSelection ? [...created, ...engine.getSelectionIds()] : created;
    if (!ids.length && !touchedSelection) return undefined;
    const issues = engine.inspectPlan(ids.length ? ids : undefined);
    if (!issues.length) return [];
    reviewRoundsRef.current++;
    return issues;
  }

  function requestMovePreview(engine: EditorEngine, prepared: AgentMovePreparation): Promise<boolean> {
    const { proposal, texto } = prepared;
    const warnings = engine.setAgentMovePreview(proposal);
    const revision = engine.getChangeRevision();
    const location = `De X ${proposal.from.x.toFixed(2)}, Z ${proposal.from.z.toFixed(2)} m a X ${proposal.to.x.toFixed(2)}, Z ${proposal.to.z.toFixed(2)} m.`;
    setMinimized(false);
    return new Promise<boolean>((resolve) => {
      previewRef.current = { engine, items: [], extras: [], moveProposal: proposal, resolve, revision, modelRevision: engine.getModelRevision() };
      setPreview({ labels: [texto], location, warnings, revision, blockingReason: proposal.blockingReason });
    });
  }

  /** Ejecuta un lote una sola vez; si una acción falla, revierte el lote. */
  async function runActions(step: ActionStep, applied: Record<string, AgentActionResult>, expectedContext: AgentStepRequest['contexto']) {
    const base = getHost();
    const results: AgentActionResult[] = new Array(step.acciones.length);
    const remaining: Array<{ action: AgentAction; index: number }> = [];
    step.acciones.forEach((action, index) => {
      const key = actionKey(action);
      if (applied[key]) results[index] = applied[key];
      else remaining.push({ action, index });
    });
    if (!remaining.length) return { results, applied };
    if (!openRef.current) {
      remaining.forEach(({ action, index }) => {
        results[index] = { id: action.id, nombre: action.nombre, respuesta: { ok: false, cancelado_por_usuario: true } };
      });
      return { results, applied };
    }
    if (!base) {
      remaining.forEach(({ action, index }) => {
        results[index] = { id: action.id, nombre: action.nombre, respuesta: { ok: false, error: 'El editor no está listo.' } };
      });
      return { results, applied };
    }

    // ---- Plan completo (pedidos grandes): tarjeta + vista previa + una sola transacción ----
    const planActions = remaining.filter(({ action }) => action.nombre === 'proponer_plan');
    if (planActions.length) {
      if (remaining.length !== 1) {
        remaining.forEach(({ action, index }) => {
          results[index] = { id: action.id, nombre: action.nombre,
            respuesta: { ok: false, error: 'proponer_plan debe llamarse sola, sin otras acciones en el mismo paso.' } };
        });
        return { results, applied };
      }
      const { action, index } = planActions[0];
      results[index] = await runPlan(base, action);
      const updated = { ...applied };
      if (results[index].respuesta.ok === true) updated[actionKey(action)] = results[index];
      return { results, applied: updated };
    }

    const moveActions = remaining.filter(({ action }) => action.nombre === 'mover_seleccion');
    let movePrepared: AgentMovePreparation | null = null;
    if (moveActions.length) {
      if (remaining.length !== 1) {
        remaining.forEach(({ action, index }) => {
          results[index] = { id: action.id, nombre: action.nombre,
            respuesta: { ok: false, error: 'Pide mover la pieza en un mensaje separado de las demás acciones.' } };
        });
        return { results, applied };
      }
      const { action, index } = moveActions[0];
      try {
        movePrepared = prepareAgentMoveAction({ ...base, confirm }, action);
        const previous = expectedContext.seleccion as { id?: unknown; nombre?: unknown; piezas_seleccionadas?: unknown;
          posicion_mundo_m?: { x?: unknown; z?: unknown } } | null | undefined;
        const selected = movePrepared.proposal.selected;
        if ((typeof expectedContext.revision_plano === 'number' &&
          expectedContext.revision_plano !== base.engine.getChangeRevision()) ||
          !previous || previous.piezas_seleccionadas !== 1 || previous.nombre !== selected.name ||
          (previous.id != null && previous.id !== selected.userData.elementId) ||
          (typeof previous.posicion_mundo_m?.x === 'number' &&
            Math.abs(previous.posicion_mundo_m.x - movePrepared.proposal.from.x) > 0.011) ||
          (typeof previous.posicion_mundo_m?.z === 'number' &&
            Math.abs(previous.posicion_mundo_m.z - movePrepared.proposal.from.z) > 0.011)) {
          throw new Error('La selección cambió desde que enviaste el mensaje. Selecciona la pieza y pide el movimiento de nuevo.');
        }
        const accepted = await requestMovePreview(base.engine, movePrepared);
        if (!accepted) {
          results[index] = { id: action.id, nombre: action.nombre,
            respuesta: { ok: false, cancelado_por_usuario: true } };
          return { results, applied };
        }
      } catch (err) {
        base.engine.clearAgentPreview();
        results[index] = { id: action.id, nombre: action.nombre,
          respuesta: { ok: false, error: err instanceof Error ? err.message : String(err) } };
        return { results, applied };
      }
    }

    const proposals: Array<NonNullable<ReturnType<typeof prepareAgentAction>>> = [];
    const preparationErrors = new Map<number, string>();
    remaining.forEach(({ action, index }) => {
      try {
        // crear_rapido no pasa por la autorrevisión (DRAW_ACTIONS): una puerta o
        // ventana creada afuera a propósito no es un error "fuera de muro".
        const proposal = prepareAgentAction(action, base.engine);
        if (proposal) proposals.push(proposal);
      } catch (err) {
        preparationErrors.set(index, err instanceof Error ? err.message : String(err));
      }
    });
    if (preparationErrors.size) {
      remaining.forEach(({ action, index }) => {
        results[index] = {
          id: action.id,
          nombre: action.nombre,
          respuesta: { ok: false, error: preparationErrors.get(index) ?? 'No aplicada: otra pieza del lote tiene medidas inválidas.' },
        };
      });
      return { results, applied };
    }

    // Vista previa de acciones sobre piezas existentes (borrar, material,
    // redimensionar, girar). Si el lote también selecciona piezas, la
    // selección todavía no es la final: se usa la confirmación de texto.
    const selectsInBatch = remaining.some(({ action }) => action.nombre === 'seleccionar');
    const extraPreps = selectsInBatch ? [] : remaining
      .map(({ action }) => ({ action, prep: prepareAgentExtras(base, action) }))
      .filter((x): x is { action: AgentAction; prep: NonNullable<ReturnType<typeof prepareAgentExtras>> } => Boolean(x.prep));
    const previewed = new Set(extraPreps.map(({ action }) => actionKey(action)));
    const hasDelete = remaining.some(({ action }) => action.nombre === 'eliminar');

    if (proposals.length || extraPreps.length) {
      // "Aplicar sin preguntar": salta la vista previa, salvo para borrar.
      const skip = autoApply && !hasDelete;
      if (!skip) {
        const items = proposals.flatMap((proposal) => proposal.items);
        const accepted = await requestPreview(
          base.engine,
          items,
          [...proposals.map((proposal) => proposal.texto), ...extraPreps.map(({ prep }) => prep.texto)],
          extraPreps.flatMap(({ prep }) => prep.extras),
        );
        if (!accepted) {
          remaining.forEach(({ action, index }) => {
            results[index] = { id: action.id, nombre: action.nombre, respuesta: { ok: false, cancelado_por_usuario: true } };
          });
          return { results, applied };
        }
      }
    }

    const undoOnly = remaining.length === 1 && remaining[0].action.nombre === 'deshacer_ultima_accion';
    if (!undoOnly && remaining.some(({ action }) => action.nombre === 'deshacer_ultima_accion')) {
      remaining.forEach(({ action, index }) => {
        results[index] = { id: action.id, nombre: action.nombre, respuesta: { ok: false, error: 'Pide deshacer en un mensaje separado.' } };
      });
      return { results, applied };
    }
    if (undoOnly && !base.engine.canUndoAgentTransaction(conversationUndoRef.current.at(-1) ?? -1)) {
      const { action, index } = remaining[0];
      results[index] = { id: action.id, nombre: action.nombre,
        respuesta: { ok: false, error: 'No hay una edición reciente de esta conversación para deshacer.' } };
      return { results, applied };
    }

    const revisionBeforeConfirm = base.engine.getChangeRevision();
    let selectionMayChange = false;
    try {
      for (const { action } of remaining) {
        // Ya lo aprobó en la vista previa (rojo/teñido): no preguntar dos veces.
        if (previewed.has(actionKey(action)) && !(autoApply && !hasDelete)) continue;
        if (!await confirmAgentAction({ ...base, confirm }, action, selectionMayChange)) {
          remaining.forEach(({ action: pendingAction, index }) => {
            results[index] = { id: pendingAction.id, nombre: pendingAction.nombre,
              respuesta: { ok: false, cancelado_por_usuario: true } };
          });
          return { results, applied };
        }
        if (action.nombre === 'seleccionar') selectionMayChange = true;
        if (base.engine.getChangeRevision() !== revisionBeforeConfirm) {
          remaining.forEach(({ action: pendingAction, index }) => {
            results[index] = { id: pendingAction.id, nombre: pendingAction.nombre,
              respuesta: { ok: false, error: 'El plano cambió durante la confirmación. Pide la acción de nuevo.' } };
          });
          return { results, applied };
        }
      }
    } catch (err) {
      remaining.forEach(({ action, index }) => {
        results[index] = { id: action.id, nombre: action.nombre,
          respuesta: { ok: false, error: err instanceof Error ? err.message : String(err) } };
      });
      return { results, applied };
    }

    const cards: string[] = [];
    let transactionId: number | null = null;
    const idsBefore = pieceIds(base.engine);
    try {
      if (!undoOnly) base.engine.beginAgentTransaction();
      let failed = false;
      for (const { action, index } of remaining) {
        if (failed) {
          results[index] = { id: action.id, nombre: action.nombre, respuesta: { ok: false, error: 'No aplicada: falló otra acción del lote.' } };
          continue;
        }
        const outcome = await runAgentAction({ ...base, confirm, preapproved: true,
          ...(movePrepared ? { moveProposal: movePrepared.proposal } : {}) }, action);
        results[index] = { id: action.id, nombre: action.nombre, respuesta: outcome.respuesta };
        if (outcome.respuesta.ok === false) failed = true;
        else if (outcome.card) cards.push(outcome.card.texto);
      }
      if (failed) {
        if (!undoOnly) base.engine.rollbackAgentTransaction();
        remaining.forEach(({ index }) => {
          if (results[index].respuesta.ok !== false) {
            results[index] = { ...results[index], respuesta: { ok: false, error: 'Cambio revertido porque falló otra acción del lote.' } };
          }
        });
      } else if (!undoOnly) {
        transactionId = base.engine.commitAgentTransaction();
      }
    } catch (err) {
      if (!undoOnly) base.engine.rollbackAgentTransaction();
      remaining.forEach(({ action, index }) => {
        results[index] = { id: action.id, nombre: action.nombre, respuesta: { ok: false, error: err instanceof Error ? err.message : String(err) } };
      });
    }

    if (remaining.every(({ index }) => results[index].respuesta.ok !== false)) {
      if (undoOnly) conversationUndoRef.current.pop();
      else if (transactionId !== null) conversationUndoRef.current.push(transactionId);

      // Autorrevisión: revisar lo que se acaba de dibujar o transformar.
      const drew = remaining.filter(({ action }) => DRAW_ACTIONS.has(action.nombre));
      if (drew.length && transactionId !== null) {
        try {
          const touchedSelection = drew.some(({ action }) =>
            ['redimensionar_seleccion', 'rotar_seleccion', 'mover_seleccion'].includes(action.nombre));
          const issues = reviewAfter(base.engine, idsBefore, touchedSelection);
          if (issues !== undefined) {
            const { index } = drew[drew.length - 1];
            results[index] = {
              ...results[index],
              respuesta: {
                ...results[index].respuesta,
                revision: issues.length ? issues : 'sin problemas',
                ...(reviewRoundsRef.current >= MAX_REVIEW_ROUNDS && issues.length
                  ? { nota_revision: 'Última ronda de corrección: si sigue mal, explícale al usuario qué revisar.' }
                  : {}),
              },
            };
          }
        } catch {
          /* la revisión es una ayuda: nunca bloquea la acción */
        }
      }
    }

    if (cards.length && remaining.every(({ index }) => results[index].respuesta.ok !== false)) {
      setItems((prev) => [...prev, {
        kind: 'action', id: ++itemSeq.current, texto: cards.join(' · '), ok: true,
        ...(transactionId !== null ? { transactionId } : {}),
      }]);
    }
    const updated = { ...applied };
    remaining.forEach(({ action, index }) => {
      const key = actionKey(action);
      if (results[index].respuesta.ok === true) updated[key] = results[index];
    });
    return { results, applied: updated };
  }

  /** Plan completo: tarjeta con pasos + vista previa; si se aprueba, todo en una transacción. */
  async function runPlan(base: Omit<AgentHost, 'confirm'>, action: AgentAction): Promise<AgentActionResult> {
    const reply = (respuesta: Record<string, unknown>): AgentActionResult => ({ id: action.id, nombre: action.nombre, respuesta });
    let plan: ReturnType<typeof prepareAgentPlan>;
    try {
      plan = prepareAgentPlan(action);
    } catch (err) {
      return reply({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    const { engine } = base;
    const modelRevision = engine.getModelRevision();
    let previewWarnings: string[] = [];
    if (plan.items.length) previewWarnings = engine.setAgentPreview(plan.items);
    const decision = await requestPlan({
      titulo: plan.titulo,
      pasos: plan.pasos.map(({ descripcion, texto, error }) => ({ descripcion, texto, error })),
      costo: plan.costo,
    });
    engine.clearAgentPreview();
    if (decision === 'cancelar') return reply({ ok: false, rechazado_por_usuario: true });
    if (decision === 'cambiar') {
      return reply({ ok: false, el_usuario_quiere_cambios: true, nota: 'Pregunta qué quiere cambiar (o espera su mensaje) y vuelve a proponer el plan.' });
    }
    if (!plan.valido) {
      return reply({ ok: false, error: `Pasos inválidos: ${plan.pasos.filter((p) => p.error).map((p) => `${p.descripcion}: ${p.error}`).join(' | ')}` });
    }
    if (engine.getModelRevision() !== modelRevision) {
      return reply({ ok: false, error: 'El plano cambió mientras revisabas el plan. Propónlo de nuevo.' });
    }

    const idsBefore = pieceIds(engine);
    let transactionId: number | null = null;
    let total = 0;
    try {
      engine.beginAgentTransaction();
      for (const paso of plan.pasos) {
        for (const sub of paso.acciones) {
          const outcome = await runAgentAction({ ...base, confirm, preapproved: true }, sub);
          if (outcome.respuesta.ok === false) {
            throw new Error(`Paso "${paso.descripcion}": ${String(outcome.respuesta.error ?? 'falló')}`);
          }
          total++;
        }
      }
      transactionId = engine.commitAgentTransaction();
    } catch (err) {
      engine.rollbackAgentTransaction();
      return reply({ ok: false, error: `${err instanceof Error ? err.message : String(err)} (no se aplicó nada del plan).` });
    }
    if (transactionId !== null) conversationUndoRef.current.push(transactionId);
    setItems((prev) => [...prev, {
      kind: 'action', id: ++itemSeq.current, ok: true,
      texto: `Plan "${plan.titulo}": ${plan.pasos.length} pasos, ${total} piezas`,
      ...(transactionId !== null ? { transactionId } : {}),
    }]);
    let revision: unknown;
    try {
      const issues = reviewAfter(engine, idsBefore, false);
      revision = issues === undefined ? undefined : issues.length ? issues : 'sin problemas';
    } catch {
      revision = undefined;
    }
    return reply({
      ok: true,
      ejecutado: true,
      pasos: plan.pasos.length,
      acciones: total,
      ...(previewWarnings.length ? { avisos_vista_previa: previewWarnings } : {}),
      ...(revision !== undefined ? { revision } : {}),
    });
  }

  /** Un paso del agente: en streaming si se puede, si no la respuesta completa. */
  async function callStep(request: AgentStepRequest, generation: number): Promise<AgentStep> {
    const req: AgentStepRequest = { ...request, proveedor: request.proveedor ?? selectedModel };
    if (streamOkRef.current) {
      const controller = new AbortController();
      abortRef.current = controller;
      setStreamText('');
      try {
        return await agentApi.stepStream(req, {
          signal: controller.signal,
          onToken: (t) => {
            if (generation === generationRef.current) setStreamText((prev) => prev + t);
          },
        });
      } catch (err) {
        if (!(err instanceof StreamUnavailableError)) throw err;
        streamOkRef.current = false; // este servidor no tiene streaming: usar step()
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    }
    return agentApi.step(req);
  }

  /** Detiene la respuesta en curso (solo mientras el agente escribe). */
  function stopTurn() {
    if (busy !== 'pensando') return;
    generationRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    busyRef.current = false;
    setBusy(false);
    setStreamText('');
    setError({ text: 'Respuesta detenida.', retry: pendingRef.current?.stage === 'request' });
  }

  async function runTurn(initial: Extract<PendingTurn, { stage: 'request' }>) {
    if (busyRef.current) return;
    busyRef.current = true;
    const generation = generationRef.current;
    let current = initial;
    if (current.round === 0) reviewRoundsRef.current = 0;
    setError(null);
    setStreamText('');
    setBusy('pensando');
    try {
      let step = await callStep(current.request, generation);
      if (generation !== generationRef.current) return;
      let round = current.round;
      while (step.estado === 'acciones' && round < MAX_ROUNDS) {
        setStreamText('');
        setHistorial(step.historial);
        setBusy('actuando');
        writePending({ stage: 'applying', turnId: current.turnId, text: current.text, round });
        const { results, applied } = await runActions(step, current.applied, current.request.contexto);
        if (generation !== generationRef.current) return;
        round++;
        current = {
          stage: 'request', turnId: current.turnId, text: current.text, round, applied,
          request: {
            historial: step.historial,
            contexto: {},
            resultados: results,
            pendientes: step.pendientes,
            // Mantener el mismo proveedor en todo el turno.
            proveedor: step.proveedor ?? current.request.proveedor,
          },
        };
        // Guardar primero los resultados: una excepción al resumir el plano no debe repetir el dibujo.
        writePending(current);
        try {
          current.request.contexto = getHost()?.engine.getAgentContext() ?? {};
          writePending(current);
        } catch {
          /* el agente puede continuar con el historial y los resultados */
        }
        setBusy('pensando');
        step = await callStep(current.request, generation);
        if (generation !== generationRef.current) return;
      }
      setHistorial(step.historial);
      setStreamText('');
      setItems((prev) => [...prev, {
        kind: 'msg', rol: 'agente',
        texto: step.estado === 'respuesta' ? step.texto : 'Se alcanzó el máximo de pasos; las acciones restantes no se aplicaron.',
        ...(step.proveedor ? { modelo: step.proveedor } : {}),
      }]);
      writePending(null);
    } catch (err) {
      if (generation !== generationRef.current) return; // detenido por el usuario
      setStreamText('');
      const pending = pendingRef.current;
      setError(pending?.stage === 'request'
        ? { text: errorText(err), retry: true }
        : { text: 'Se interrumpió la aplicación. Revisa el plano antes de iniciar otra conversación.' });
    } finally {
      // Si el usuario lo detuvo, stopTurn ya liberó el chat (puede haber otro turno en curso).
      if (generation === generationRef.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  async function onImageSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError({ text: 'Selecciona un archivo de imagen válido.' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError({ text: 'La imagen es demasiado grande (máximo 10 MB).' });
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setImage(dataUrl);
      setImageName(file.name);
      setError(null);
    } catch {
      setError({ text: 'No se pudo procesar la imagen.' });
    }
  }

  function clearImage() {
    setImage(null);
    setImageName('');
  }

  async function transcribeBlob(blob: Blob) {
    if (blob.size < 800) {
      setError({ text: 'La grabación es muy corta; intenta de nuevo.' });
      return;
    }
    setTranscribing(true);
    try {
      const { texto } = await agentApi.transcribe(blob);
      setInput((prev) => (prev ? `${prev} ${texto}` : texto));
      toast.success('Audio transcrito', 'Revisa el texto y envíalo.');
    } catch (err) {
      setError({ text: errorText(err) });
    } finally {
      setTranscribing(false);
    }
  }

  async function toggleRecording() {
    if (transcribing) return;
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError({ text: 'Tu navegador no permite grabar audio.' });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        chunksRef.current = [];
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        void transcribeBlob(blob);
      };
      recorder.start();
      setRecording(true);
      setError(null);
    } catch {
      setError({ text: 'No se pudo acceder al micrófono.' });
    }
  }

  const lastAgentText = (() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.kind === 'msg') return it.rol === 'agente' ? it.texto : undefined;
    }
    return undefined;
  })();
  const chips = chipsFor({
    kind: selection?.kind ?? null,
    count: selection?.count ?? 0,
    hasPlan,
    lastAgentText: items.length > 1 ? lastAgentText : undefined,
  });

  function send(text: string) {
    const texto = text.trim();
    const imagen = image;
    if ((!texto && !imagen) || busyRef.current || transcribing) return;
    if (pendingRef.current) {
      if (pendingRef.current.stage === 'request' && error) {
        // Un fallo de red/IA no debe obligar a "Nueva conversación":
        // se descarta el intento pendiente y se envía el mensaje nuevo.
        writePending(null);
        setError(null);
      } else {
        setError({ text: 'Hay una respuesta pendiente. Continúala o inicia una conversación nueva.', retry: pendingRef.current.stage === 'request' });
        return;
      }
    }
    const request: AgentStepRequest = {
      historial,
      contexto: getHost()?.engine.getAgentContext() ?? {},
      proveedor: selectedModel,
      ...(texto ? { mensaje: texto } : {}),
      ...(imagen ? { imagen } : {}),
    };
    const displayText = texto || 'Analiza esta imagen.';
    const pending: PendingTurn = {
      stage: 'request', turnId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text: displayText, round: 0, request, applied: {},
    };
    lastTurnRef.current = {
      text: texto,
      ...(imagen ? { imagen } : {}),
      historial,
      undoStart: conversationUndoRef.current.length,
      itemsBefore: items.length,
    };
    writePending(pending);
    setItems((prev) => [...prev, {
      kind: 'msg', rol: 'usuario', texto: displayText,
      ...(imagen ? { imagen } : {}),
    }]);
    setInput('');
    clearImage();
    setRepeatOpen(false);
    void runTurn(pending);
  }

  /**
   * "Repetir con otro modelo": descarta la última respuesta del agente y
   * reenvía el mismo mensaje con otro proveedor. Si esa respuesta cambió el
   * plano, primero ofrece deshacer esos cambios.
   */
  async function repeatWith(providerId: string) {
    setRepeatOpen(false);
    const turn = lastTurnRef.current;
    if (!turn || busyRef.current) return;
    const host = getHost();
    const label = PROVIDER_LABEL[providerId] ?? providerId;
    const edits = conversationUndoRef.current.slice(turn.undoStart);
    if (edits.length && host) {
      const undo = await confirm(
        `Esa respuesta cambió el plano (${edits.length} edición${edits.length > 1 ? 'es' : ''}). ¿Deshacerlo antes de repetir con ${label}?`,
      );
      if (undo) {
        const undone: number[] = [];
        for (const id of [...edits].reverse()) {
          if (!host.engine.undoAgentTransaction(id)) break;
          undone.push(id);
        }
        conversationUndoRef.current = conversationUndoRef.current.filter((id) => !undone.includes(id));
        setItems((prev) => prev.map((e) => (e.kind === 'action' && e.transactionId != null && undone.includes(e.transactionId)
          ? { ...e, undone: true } : e)));
        if (undone.length < edits.length) {
          setError({ text: 'No se pudo deshacer todo (hubo cambios posteriores). Revisa el plano.' });
        }
      }
    }
    // Quitar las respuestas del agente de ese turno (las tarjetas de acción quedan como historial).
    setItems((prev) => prev.filter((e, i) => !(i > turn.itemsBefore && e.kind === 'msg' && e.rol === 'agente')));
    setSelectedModel(providerId);
    writePending(null);
    setError(null);
    const request: AgentStepRequest = {
      historial: turn.historial,
      contexto: host?.engine.getAgentContext() ?? {},
      proveedor: providerId,
      ...(turn.text ? { mensaje: turn.text } : {}),
      ...(turn.imagen ? { imagen: turn.imagen } : {}),
    };
    const pending: PendingTurn = {
      stage: 'request', turnId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text: turn.text || 'Analiza esta imagen.', round: 0, request, applied: {},
    };
    lastTurnRef.current = { ...turn, undoStart: conversationUndoRef.current.length };
    writePending(pending);
    void runTurn(pending);
  }

  function retry() {
    const pending = pendingRef.current;
    if (pending?.stage === 'request') void runTurn(pending);
  }

  function undoItem(id: number) {
    const item = items.find((entry) => entry.kind === 'action' && entry.id === id);
    if (item?.kind !== 'action' || item.transactionId == null || item.undone) return;
    if (!getHost()?.engine.undoAgentTransaction(item.transactionId)) {
      setError({ text: 'Solo se puede deshacer la última edición del plano. Usa el historial general si hubo cambios posteriores.' });
      return;
    }
    if (conversationUndoRef.current.at(-1) === item.transactionId) conversationUndoRef.current.pop();
    setItems((prev) => prev.map((entry) => entry.kind === 'action' && entry.id === id ? { ...entry, undone: true } : entry));
  }

  function newConversation() {
    if (busyRef.current) return;
    writePending(null);
    conversationUndoRef.current = [];
    lastTurnRef.current = null;
    setStored({ items: [WELCOME], historial: [] });
    setError(null);
    clearImage();
  }

  function closeChat() {
    openRef.current = false;
    if (previewRef.current) answerPreview(false);
    confirmRef.current.forEach((resolve) => resolve(false));
    confirmRef.current.clear();
    planResolveRef.current.forEach((resolve) => resolve('cancelar'));
    planResolveRef.current.clear();
    setItems((prev) => prev.map((entry) => entry.kind === 'confirm' && entry.status === 'pending'
      ? { ...entry, status: 'no' }
      : entry.kind === 'plan' && entry.status === 'pending' ? { ...entry, status: 'cancelar' } : entry));
    onClose();
  }

  if (!open) return null;

  const busyText = preview
    ? 'esperando tu aprobación…'
    : busy === 'actuando'
      ? 'trabajando en el plano…'
      : 'escribiendo…';

  const imageTitle = visionEnabled
    ? 'Adjuntar imagen'
    : 'El proveedor configurado no admite imágenes';
  const micTitle = !audioEnabled
    ? 'La transcripción de audio no está configurada'
    : recording
      ? 'Detener grabación'
      : 'Dictar por voz';

  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className="p3d-agent-glow absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-3 z-40 flex cursor-pointer items-center gap-2 rounded-full border border-cyan-400/70 bg-surface/95 px-4 py-2 text-sm font-medium text-cyan-200 shadow-xl shadow-black/40 backdrop-blur focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 sm:left-[4.5rem]"
        aria-label="Abrir chat del Agente IA"
      >
        <SparklesIcon width={16} height={16} /> Agente IA
        {busy && <span className="text-xs text-muted">{busyText}</span>}
      </button>
    );
  }

  let lastAgentIndex = -1;
  for (let k = items.length - 1; k >= 0; k--) {
    const it = items[k];
    if (it.kind === 'msg') {
      if (it.rol === 'agente') lastAgentIndex = k;
      break;
    }
  }
  const canRepeat = Boolean(lastTurnRef.current) && !busy && !preview && lastAgentIndex > (lastTurnRef.current?.itemsBefore ?? Infinity);

  return (
    <section
      aria-label="Chat con el Agente IA"
      className={cn(
        'p3d-fade-in absolute z-40 flex flex-col overflow-hidden border border-cyan-400/40 bg-surface/95 shadow-2xl shadow-black/50 backdrop-blur-md',
        'inset-x-0 bottom-0 h-[70%] rounded-t-2xl',
        'sm:inset-x-auto sm:bottom-3 sm:left-[4.5rem] sm:top-3 sm:h-auto sm:w-80 sm:rounded-2xl',
      )}
    >
      <header className="flex shrink-0 items-center gap-2.5 border-b border-border bg-surface-2/60 px-3 py-2.5">
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-primary text-white">
          <SparklesIcon width={18} height={18} />
          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-surface bg-success" />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold text-foreground">Agente Plasma3D</p>
          <p className="text-[11px] text-success">{busy ? busyText : 'En línea'}</p>
        </div>
        <HeaderButton title="Nueva conversación" onClick={newConversation}>
          <span className="text-base leading-none">↺</span>
        </HeaderButton>
        <HeaderButton title="Minimizar" onClick={() => setMinimized(true)}>
          <span className="mb-1 block h-0.5 w-3 rounded bg-current" />
        </HeaderButton>
        <HeaderButton title="Cerrar" onClick={closeChat}>
          <XIcon width={16} height={16} />
        </HeaderButton>
      </header>

      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-2/40 px-3 py-1.5 text-[11px] text-muted">
        <span className="shrink-0">Modelo</span>
        <select
          value={currentProvider.id}
          onChange={(e) => setSelectedModel(e.target.value)}
          disabled={Boolean(busy)}
          title={currentProvider.vision ? 'Acepta imágenes' : 'Solo texto (las imágenes van con un modelo con visión)'}
          aria-label="Modelo de IA"
          className="min-w-0 flex-1 cursor-pointer rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-60"
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <label
          className="flex shrink-0 cursor-pointer items-center gap-1"
          title="Aplica dibujos y cambios sin vista previa. Borrar siempre pregunta."
        >
          <input
            type="checkbox"
            checked={autoApply}
            onChange={(e) => setAutoApply(e.target.checked)}
            className="h-3 w-3 accent-cyan-400"
          />
          Sin vista previa
        </label>
      </div>

      <div ref={listRef} className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-3" aria-live="polite">
        {items.map((it, i) => {
          if (it.kind === 'msg') {
            return (
              <div key={i} className={cn('flex', it.rol === 'usuario' ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'flex max-w-[85%] flex-col gap-1.5 rounded-2xl px-3 py-2 text-sm',
                    it.rol === 'usuario' ? 'items-end rounded-br-md bg-primary text-white' : 'rounded-bl-md bg-surface-2 text-foreground',
                  )}
                >
                  {it.imagen && (
                    <img
                      src={it.imagen}
                      alt="Imagen adjunta"
                      className="max-h-44 w-auto rounded-lg border border-white/20 object-contain"
                    />
                  )}
                  <p className="whitespace-pre-wrap break-words leading-snug">
                    {it.rol === 'agente' ? <RichText text={it.texto} /> : it.texto}
                  </p>
                  {it.rol === 'agente' && (it.modelo || i === lastAgentIndex) && (
                    <div className="flex items-center gap-2 text-[10px] text-muted">
                      {it.modelo && <span>{PROVIDER_LABEL[it.modelo] ?? it.modelo}</span>}
                      {i === lastAgentIndex && canRepeat && (
                        <span className="relative">
                          <button
                            type="button"
                            onClick={() => setRepeatOpen((v) => !v)}
                            className="cursor-pointer rounded px-1 font-medium text-cyan-200 hover:bg-cyan-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                            aria-expanded={repeatOpen}
                            title="Repetir esta respuesta con otro modelo"
                          >
                            ↻ Repetir con…
                          </button>
                          {repeatOpen && (
                            <span className="absolute bottom-full left-0 z-10 mb-1 flex min-w-[8rem] flex-col overflow-hidden rounded-md border border-border bg-surface shadow-xl">
                              {providers.map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => void repeatWith(p.id)}
                                  className="cursor-pointer px-2.5 py-1.5 text-left text-[11px] text-foreground hover:bg-surface-2"
                                >
                                  {p.label}{p.id === it.modelo ? ' (otra vez)' : ''}
                                </button>
                              ))}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          }
          if (it.kind === 'plan') {
            const pending = it.status === 'pending';
            const invalid = it.pasos.some((p) => p.error);
            return (
              <div key={i} className="self-stretch rounded-xl border border-cyan-400/60 bg-cyan-400/10 p-3 text-xs text-foreground">
                <p className="mb-1 font-semibold text-cyan-200">📐 {it.titulo}</p>
                <ol className="mb-2 list-inside list-decimal space-y-0.5">
                  {it.pasos.map((p, k) => (
                    <li key={k} className={cn(p.error && 'text-danger')}>
                      <span className="font-medium">{p.descripcion}</span>
                      {p.error ? <span> — {p.error}</span> : p.texto ? <span className="text-muted"> — {p.texto}</span> : null}
                    </li>
                  ))}
                </ol>
                {typeof it.costo === 'number' && (
                  <p className="mb-2 font-medium">Costo estimado: ${it.costo.toFixed(2)}</p>
                )}
                {pending ? (
                  <>
                    <p className="mb-2 text-muted">La figura celeste en el plano es la vista previa; todavía no se dibujó nada.</p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => answerPlan(it.id, 'ejecutar')} disabled={invalid}
                        title={invalid ? 'Hay pasos inválidos: pide que lo corrija' : 'Dibujar todo el plan (un solo Deshacer)'}
                        className="cursor-pointer rounded-md bg-cyan-500 px-3 py-1.5 font-semibold text-white hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-40">
                        ✓ Ejecutar plan
                      </button>
                      <button type="button" onClick={() => answerPlan(it.id, 'cambiar')}
                        className="cursor-pointer rounded-md border border-cyan-400/50 px-3 py-1.5 text-cyan-100 hover:bg-cyan-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
                        ✎ Cambiar algo
                      </button>
                      <button type="button" onClick={() => answerPlan(it.id, 'cancelar')}
                        className="cursor-pointer rounded-md border border-border px-3 py-1.5 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
                        ✗ Cancelar
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-muted">
                    {it.status === 'ejecutar' ? 'Plan aprobado' : it.status === 'cambiar' ? 'Pediste cambios' : 'Plan cancelado'}
                  </p>
                )}
              </div>
            );
          }
          if (it.kind === 'action') {
            const canUndo = !it.undone && it.transactionId != null &&
              Boolean(getHost()?.engine.canUndoAgentTransaction(it.transactionId));
            return (
              <div
                key={i}
                className={cn(
                  'flex items-center gap-2 self-start rounded-xl border px-3 py-1.5 text-xs',
                  it.undone
                    ? 'border-border text-muted line-through'
                    : it.ok
                      ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-100'
                      : 'border-danger/40 bg-danger/10 text-danger',
                )}
              >
                <span aria-hidden="true">{it.ok ? '✔' : '✖'}</span>
                <span>{it.texto}</span>
                {canUndo && (
                  <button
                    type="button"
                    onClick={() => undoItem(it.id)}
                    className="ml-1 cursor-pointer rounded-md px-1.5 py-0.5 font-medium text-cyan-200 underline underline-offset-2 hover:bg-cyan-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                  >
                    Deshacer
                  </button>
                )}
              </div>
            );
          }
          return (
            <div key={i} className="self-stretch rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
              <p className="mb-2 font-medium">{it.texto}</p>
              {it.status === 'pending' ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => answerConfirm(it.id, true)}
                    className="cursor-pointer rounded-md bg-warning px-3 py-1 font-semibold text-black hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning"
                  >
                    Confirmar
                  </button>
                  <button
                    type="button"
                    onClick={() => answerConfirm(it.id, false)}
                    className="cursor-pointer rounded-md border border-warning/50 px-3 py-1 hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <p className="text-muted">{it.status === 'yes' ? 'Confirmado' : 'Cancelado'}</p>
              )}
            </div>
          );
        })}

        {preview && (
          <div className="self-stretch rounded-xl border border-cyan-400/60 bg-cyan-400/10 p-3 text-xs text-foreground">
            <p className="mb-2 font-semibold text-cyan-200">Vista previa en el plano</p>
            <ul className="mb-2 list-inside list-disc space-y-0.5">
              {preview.labels.map((label, index) => <li key={index}>{label}</li>)}
            </ul>
            <p className="mb-2 text-muted">{preview.location}</p>
            {preview.warnings.length > 0 && (
              <div className="mb-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-warning">
                <p className="font-semibold">Posible solapamiento o cambio del plano:</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
                </ul>
              </div>
            )}
            {preview.blockingReason && <p className="mb-2 font-medium text-danger">{preview.blockingReason}</p>}
            <p className="mb-2 text-muted">La figura celeste todavía no modifica el plano.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => answerPreview(true)}
                disabled={Boolean(preview.blockingReason)}
                className="cursor-pointer rounded-md bg-cyan-500 px-3 py-1.5 font-semibold text-white hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-40">
                Aplicar
              </button>
              <button type="button" onClick={() => answerPreview(false)}
                className="cursor-pointer rounded-md border border-border px-3 py-1.5 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
                Cancelar
              </button>
            </div>
          </div>
        )}

        {busy && streamText && (
          <div className="flex justify-start">
            <div className="flex max-w-[85%] flex-col gap-1.5 rounded-2xl rounded-bl-md bg-surface-2 px-3 py-2 text-sm text-foreground">
              <p className="whitespace-pre-wrap break-words leading-snug">
                {streamText}
                <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-cyan-300 align-middle" aria-hidden="true" />
              </p>
            </div>
          </div>
        )}

        {busy && !streamText && (
          <div className="flex items-center gap-2" aria-label={`El agente está ${busyText}`}>
            <span className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-surface-2 px-3 py-3">
              <span className="p3d-typing-dot" />
              <span className="p3d-typing-dot [animation-delay:150ms]" />
              <span className="p3d-typing-dot [animation-delay:300ms]" />
            </span>
            {busy === 'actuando' && <span className="text-[11px] text-cyan-200">trabajando en el plano…</span>}
          </div>
        )}

        {busy === 'pensando' && !preview && (
          <button
            type="button"
            onClick={stopTurn}
            className="self-start cursor-pointer rounded-full border border-border px-3 py-1 text-[11px] text-muted hover:border-danger/60 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          >
            ■ Detener
          </button>
        )}

        {error && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error.text}{' '}
            {error.retry && (
              <button type="button" onClick={retry} className="cursor-pointer font-medium underline underline-offset-2">
                Reintentar
              </button>
            )}
            {!busy && (
              <button type="button" onClick={newConversation} className="ml-1 cursor-pointer font-medium underline underline-offset-2">
                Nueva conversación
              </button>
            )}
          </div>
        )}

      </div>

      {(image || recording || transcribing) && (
        <div className="flex shrink-0 items-center gap-2 border-t border-border px-2.5 py-2 text-xs">
          {image && (
            <>
              <img
                src={image}
                alt="Imagen adjunta"
                className="h-10 w-10 rounded-md border border-border object-cover"
              />
              <span className="min-w-0 flex-1 truncate text-muted">{imageName}</span>
              <button
                type="button"
                onClick={clearImage}
                className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                aria-label="Quitar imagen"
                title="Quitar imagen"
              >
                <XIcon width={14} height={14} />
              </button>
            </>
          )}
          {recording && (
            <span className="flex items-center gap-1.5 text-danger">
              <span className="h-2 w-2 animate-pulse rounded-full bg-danger" />
              Grabando… toca el micrófono para detener.
            </span>
          )}
          {transcribing && <span className="text-muted">Transcribiendo audio…</span>}
        </div>
      )}

      {chips.length > 0 && !preview && (
        <div className="no-scrollbar flex shrink-0 gap-1.5 overflow-x-auto border-t border-border px-2.5 pt-2" aria-label="Sugerencias rápidas">
          {chips.map((chip) => (
            <button
              key={chip.label}
              type="button"
              disabled={Boolean(busy) || transcribing}
              onClick={() => {
                if (chip.edit) {
                  setInput(chip.text);
                  requestAnimationFrame(() => {
                    const el = inputRef.current;
                    if (!el) return;
                    el.focus();
                    // Cursor donde va el número ("de  m" → entre los espacios).
                    const gap = chip.text.indexOf('  ');
                    const pos = gap >= 0 ? gap + 1 : chip.text.length;
                    el.setSelectionRange(pos, pos);
                  });
                } else {
                  send(chip.text);
                }
              }}
              title={chip.edit ? 'Completa el valor y envía' : chip.text}
              className="shrink-0 cursor-pointer whitespace-nowrap rounded-full border border-cyan-400/30 bg-cyan-400/5 px-2.5 py-1 text-[11px] font-medium text-cyan-200 transition-colors hover:border-cyan-300/60 hover:bg-cyan-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      <form
        className="flex shrink-0 items-end gap-2 border-t border-border p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:pb-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={onImageSelected}
        />
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          disabled={!visionEnabled}
          className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-surface-2 text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
          title={imageTitle}
          aria-label={imageTitle}
        >
          <ImageIcon width={18} height={18} />
        </button>
        <button
          type="button"
          onClick={() => void toggleRecording()}
          disabled={!audioEnabled}
          className={cn(
            'flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-40',
            recording
              ? 'border-danger bg-danger text-white'
              : 'border-border bg-surface-2 text-muted hover:text-foreground',
          )}
          title={micTitle}
          aria-label={micTitle}
        >
          {recording ? (
            <span className="h-3 w-3 rounded-sm bg-white" />
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
            </svg>
          )}
        </button>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder="Escribe, adjunta una imagen o dicta…"
          aria-label="Mensaje para el agente"
          className="max-h-28 min-h-[2.5rem] flex-1 resize-none rounded-2xl border border-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
        />
        <button
          type="submit"
          disabled={!input.trim() && !image}
          className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-cyan-500 text-white transition-colors hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Enviar mensaje"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M3.4 20.4 21 12 3.4 3.6l-.01 6.53L15 12 3.39 13.87z" />
          </svg>
        </button>
      </form>
    </section>
  );
}

/** `**texto**` y montos `$1,234.56` resaltados (texto seguro, sin HTML). */
function RichText({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-semibold">
            {part}
          </strong>
        ) : (
          <Money key={i} text={part} />
        ),
      )}
    </>
  );
}

function Money({ text }: { text: string }) {
  const chunks = text.split(/(\$\s?[\d.,]+\d)/g);
  return (
    <>
      {chunks.map((c, i) =>
        i % 2 === 1 ? (
          <span key={i} className="font-semibold text-cyan-200 tabular-nums">
            {c}
          </span>
        ) : (
          c
        ),
      )}
    </>
  );
}

function HeaderButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
    >
      {children}
    </button>
  );
}
