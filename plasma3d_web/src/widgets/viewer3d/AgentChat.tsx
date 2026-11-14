import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  agentApi,
  type AgentActionResult,
  type AgentStep,
  type GeminiContent,
} from '@/entities/agent/api';
import { runAgentAction, type AgentHost } from '@/widgets/viewer3d/agentActions';
import { SparklesIcon, XIcon } from '@/shared/ui/icons';
import { cn } from '@/shared/lib/utils';

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
  | { kind: 'msg'; rol: 'usuario' | 'agente'; texto: string }
  | { kind: 'action'; id: number; texto: string; ok: boolean; undone?: boolean }
  | { kind: 'confirm'; id: number; texto: string; status: 'pending' | 'yes' | 'no' };

interface Stored {
  items: ChatItem[];
  historial: GeminiContent[];
}

const MAX_ITEMS = 80;
const MAX_ROUNDS = 6; // idas y vueltas acciones → resultados por pregunta
const SUGGESTIONS = [
  '¿Cuánto cuesta todo?',
  '¿Qué le puedo aumentar?',
  'Haz un cuarto de 3×4 a la derecha',
  '¿Cuánto costaría piedra natural en los muros?',
];

const WELCOME: ChatItem = {
  kind: 'msg',
  rol: 'agente',
  texto:
    'Hola, soy el Agente IA de Plasma3D. Puedo calcular costos con tus precios, dibujar muros, ambientes, puertas, ventanas, pisos y techos, cambiar materiales y proponerte mejoras. ¿Qué necesitas?',
};

function storageKey(modelId: number | string) {
  return `plasma3d.agent.v2.${modelId}`;
}

function load(modelId: number | string): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(modelId)) || 'null') as Stored | null;
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

let itemSeq = 0;

/**
 * Chat flotante estilo Messenger con el Agente IA. El agente responde, calcula
 * costos (en el backend) y ejecuta acciones en el editor (aquí), con tarjetas
 * "Deshacer" y confirmación antes de borrar.
 */
