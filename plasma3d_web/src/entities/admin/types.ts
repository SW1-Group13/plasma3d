export type AdminRole = 'usuario_normal' | 'usuario_premium' | 'administrador';

export interface AdminMetrics {
  usuarios: {
    total: number;
    normales: number;
    premium: number;
    administradores: number;
    nuevos_30d: number;
  };
  modelos: {
    total: number;
    con_3d: number;
    nuevos_30d: number;
    promedio_por_usuario: number;
  };
  pagos: {
    total: number;
    exitosos: number;
    ingresos: number;
    ingresos_30d: number;
  };
  riesgo: {
    analisis: number;
    altos: number;
  };
  generado_en: string;
}

export interface AdminUser {
  id: number;
  nombre: string;
  email: string;
  rol: AdminRole;
  telefono: number | null;
  url: string | null;
  fecha_registro: string | null;
  fecha_expiracion_plan: string | null;
  modelos: number;
  pagos_exitosos: number;
  ultimo_modelo: string | null;
}

export interface AdminUsersResponse {
  count: number;
  results: AdminUser[];
}

export interface AdminAiSettings {
  ollama_url: string;
  ollama_models: string;
  ollama_timeout: number | null;
  effective: {
    ollama_url: string;
    ollama_models: string;
    ollama_timeout: number;
  };
  fallback: {
    ollama_url: string;
    ollama_models: string;
    ollama_timeout: number;
  };
  actualizado: string;
}

export interface AdminPayment {
  id: number;
  usuario: number;
  usuario_email: string;
  plan: string;
  monto: number;
  moneda: string;
  estado: string;
  marca_tarjeta: string;
  ultimos4: string;
  fecha_creacion: string;
  fecha_pago: string | null;
}
