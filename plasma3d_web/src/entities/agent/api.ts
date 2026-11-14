import { http } from '@/shared/api/http';

export type AgentRole = 'usuario' | 'agente';

export interface AgentMessage {
  rol: AgentRole;
  texto: string;
}

/** Resumen del modelo abierto que el agente usa para responder con datos reales. */
export type AgentContext = Record<string, unknown>;

/** Contenido crudo de Gemini (se reenvía tal cual; incluye thoughtSignature). */
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
  resultados?: AgentActionResult[];
  pendientes?: GeminiContent[];
}

export const agentApi = {
  /** Un paso del bucle del agente (pregunta nueva o resultados de acciones). */
  async step(body: AgentStepRequest): Promise<AgentStep> {
    const { data } = await http.post<AgentStep>('api/suggestion_risk/agente/', body);
    return data;
  },
};
