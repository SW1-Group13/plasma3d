import { http } from '@/shared/api/http';
import { env } from '@/shared/config/env';
import { getAccessToken } from '@/entities/session/store';

export type AgentRole = 'usuario' | 'agente';

export interface AgentMessage {
  rol: AgentRole;
  texto: string;
}

/** Resumen del modelo abierto que el agente usa para responder con datos reales. */
export type AgentContext = Record<string, unknown>;

/** Contenido opaco del agente (se reenvía tal cual entre pasos). */
export type GeminiContent = Record<string, unknown>;

/** Acción del editor que pidió el agente (la ejecuta el frontend). */
export interface AgentAction {
  id?: string | null;
  nombre: string;
  args: Record<string, unknown>;
}

export interface AgentActionResult {
  id?: string | null;
  nombre: string;
  respuesta: Record<string, unknown>;
}

export type AgentStep =
  | { estado: 'respuesta'; texto: string; historial: GeminiContent[]; proveedor?: string }
  | {
      estado: 'acciones';
      acciones: AgentAction[];
      pendientes: GeminiContent[];
      historial: GeminiContent[];
      proveedor?: string;
    };

export interface AgentProvider {
  id: string;
  label: string;
  /** Acepta imágenes. */
  vision: boolean;
}

export interface StreamHandlers {
  /** Texto parcial de la respuesta (palabra por palabra). */
  onToken?: (text: string) => void;
  signal?: AbortSignal;
}

/** El stream no se pudo abrir (sin red, endpoint ausente): usar step() normal. */
export class StreamUnavailableError extends Error {}

export interface AgentStepRequest {
  historial: GeminiContent[];
  contexto: AgentContext;
  mensaje?: string;
  /** Solicita una guía de uso sin acciones sobre el plano. */
  modo?: 'soporte';
  /** Imagen adjunta como data URL (data:image/...;base64,...). */
  imagen?: string;
  /** Proveedor elegido en el chat ('gemini' | 'deepseek'). */
  proveedor?: string;
  /** @deprecated usa `proveedor`. */
  modelo?: string;
  resultados?: AgentActionResult[];
  pendientes?: GeminiContent[];
}

export interface AgentConfig {
  /** Primer proveedor disponible (sugerencia inicial; el usuario elige). */
  provider: string;
  /** Proveedores con API key configurada (los que se pueden elegir). */
  providers?: AgentProvider[];
  /** Si el proveedor actual admite imágenes. */
  vision: boolean;
  /** Si Groq está configurado para transcribir audio. */
  audio: boolean;
}

export const agentApi = {
  /** Un paso del bucle del agente (pregunta nueva o resultados de acciones). */
  async step(body: AgentStepRequest): Promise<AgentStep> {
    const { data } = await http.post<AgentStep>('api/suggestion_risk/agente/', body);
    return data;
  },

  /**
   * Un paso del agente en streaming (SSE): el texto llega con onToken y al
   * final se devuelve el mismo AgentStep que step(). Si el stream no se puede
   * abrir lanza StreamUnavailableError (el llamador usa step()).
   */
  async stepStream(body: AgentStepRequest, { onToken, signal }: StreamHandlers = {}): Promise<AgentStep> {
    const token = getAccessToken();
    let response: Response;
    try {
      response = await fetch(`${env.apiUrl}api/suggestion_risk/agente/stream/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new StreamUnavailableError('No se pudo abrir el stream.');
    }
    // Sin endpoint de streaming (o el servidor no acepta event-stream): usar step().
    if (response.status === 404 || response.status === 405 || response.status === 406) {
      throw new StreamUnavailableError('El servidor no tiene streaming.');
    }
    if (!response.ok || !response.body) {
      let detail = 'No se pudo contactar al agente.';
      try {
        const data = (await response.json()) as { detail?: string };
        if (data?.detail) detail = data.detail;
      } catch {
        /* cuerpo no JSON */
      }
      if (response.status === 401 || response.status === 403) {
        detail = 'Tu sesión expiró. Vuelve a iniciar sesión para usar el agente.';
      }
      throw new Error(detail);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let final: AgentStep | null = null;
    const handle = (block: string) => {
      let event = 'message';
      const data: string[] = [];
      block.split('\n').forEach((line) => {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      });
      if (!data.length) return;
      const payload = JSON.parse(data.join('\n'));
      if (event === 'token') onToken?.(String(payload.t ?? ''));
      else if (event === 'acciones' || event === 'fin') final = payload as AgentStep;
      else if (event === 'error') throw new Error(String(payload.detail ?? 'Error del agente.'));
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let cut = buffer.indexOf('\n\n');
      while (cut >= 0) {
        handle(buffer.slice(0, cut));
        buffer = buffer.slice(cut + 2);
        cut = buffer.indexOf('\n\n');
      }
    }
    if (buffer.trim()) handle(buffer);
    if (!final) throw new Error('La respuesta del agente se cortó. Intenta de nuevo.');
    return final;
  },

  /** Configuración real de IA (visión/audio) para habilitar los botones. */
  async config(): Promise<AgentConfig> {
    const { data } = await http.get<AgentConfig>('api/suggestion_risk/config/');
    return data;
  },

  /** Transcribe un audio (voz) a texto usando Groq/Whisper en el backend. */
  async transcribe(audio: Blob): Promise<{ texto: string }> {
    const form = new FormData();
    const extension = audio.type.includes('mp4') ? 'm4a' : 'webm';
    form.append('audio', audio, `audio.${extension}`);
    const { data } = await http.post<{ texto: string }>(
      'api/suggestion_risk/transcribir/',
      form,
    );
    return data;
  },
};
