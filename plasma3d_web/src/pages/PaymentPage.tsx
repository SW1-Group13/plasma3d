import { useCallback, useEffect, useState } from 'react';
import { paymentApi } from '@/features/payment/api';
import { PaymentForm } from '@/features/payment/ui/PaymentForm';
import { PaymentHistory } from '@/features/payment/ui/PaymentHistory';
import type { Pago } from '@/entities/payment/types';
import { toast } from '@/shared/ui/toast';

export function PaymentPage() {
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHistory = useCallback(() => {
    setLoading(true);
    paymentApi
      .history()
      .then(setPagos)
      .catch(() => toast.error('Error', 'No se pudo cargar el historial de pagos.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Planes y pagos</h1>
        <p className="mt-1 text-sm text-muted">Selecciona un plan y completa tus datos.</p>
      </div>
      <PaymentForm onChanged={loadHistory} />
      <PaymentHistory pagos={pagos} loading={loading} />
    </div>
  );
}
