import { http } from '@/shared/api/http';

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
  | { estado: 'respuesta'; texto: string; historial: GeminiContent[] }
  | {
      estado: 'acciones';
      acciones: AgentAction[];
      pendientes: GeminiContent[];
      historial: GeminiContent[];
    };

export interface AgentStepRequest {
  historial: GeminiContent[];
  contexto: AgentContext;
  mensaje?: string;
  /** Imagen adjunta como data URL (data:image/...;base64,...). */
  imagen?: string;
  /** Modelo elegido en la UI (por ahora solo afecta la simulacion local). */
  modelo?: string;
  resultados?: AgentActionResult[];
  pendientes?: GeminiContent[];
}

export interface AgentConfig {
  /** Proveedor real configurado en el backend (AI_PROVIDER). */
  provider: string;
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
