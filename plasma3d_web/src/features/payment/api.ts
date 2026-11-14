import { http } from '@/shared/api/http';
import type {
  CreateIntentResponse,
  Pago,
  PaymentConfig,
  PaymentResult,
  PlanId,
} from '@/entities/payment/types';

export const paymentApi = {
  async getConfig(): Promise<PaymentConfig> {
    const { data } = await http.get<PaymentConfig>('api/users/payment/config/');
    return data;
  },

  /** Crea el PaymentIntent en Stripe; el monto lo fija el backend. */
  async createIntent(plan: PlanId): Promise<CreateIntentResponse> {
    const { data } = await http.post<CreateIntentResponse>('api/users/payment/create-intent/', { plan });
    return data;
  },

  /** Pide al backend verificar el cobro en Stripe, registrar el pago y activar el plan. */
  async confirm(paymentIntentId: string): Promise<PaymentResult> {
    const { data } = await http.post<PaymentResult>('api/users/payment/confirm/', {
      payment_intent_id: paymentIntentId,
    });
    return data;
  },

  async history(): Promise<Pago[]> {
    const { data } = await http.get<Pago[]>('api/users/payment/historial/');
    return data;
  },

  async downgrade(): Promise<PaymentResult> {
    const { data } = await http.post<PaymentResult>('api/users/payment/downgrade/', {});
    return data;
  },
};
