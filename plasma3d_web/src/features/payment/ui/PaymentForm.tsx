import { useEffect, useId, useMemo, useState } from 'react';
import axios from 'axios';
import { loadStripe, type Stripe, type StripeCardElementOptions } from '@stripe/stripe-js';
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';
import { paymentApi } from '@/features/payment/api';
import { useSession } from '@/entities/session/store';
import type { PaymentConfig, PlanId } from '@/entities/payment/types';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Spinner } from '@/shared/ui/spinner';
import { CheckIcon } from '@/shared/ui/icons';
import { cn } from '@/shared/lib/utils';
import { toast } from '@/shared/ui/toast';

interface Plan {
  id: PlanId;
  name: string;
  price: number;
  features: string[];
}

const PLANS: Plan[] = [
  { id: 'usuario_normal', name: 'Plan Normal', price: 0, features: ['Hasta 5 proyectos', 'Soporte por email'] },
  {
    id: 'usuario_premium',
    name: 'Plan Premium',
    price: 40,
    features: ['Proyectos ilimitados', 'Soporte prioritario', '30 dias por pago'],
  },
];

/** loadStripe debe llamarse una sola vez por clave publica. */
const stripeCache = new Map<string, Promise<Stripe | null>>();
function getStripe(key: string): Promise<Stripe | null> {
  let promise = stripeCache.get(key);
  if (!promise) {
    promise = loadStripe(key);
    stripeCache.set(key, promise);
  }
  return promise;
}

/** El CardElement vive en un iframe de Stripe: los colores van en valores fijos. */
const CARD_OPTIONS: StripeCardElementOptions = {
  hidePostalCode: true,
  style: {
    base: {
      color: '#e8ecf4',
      iconColor: '#94a0b8',
      fontSize: '14px',
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      '::placeholder': { color: '#94a0b899' },
    },
    invalid: { color: '#f87171', iconColor: '#f87171' },
  },
};

function errorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string; detail?: string } | undefined;
    return data?.message || data?.detail || fallback;
  }
  return fallback;
}

function isPremiumActive(rol?: string, expiracion?: string | null): boolean {
  if (rol !== 'usuario_premium') return false;
  if (!expiracion) return true;
  return expiracion >= new Date().toISOString().slice(0, 10);
}

function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

interface PaymentFormProps {
  /** Se llama despues de un pago o cambio de plan (para recargar el historial). */
  onChanged?: () => void;
}

export function PaymentForm({ onChanged }: PaymentFormProps) {
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const [configError, setConfigError] = useState(false);

  useEffect(() => {
    let alive = true;
    paymentApi
      .getConfig()
      .then((c) => alive && setConfig(c))
      .catch(() => alive && setConfigError(true));
    return () => {
      alive = false;
    };
  }, []);

  const enabled = !!config?.enabled && !!config.publishable_key;
  const stripePromise = useMemo(
    () => (enabled && config ? getStripe(config.publishable_key) : null),
    [enabled, config],
  );

  return (
    <Elements stripe={stripePromise}>
      <CheckoutForm
        enabled={enabled}
        loading={!config && !configError}
        premiumPrice={config?.precios?.usuario_premium}
        onChanged={onChanged}
      />
    </Elements>
  );
}

interface CheckoutFormProps {
  enabled: boolean;
  loading: boolean;
  premiumPrice?: number;
  onChanged?: () => void;
}

