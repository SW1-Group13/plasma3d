import type { Pago, PagoEstado } from '@/entities/payment/types';
import { Badge } from '@/shared/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/spinner';
import { cn } from '@/shared/lib/utils';

const ESTADO_LABEL: Record<PagoEstado, string> = {
  exitoso: 'Exitoso',
  pendiente: 'Pendiente',
  fallido: 'Fallido',
};

const ESTADO_CLASS: Record<PagoEstado, string> = {
  exitoso: 'border-success/40 bg-success/10 text-success',
  pendiente: 'border-warning/40 bg-warning/10 text-warning',
  fallido: 'border-danger/40 bg-danger/10 text-danger',
};

const PLAN_LABEL: Record<string, string> = {
  usuario_premium: 'Premium',
  usuario_normal: 'Normal',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function formatMoney(monto: string, moneda: string): string {
  const value = Number(monto);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: moneda.toUpperCase() }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

interface PaymentHistoryProps {
  pagos: Pago[];
  loading: boolean;
}

export function PaymentHistory({ pagos, loading }: PaymentHistoryProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Historial de pagos</CardTitle>
      </CardHeader>
      <CardContent>
        {loading && pagos.length === 0 ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : pagos.length === 0 ? (
          <p className="text-sm text-muted">Todavia no tienes pagos registrados.</p>
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr className="border-b border-border">
                  <th className="px-2 py-2 font-medium">Fecha</th>
                  <th className="px-2 py-2 font-medium">Plan</th>
                  <th className="px-2 py-2 text-right font-medium">Monto</th>
                  <th className="px-2 py-2 font-medium">Tarjeta</th>
                  <th className="px-2 py-2 font-medium">Estado</th>
                  <th className="px-2 py-2 font-medium">Referencia Stripe</th>
                </tr>
              </thead>
              <tbody>
                {pagos.map((pago) => (
                  <tr key={pago.id} className="border-b border-border/60 last:border-0">
                    <td className="px-2 py-2.5 tabular-nums text-foreground">
                      {formatDateTime(pago.fecha_pago ?? pago.fecha_creacion)}
                    </td>
                    <td className="px-2 py-2.5 text-foreground">{PLAN_LABEL[pago.plan] ?? pago.plan}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-foreground">
                      {formatMoney(pago.monto, pago.moneda)}
                    </td>
                    <td className="px-2 py-2.5 text-muted">
                      {pago.ultimos4 ? `${pago.marca_tarjeta} •••• ${pago.ultimos4}` : '-'}
                    </td>
                    <td className="px-2 py-2.5">
                      <Badge className={cn(ESTADO_CLASS[pago.estado])}>{ESTADO_LABEL[pago.estado]}</Badge>
                    </td>
                    <td className="max-w-[180px] truncate px-2 py-2.5 font-mono text-xs text-muted" title={pago.stripe_payment_intent_id}>
                      {pago.stripe_payment_intent_id}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
