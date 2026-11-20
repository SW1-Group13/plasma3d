import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { agentApi, type GeminiContent } from '@/entities/agent/api';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { SparklesIcon } from '@/shared/ui/icons';
import { Spinner } from '@/shared/ui/spinner';

type ChatMessage = { role: 'usuario' | 'agente'; text: string };

const WELCOME: ChatMessage = {
  role: 'agente',
  text: 'Hola, soy el Agente Plasma3D. Puedo guiarte para usar esta pantalla y resolver dudas sobre la app. ¿Qué necesitas aprender?',
};

function screenFor(path: string): { name: string; suggestions: string[] } {
  if (path.startsWith('/private/dashboard')) {
    return { name: 'Dashboard', suggestions: ['¿Cómo subo un plano?', '¿Cómo abro un modelo?'] };
  }
  if (path.startsWith('/private/perfil')) {
    return { name: 'Perfil', suggestions: ['¿Cómo cambio mi perfil?', '¿Cómo guardo mi modelo?'] };
  }
  if (path.startsWith('/private/pago')) {
    return { name: 'Pagos', suggestions: ['¿Cómo veo mis pagos?', '¿Cómo funcionan los pagos?'] };
  }
  if (path.startsWith('/private/review')) {
    return { name: 'Revisión del plano', suggestions: ['¿Cómo reviso un plano?', '¿Cómo abro el editor?'] };
  }
  if (path.startsWith('/private/admin')) {
    return { name: 'Administración', suggestions: ['¿Cómo uso el panel de administración?', '¿Cómo veo los usuarios?'] };
  }
  return { name: 'Plasma3D', suggestions: ['¿Cómo subo un plano?', '¿Cómo cambio un material?'] };
}

function serverError(error: unknown): string {
  const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return typeof detail === 'string' && detail ? detail : 'No pude responder ahora. Inténtalo de nuevo.';
}

export function SupportChat() {
  const location = useLocation();
  const screen = screenFor(location.pathname);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [history, setHistory] = useState<GeminiContent[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedQuestion, setFailedQuestion] = useState<string | null>(null);
  const listEnd = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (open) listEnd.current?.scrollIntoView?.({ block: 'end' });
  }, [messages, busy, open]);

  async function send(raw: string, repeat = false) {
    const question = raw.trim();
    if (!question || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setFailedQuestion(null);
    if (!repeat) {
      setMessages((current) => [...current, { role: 'usuario', text: question }]);
      setInput('');
    }
    try {
      const step = await agentApi.step({
        modo: 'soporte',
        mensaje: question,
        historial: history,
        contexto: { pantalla: screen.name, ruta: location.pathname },
      });
      if (step.estado !== 'respuesta') {
        throw new Error('El modo de ayuda intentó ejecutar una acción.');
      }
      setHistory(step.historial);
      setMessages((current) => [...current, { role: 'agente', text: step.texto }]);
    } catch (cause) {
      setError(serverError(cause));
      setFailedQuestion(question);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-30 rounded-full px-4 shadow-lg"
        aria-label="Abrir ayuda del Agente Plasma3D"
      >
        <SparklesIcon width={16} height={16} /> Ayuda IA
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[min(80dvh,36rem)] max-w-md flex-col overflow-hidden p-0">
          <DialogHeader className="mb-0 border-b border-border px-4 py-3">
            <DialogTitle className="flex items-center gap-2 text-base">
              <SparklesIcon width={18} height={18} className="text-primary" /> Agente Plasma3D
            </DialogTitle>
            <DialogDescription>Ayuda para usar {screen.name}</DialogDescription>
          </DialogHeader>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                  message.role === 'usuario'
                    ? 'ml-auto rounded-br-md bg-primary text-white'
                    : 'rounded-bl-md bg-surface-2 text-foreground'
                }`}
              >
                {message.text}
              </div>
            ))}
            {busy && <p className="flex items-center gap-2 text-sm text-muted"><Spinner className="h-4 w-4" /> Buscando la guía...</p>}
            {error && (
              <div className="flex items-center gap-2 text-sm text-danger" role="alert">
                <span>{error}</span>
                {failedQuestion && <Button size="sm" variant="outline" onClick={() => void send(failedQuestion, true)}>Reintentar</Button>}
              </div>
            )}
            <div ref={listEnd} />
          </div>

          {messages.length === 1 && (
            <div className="flex flex-wrap gap-2 border-t border-border px-4 py-2">
              {screen.suggestions.map((suggestion) => (
                <Button key={suggestion} type="button" size="sm" variant="outline" disabled={busy} onClick={() => void send(suggestion)}>
                  {suggestion}
                </Button>
              ))}
            </div>
          )}
          <form
            className="flex gap-2 border-t border-border p-3"
            onSubmit={(event) => { event.preventDefault(); void send(input); }}
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Pregunta cómo usar Plasma3D..."
              aria-label="Pregunta de ayuda"
              maxLength={2000}
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
            />
            <Button type="submit" disabled={busy || !input.trim()}>Enviar</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