function CheckoutForm({ enabled, loading, premiumPrice, onChanged }: CheckoutFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);

  const cardholderId = useId();
  const plans = useMemo(
    () => PLANS.map((p) => (p.id === 'usuario_premium' && premiumPrice != null ? { ...p, price: premiumPrice } : p)),
    [premiumPrice],
  );

  const [selectedId, setSelectedId] = useState<PlanId>('usuario_premium');
  const [cardholderName, setCardholderName] = useState(user?.nombre ?? '');
  const [cardComplete, setCardComplete] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const selectedPlan = plans.find((p) => p.id === selectedId) ?? plans[0];
  const premiumActive = isPremiumActive(user?.rol, user?.fecha_expiracion_plan);
  const isFree = selectedPlan.price === 0;

  async function onPay() {
    if (!stripe || !elements) return;
    const card = elements.getElement(CardElement);
    if (!card) return;
    if (!cardholderName.trim()) {
      toast.error('Datos incompletos', 'Escribe el titular de la tarjeta.');
      return;
    }
    if (!cardComplete) {
      toast.error('Datos incompletos', 'Revisa los datos de la tarjeta.');
      return;
    }

    setIsProcessing(true);
    try {
      // 1. El backend crea el PaymentIntent con el precio del servidor.
      const intent = await paymentApi.createIntent(selectedPlan.id);

      // 2. La tarjeta se envia directo a Stripe (3D Secure si el banco lo pide).
      const { error, paymentIntent } = await stripe.confirmCardPayment(intent.client_secret, {
        payment_method: {
          card,
          billing_details: { name: cardholderName.trim(), email: user?.email },
        },
      });

      if (error) {
        toast.error('Pago rechazado', error.message ?? 'No se pudo procesar el pago.');
        await paymentApi.confirm(intent.payment_intent_id).catch(() => undefined);
        return;
      }
      if (paymentIntent?.status !== 'succeeded') {
        toast.error('Pago incompleto', `Estado del pago: ${paymentIntent?.status ?? 'desconocido'}.`);
        return;
      }

      // 3. El backend verifica el cobro en Stripe, registra el pago y activa el plan.
      const result = await paymentApi.confirm(paymentIntent.id);
      if (result.usuario) setUser(result.usuario);
      card.clear();
      toast.success('Pago exitoso', `Se cobraron $${selectedPlan.price}. Tu plan Premium esta activo.`);
    } catch (error) {
      toast.error('Error de pago', errorMessage(error, 'Error al procesar el pago.'));
    } finally {
      setIsProcessing(false);
      onChanged?.();
    }
  }

  async function onDowngrade() {
    setIsProcessing(true);
    try {
      const result = await paymentApi.downgrade();
      if (result.usuario) setUser(result.usuario);
      toast.success('Plan actualizado', result.message);
    } catch (error) {
      toast.error('Error', errorMessage(error, 'No se pudo cambiar el plan.'));
    } finally {
      setIsProcessing(false);
      onChanged?.();
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        {plans.map((plan) => {
          const active = selectedId === plan.id;
          const current =
            plan.id === 'usuario_premium' ? premiumActive : !premiumActive;
          return (
            <Card
              key={plan.id}
              onClick={() => setSelectedId(plan.id)}
              role="radio"
              aria-checked={active}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setSelectedId(plan.id);
              }}
              className={cn(
                'cursor-pointer transition-all duration-150 hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70',
                active && 'border-primary ring-2 ring-primary/30',
              )}
            >
              <CardContent className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                    {plan.name}
                    {current && (
                      <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                        Plan actual
                      </span>
                    )}
                  </h3>
                  <span className="text-xl font-bold tabular-nums text-primary">
                    ${plan.price}
                    {plan.price > 0 && <span className="text-sm font-medium text-muted"> / 30 dias</span>}
                  </span>
                </div>
                <ul className="mt-3 space-y-1.5 text-sm text-muted">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-2">
                      <CheckIcon width={15} height={15} className="text-success" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
        {premiumActive && user?.fecha_expiracion_plan && (
          <p className="text-sm text-muted">
            Tu plan Premium vence el{' '}
            <span className="font-medium text-foreground">{formatDate(user.fecha_expiracion_plan)}</span>. Si
            pagas de nuevo, se suman 30 dias.
          </p>
        )}
      </div>

      <Card>
        <CardContent className="p-5">
          {isFree ? (
            <div className="flex flex-col gap-4">
              <h3 className="text-lg font-semibold text-foreground">Plan Normal</h3>
              <p className="text-sm text-muted">
                El plan Normal es gratuito y no requiere tarjeta. Tendras un limite de 5 proyectos.
              </p>
              {premiumActive && (
                <p className="text-sm text-warning">
                  Al cambiar a Normal pierdes los dias de Premium que te quedan.
                </p>
              )}
              <Button
                onClick={onDowngrade}
                disabled={isProcessing || !premiumActive}
                variant="outline"
              >
                {isProcessing && <Spinner className="h-4 w-4" />}
                {premiumActive ? 'Cambiar a plan Normal' : 'Ya tienes el plan Normal'}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <h3 className="text-lg font-semibold text-foreground">Datos de pago</h3>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={cardholderId}>Titular de la tarjeta</Label>
                <Input
                  id={cardholderId}
                  value={cardholderName}
                  onChange={(e) => setCardholderName(e.target.value)}
                  placeholder="Juan Perez"
                  autoComplete="cc-name"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Tarjeta</Label>
                <div
                  className={cn(
                    'flex h-11 items-center rounded-lg border border-border bg-surface-2 px-3 shadow-inner shadow-black/20 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/60',
                    cardError && 'border-danger',
                    !enabled && 'opacity-50',
                  )}
                >
                  <div className="w-full">
                    <CardElement
                      options={{ ...CARD_OPTIONS, disabled: !enabled || isProcessing }}
                      onChange={(e) => {
                        setCardComplete(e.complete);
                        setCardError(e.error?.message ?? null);
                      }}
                    />
                  </div>
                </div>
                {cardError && <p className="text-xs text-danger">{cardError}</p>}
              </div>

              <Button
                onClick={onPay}
                disabled={isProcessing || !enabled || !stripe}
                variant="success"
                className="mt-1"
              >
                {isProcessing && <Spinner className="h-4 w-4" />}
                {premiumActive ? 'Renovar' : 'Pagar'} ${selectedPlan.price}
              </Button>
              {loading && <p className="text-xs text-muted">Cargando pasarela de pago...</p>}
              {!loading && !enabled && (
                <p className="text-xs text-danger">Pagos no configurados en el servidor.</p>
              )}
              {enabled && (
                <p className="text-xs text-muted">
                  Pago seguro con Stripe. Los datos de tu tarjeta van directo a Stripe y no se guardan en Plasma3D.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
