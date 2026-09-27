import { http } from '@/shared/api/http';
import type { PaymentRequest, PaymentResponse } from '@/entities/payment/types';

export const paymentApi = {
  async process(payment: PaymentRequest): Promise<PaymentResponse> {
    const { data } = await http.post<PaymentResponse>(
      'api/users/payment/process/',
      payment,
    );
    return data;
  },
};
