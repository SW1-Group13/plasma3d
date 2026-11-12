import { http } from '@/shared/api/http';
import type { PaymentRequest, PaymentResponse, PaymentConfig } from '@/entities/payment/types';

export const paymentApi = {
  async process(payment: PaymentRequest): Promise<PaymentResponse> {
    const { data } = await http.post<PaymentResponse>(
      'api/users/payment/process/',
      payment,
    );
    return data;
  },

  async getConfig(): Promise<PaymentConfig> {
    const { data } = await http.get<PaymentConfig>('api/users/payment/config/');
    return data;
  },
};
