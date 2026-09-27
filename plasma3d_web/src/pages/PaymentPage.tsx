import { PaymentForm } from '@/features/payment/ui/PaymentForm';

export function PaymentPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Planes y pagos</h1>
        <p className="mt-1 text-sm text-muted">Selecciona un plan y completa tus datos.</p>
      </div>
      <PaymentForm />
    </div>
  );
}
