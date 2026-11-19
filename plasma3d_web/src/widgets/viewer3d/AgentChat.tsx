import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  agentApi,
  type AgentAction,
  type AgentActionResult,
  type AgentConfig,
  type AgentStep,
  type AgentStepRequest,
  type GeminiContent,
} from '@/entities/agent/api';
import { confirmAgentAction, prepareAgentAction, prepareAgentMoveAction, runAgentAction, type AgentHost, type AgentMovePreparation } from '@/widgets/viewer3d/agentActions';
import type { AgentMoveProposal, AgentPreviewItem, EditorEngine } from '@/widgets/viewer3d/engine';
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
}

/** Elemento del hilo del chat. */
type ChatItem =
  | { kind: 'msg'; rol: 'usuario' | 'agente'; texto: string; imagen?: string }
  | { kind: 'action'; id: number; texto: string; ok: boolean; transactionId?: number; undone?: boolean }
  | { kind: 'confirm'; id: number; texto: string; status: 'pending' | 'yes' | 'no' };

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
  moveProposal?: AgentMoveProposal;
  resolve: (apply: boolean) => void;
  revision: number;
  modelRevision: number;
}

const MAX_ITEMS = 80;
const MAX_ROUNDS = 6; // idas y vueltas acciones → resultados por pregunta
const SUGGESTIONS = [
  '¿Cuánto cuesta todo?',
  '¿Qué le puedo aumentar?',
  'Haz un cuarto de 3×4 a la derecha',
  '¿Cuánto costaría piedra natural en los muros?',
];

/**
 * Selector de modelos. Por ahora el backend siempre usa DeepSeek; los
 * "locales" solo simulan una espera de 20 s para la demo.
 */
const MODELS = [
  { id: 'gemini', label: 'gemini', local: false, repo: '' },
  {
    id: 'local-qwen-1.5b',
    label: 'Qwen 1.5B',
    local: true,
    repo: 'hf.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF',
  },
  {
    id: 'local-qwen-0.5b',
    label: 'Qwen 0.5B',
    local: true,
    repo: 'hf.co/Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF',
  },
] as const;
type ModelId = (typeof MODELS)[number]['id'];

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
      const items = raw.items.map((it) =>
        it.kind === 'confirm' && it.status === 'pending' ? { ...it, status: 'no' as const } : it,
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
  return 'No se pudo contactar al agente. Revisa tu conexión.';
}

/**
 * Chat flotante estilo Messenger con el Agente IA. El agente responde, calcula
 * costos (en el backend) y ejecuta acciones en el editor (aquí), con tarjetas
 * "Deshacer" y confirmación antes de borrar.
 */
