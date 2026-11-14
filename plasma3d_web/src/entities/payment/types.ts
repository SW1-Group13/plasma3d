import type { UserInterface } from '@/entities/user/types';

export type PlanId = 'usuario_normal' | 'usuario_premium';

export type PagoEstado = 'pendiente' | 'exitoso' | 'fallido';

/** Pago registrado en el backend (nunca incluye datos completos de la tarjeta). */
export interface Pago {
  id: number;
  plan: PlanId;
  monto: string;
  moneda: string;
  estado: PagoEstado;
  marca_tarjeta: string;
  ultimos4: string;
  fecha_creacion: string;
  fecha_pago: string | null;
  stripe_payment_intent_id: string;
}

export interface PaymentConfig {
  publishable_key: string;
  enabled: boolean;
  precios?: Partial<Record<PlanId, number>>;
  moneda?: string;
}

export interface CreateIntentResponse {
  client_secret: string;
  payment_intent_id: string;
  monto: number;
  moneda: string;
}

export interface PaymentResult {
  success: boolean;
  message: string;
  usuario?: UserInterface;
  pago?: Pago;
}