export function AgentChat({ open, onClose, modelId, getHost }: AgentChatProps) {
  const [{ items, historial }, setStored] = useState<Stored>(() => load(modelId));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<false | 'pensando' | 'actuando'>(false);
  const [error, setError] = useState<{ text: string; retry?: string } | null>(null);
  const [minimized, setMinimized] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const undoRef = useRef(new Map<number, () => void>());
  const confirmRef = useRef(new Map<number, (ok: boolean) => void>());

  const setItems = useCallback((fn: (prev: ChatItem[]) => ChatItem[]) => {
    setStored((s) => ({ ...s, items: fn(s.items) }));
  }, []);
  const setHistorial = useCallback((h: GeminiContent[]) => {
    setStored((s) => ({ ...s, historial: h }));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        storageKey(modelId),
        JSON.stringify({ items: items.slice(-MAX_ITEMS), historial }),
      );
    } catch {
      /* sin almacenamiento: la conversación dura solo esta sesión */
    }
  }, [items, historial, modelId]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, busy, minimized, open, error]);

  useEffect(() => {
    if (open && !minimized) inputRef.current?.focus();
  }, [open, minimized]);

  /** Confirmación dentro del chat (resuelve cuando el usuario toca un botón). */
  const confirm = useCallback(
    (texto: string) =>
      new Promise<boolean>((resolve) => {
        const id = ++itemSeq;
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

  /** Ejecuta las acciones pedidas y devuelve sus resultados al agente. */
  async function runActions(step: Extract<AgentStep, { estado: 'acciones' }>): Promise<AgentActionResult[]> {
    const base = getHost();
    const results: AgentActionResult[] = [];
    for (const action of step.acciones) {
      if (!base) {
        results.push({ id: action.id, nombre: action.nombre, respuesta: { ok: false, error: 'El editor no está listo.' } });
        continue;
      }
      const outcome = await runAgentAction({ ...base, confirm }, action);
      results.push({ id: action.id, nombre: action.nombre, respuesta: outcome.respuesta });
      if (outcome.card) {
        const id = ++itemSeq;
        if (outcome.card.undo) undoRef.current.set(id, outcome.card.undo);
        const ok = outcome.respuesta.ok !== false;
        setItems((prev) => [...prev, { kind: 'action', id, texto: outcome.card!.texto, ok }]);
      }
    }
    return results;
  }

  const send = useCallback(
    async (text: string) => {
      const texto = text.trim();
      if (!texto || busy) return;
      const host = getHost();
      setItems((prev) => [...prev, { kind: 'msg', rol: 'usuario', texto }]);
      setInput('');
      setError(null);
      setBusy('pensando');
      try {
        const contexto = host?.engine.getAgentContext() ?? {};
        let step = await agentApi.step({ historial, contexto, mensaje: texto });
        for (let round = 0; step.estado === 'acciones' && round < MAX_ROUNDS; round++) {
          setHistorial(step.historial);
          setBusy('actuando');
          const resultados = await runActions(step);
          setBusy('pensando');
          step = await agentApi.step({
            historial: step.historial,
            contexto: getHost()?.engine.getAgentContext() ?? {},
            resultados,
            pendientes: step.pendientes,
          });
        }
        setHistorial(step.historial);
        const final = step.estado === 'respuesta' ? step.texto : 'Listo. (Se alcanzó el máximo de pasos por pregunta.)';
        setItems((prev) => [...prev, { kind: 'msg', rol: 'agente', texto: final }]);
      } catch (err) {
        setError({ text: errorText(err), retry: texto });
      } finally {
        setBusy(false);
      }
    },
    // runActions/confirm usan refs y setters estables
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, getHost, historial, setItems, setHistorial],
  );

  function retry() {
    if (!error?.retry) return;
    const text = error.retry;
    // Quitar la pregunta fallida para no duplicarla
    setItems((prev) => {
      const idx = prev.map((p) => (p.kind === 'msg' && p.rol === 'usuario' ? p.texto : null)).lastIndexOf(text);
      return idx >= 0 ? prev.filter((_, i) => i !== idx) : prev;
    });
    void send(text);
  }

  function undoItem(id: number) {
    undoRef.current.get(id)?.();
    undoRef.current.delete(id);
    setItems((prev) => prev.map((it) => (it.kind === 'action' && it.id === id ? { ...it, undone: true } : it)));
  }

  function newConversation() {
    confirmRef.current.forEach((resolve) => resolve(false));
    confirmRef.current.clear();
    setStored({ items: [WELCOME], historial: [] });
    setError(null);
  }

  if (!open) return null;

  const busyText = busy === 'actuando' ? 'trabajando en el plano…' : 'escribiendo…';

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

  const showSuggestions = items.length <= 1 && !busy;

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
        <HeaderButton title="Cerrar" onClick={onClose}>
          <XIcon width={16} height={16} />
        </HeaderButton>
      </header>

      <div ref={listRef} className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-3" aria-live="polite">
        {items.map((it, i) => {
          if (it.kind === 'msg') {
            return (
              <div key={i} className={cn('flex', it.rol === 'usuario' ? 'justify-end' : 'justify-start')}>
                <p
                  className={cn(
                    'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-snug',
                    it.rol === 'usuario' ? 'rounded-br-md bg-primary text-white' : 'rounded-bl-md bg-surface-2 text-foreground',
                  )}
                >
                  {it.rol === 'agente' ? <RichText text={it.texto} /> : it.texto}
                </p>
              </div>
            );
          }
          if (it.kind === 'action') {
            const canUndo = !it.undone && undoRef.current.has(it.id);
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

      <form
        className="flex shrink-0 items-end gap-2 border-t border-border p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:pb-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
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
          placeholder="Pregunta, pide un costo o «dibuja…»"
          aria-label="Mensaje para el agente"
          className="max-h-28 min-h-[2.5rem] flex-1 resize-none rounded-2xl border border-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
        />
        <button
          type="submit"
          disabled={!input.trim() || Boolean(busy)}
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