export function AgentChat({ open, onClose, modelId, getHost }: AgentChatProps) {
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
  const [selectedModel, setSelectedModel] = useState<ModelId>(() => {
    try {
      const stored = localStorage.getItem('plasma3d.agent.model');
      if (stored && MODELS.some((model) => model.id === stored)) {
        return stored as ModelId;
      }
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
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const currentModel = MODELS.find((model) => model.id === selectedModel) ?? MODELS[0];
  const visionEnabled = aiConfig?.vision ?? true;
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
      const warnings = waiter.engine.setAgentPreview(waiter.items);
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

  function requestPreview(engine: EditorEngine, items: AgentPreviewItem[], labels: string[]): Promise<boolean> {
    const revision = engine.getChangeRevision();
    const warnings = engine.setAgentPreview(items);
    const xs = items.flatMap((item) => [item.x1, item.x2]);
    const zs = items.flatMap((item) => [item.z1, item.z2]);
    const location = `Ubicación: X ${Math.min(...xs).toFixed(2)} a ${Math.max(...xs).toFixed(2)} m; Z ${Math.min(...zs).toFixed(2)} a ${Math.max(...zs).toFixed(2)} m.`;
    setMinimized(false);
    return new Promise<boolean>((resolve) => {
      previewRef.current = { engine, items, resolve, revision, modelRevision: engine.getModelRevision() };
      setPreview({ labels, location, warnings, revision });
    });
  }

  function requestMovePreview(engine: EditorEngine, prepared: AgentMovePreparation): Promise<boolean> {
    const { proposal, texto } = prepared;
    const warnings = engine.setAgentMovePreview(proposal);
    const revision = engine.getChangeRevision();
    const location = `De X ${proposal.from.x.toFixed(2)}, Z ${proposal.from.z.toFixed(2)} m a X ${proposal.to.x.toFixed(2)}, Z ${proposal.to.z.toFixed(2)} m.`;
    setMinimized(false);
    return new Promise<boolean>((resolve) => {
      previewRef.current = { engine, items: [], moveProposal: proposal, resolve, revision, modelRevision: engine.getModelRevision() };
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
        const proposal = prepareAgentAction(action);
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

    if (proposals.length) {
      const items = proposals.flatMap((proposal) => proposal.items);
      const accepted = await requestPreview(base.engine, items, proposals.map((proposal) => proposal.texto));
      if (!accepted) {
        remaining.forEach(({ action, index }) => {
          results[index] = { id: action.id, nombre: action.nombre, respuesta: { ok: false, cancelado_por_usuario: true } };
        });
        return { results, applied };
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

  async function runTurn(initial: Extract<PendingTurn, { stage: 'request' }>) {
    if (busyRef.current) return;
    busyRef.current = true;
    const generation = generationRef.current;
    let current = initial;
    setError(null);
    setBusy('pensando');
    try {
      let step = await agentApi.step(current.request);
      if (generation !== generationRef.current) return;
      let round = current.round;
      while (step.estado === 'acciones' && round < MAX_ROUNDS) {
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
            ...(current.request.modelo ? { modelo: current.request.modelo } : {}),
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
        step = await agentApi.step(current.request);
        if (generation !== generationRef.current) return;
      }
      setHistorial(step.historial);
      setItems((prev) => [...prev, {
        kind: 'msg', rol: 'agente',
        texto: step.estado === 'respuesta' ? step.texto : 'Se alcanzó el máximo de pasos; las acciones restantes no se aplicaron.',
      }]);
      writePending(null);
    } catch (err) {
      const pending = pendingRef.current;
      setError(pending?.stage === 'request'
        ? { text: errorText(err), retry: true }
        : { text: 'Se interrumpió la aplicación. Revisa el plano antes de iniciar otra conversación.' });
    } finally {
      busyRef.current = false;
      setBusy(false);
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
      modelo: selectedModel,
      ...(texto ? { mensaje: texto } : {}),
      ...(imagen ? { imagen } : {}),
    };
    const displayText = texto || 'Analiza esta imagen.';
    const pending: PendingTurn = {
      stage: 'request', turnId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text: displayText, round: 0, request, applied: {},
    };
    writePending(pending);
    setItems((prev) => [...prev, {
      kind: 'msg', rol: 'usuario', texto: displayText,
      ...(imagen ? { imagen } : {}),
    }]);
    setInput('');
    clearImage();
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
    setStored({ items: [WELCOME], historial: [] });
    setError(null);
    clearImage();
  }

  function closeChat() {
    openRef.current = false;
    if (previewRef.current) answerPreview(false);
    confirmRef.current.forEach((resolve) => resolve(false));
    confirmRef.current.clear();
    setItems((prev) => prev.map((entry) => entry.kind === 'confirm' && entry.status === 'pending'
      ? { ...entry, status: 'no' } : entry));
    onClose();
  }

  if (!open) return null;

  const busyText = preview
    ? 'esperando tu aprobación…'
    : busy === 'actuando'
      ? 'trabajando en el plano…'
      : currentModel.local
        ? 'procesando con modelo local…'
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

  const showSuggestions = items.length <= 1 && !busy && !pendingRef.current;

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
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value as ModelId)}
          title={currentModel.repo || 'Modelo en la nube'}
          aria-label="Modelo de IA"
          className="min-w-0 flex-1 cursor-pointer rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        >
          {MODELS.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
        {currentModel.local && (
          <span
            className="shrink-0 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan-200"
            title={currentModel.repo}
          >
            local
          </span>
        )}
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
                </div>
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

        {busy && (
          <div className="flex items-center gap-2" aria-label={`El agente está ${busyText}`}>
            <span className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-surface-2 px-3 py-3">
              <span className="p3d-typing-dot" />
              <span className="p3d-typing-dot [animation-delay:150ms]" />
              <span className="p3d-typing-dot [animation-delay:300ms]" />
            </span>
            {busy === 'actuando' && <span className="text-[11px] text-cyan-200">trabajando en el plano…</span>}
          </div>
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

        {showSuggestions && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void send(s)}
                className="cursor-pointer rounded-full border border-cyan-400/50 px-3 py-1 text-xs text-cyan-200 transition-colors hover:bg-cyan-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                {s}
              </button>
            ))}
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
