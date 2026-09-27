import { PaymentForm } from '@/features/payment/ui/PaymentForm';

export function PaymentPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Planes y pagos</h1>
        <p className="text-sm text-slate-500">Selecciona un plan y completa tus datos.</p>
      </div>
      <PaymentForm />
    </div>
  );
}
