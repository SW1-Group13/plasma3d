import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { paymentApi } from '@/features/payment/api';
import { useSession } from '@/entities/session/store';
import type { UserInterface } from '@/entities/user/types';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Spinner } from '@/shared/ui/spinner';
import { CheckIcon } from '@/shared/ui/icons';
import { cn } from '@/shared/lib/utils';
import { toast } from '@/shared/ui/toast';

interface Plan {
  id: string;
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
    features: ['Proyectos ilimitados', 'Soporte prioritario'],
  },
];

export function PaymentForm() {
  const navigate = useNavigate();
  const setUser = useSession((s) => s.setUser);

  const cardholderId = useId();
  const cardNumberId = useId();
  const expiryId = useId();
  const cvvId = useId();

  const [selectedPlan, setSelectedPlan] = useState<Plan>(PLANS[0]);
  const [cardholderName, setCardholderName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [cvv, setCvv] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  function onCardNumber(value: string) {
    setCardNumber(value.replace(/\s/g, '').replace(/\D/g, '').slice(0, 16));
  }
  function onExpiry(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 4);
    setExpiryDate(digits.length >= 2 ? `${digits.slice(0, 2)}/${digits.slice(2, 4)}` : digits);
  }
  function onCvv(value: string) {
    setCvv(value.replace(/\D/g, '').slice(0, 4));
  }

  async function onSubmit() {
    if (!cardholderName || cardNumber.length !== 16 || !/^\d{2}\/\d{2}$/.test(expiryDate) || cvv.length < 3) {
      toast.error('Datos incompletos', 'Revisa los datos de la tarjeta.');
      return;
    }

    setIsProcessing(true);
    try {
      const response = await paymentApi.process({
        plan: selectedPlan.id,
        monto: selectedPlan.price,
        cardholderName,
        cardNumber,
        expiryDate,
        cvv,
      });

      if (response.success) {
        toast.success('Pago exitoso', `Se proceso el pago de $${selectedPlan.price}.`);
        if (response.usuario) setUser(response.usuario as unknown as UserInterface);
        setTimeout(() => navigate('/private/perfil'), 1500);
      } else {
        toast.error('Pago rechazado', response.message || 'No se pudo procesar el pago.');
      }
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? error.response?.data?.message || 'Error al procesar el pago'
        : 'Error al procesar el pago';
      toast.error('Error de pago', String(message));
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        {PLANS.map((plan) => {
          const active = selectedPlan.id === plan.id;
          return (
            <Card
              key={plan.id}
              onClick={() => setSelectedPlan(plan)}
              role="radio"
              aria-checked={active}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setSelectedPlan(plan);
              }}
              className={cn(
                'cursor-pointer transition-all duration-150 hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70',
                active && 'border-primary ring-2 ring-primary/30',
              )}
            >
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
                  <span className="text-xl font-bold tabular-nums text-primary">${plan.price}</span>
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
      </div>

      <Card>
        <CardContent className="p-5">
          <h3 className="mb-4 text-lg font-semibold text-foreground">Datos de pago</h3>
          <div className="flex flex-col gap-4">
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
              <Label htmlFor={cardNumberId}>Numero de tarjeta</Label>
              <Input
                id={cardNumberId}
                value={cardNumber.replace(/(\d{4})(?=\d)/g, '$1 ')}
                onChange={(e) => onCardNumber(e.target.value)}
                placeholder="4242 4242 4242 4242"
                inputMode="numeric"
                autoComplete="cc-number"
                className="tabular-nums"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={expiryId}>Expiracion</Label>
                <Input
                  id={expiryId}
                  value={expiryDate}
                  onChange={(e) => onExpiry(e.target.value)}
                  placeholder="MM/YY"
                  inputMode="numeric"
                  autoComplete="cc-exp"
                  className="tabular-nums"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={cvvId}>CVV</Label>
                <Input
                  id={cvvId}
                  value={cvv}
                  onChange={(e) => onCvv(e.target.value)}
                  placeholder="123"
                  inputMode="numeric"
                  autoComplete="cc-csc"
                  className="tabular-nums"
                />
              </div>
            </div>

            <Button onClick={onSubmit} disabled={isProcessing} variant="success" className="mt-1">
              {isProcessing && <Spinner className="h-4 w-4" />}
              Pagar ${selectedPlan.price}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
