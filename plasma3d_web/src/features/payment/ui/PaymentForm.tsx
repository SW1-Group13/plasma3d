import { useState } from 'react';
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
import { toast } from '@/shared/ui/toast';
import { cn } from '@/shared/lib/utils';

interface Plan {
  id: string;
  name: string;
  price: number;
  features: string[];
}

const PLANS: Plan[] = [
  { id: 'usuario_normal', name: 'Plan Normal', price: 0, features: ['Hasta 5 proyectos', 'Soporte por email'] },
  { id: 'usuario_premium', name: 'Plan Premium', price: 40, features: ['Proyectos ilimitados', 'Soporte prioritario'] },
];

export function PaymentForm() {
  const navigate = useNavigate();
  const setUser = useSession((s) => s.setUser);

  const [selectedPlan, setSelectedPlan] = useState<Plan>(PLANS[0]);
  const [cardholderName, setCardholderName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [cvv, setCvv] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  function onCardNumber(value: string) {
    const digits = value.replace(/\s/g, '').replace(/\D/g, '').slice(0, 16);
    setCardNumber(digits);
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
      toast.error('Error', 'Por favor completa todos los campos correctamente.');
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
        toast.success('Exito', `Pago de $${selectedPlan.price} procesado exitosamente.`);
        if (response.usuario) {
          setUser(response.usuario as unknown as UserInterface);
        }
        setTimeout(() => navigate('/private/perfil'), 1500);
      } else {
        toast.error('Error', response.message || 'Error al procesar el pago');
      }
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? error.response?.data?.message || 'Error al procesar el pago'
        : 'Error al procesar el pago';
      toast.error('Error', String(message));
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        {PLANS.map((plan) => (
          <Card
            key={plan.id}
            onClick={() => setSelectedPlan(plan)}
            className={cn(
              'cursor-pointer transition',
              selectedPlan.id === plan.id
                ? 'border-blue-500 ring-2 ring-blue-200'
                : 'hover:border-slate-300',
            )}
          >
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{plan.name}</h3>
                <span className="text-xl font-bold text-blue-600">${plan.price}</span>
              </div>
              <ul className="mt-3 space-y-1 text-sm text-slate-600">
                {plan.features.map((feature) => (
                  <li key={feature}>• {feature}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-5">
          <h3 className="mb-4 text-lg font-semibold">Datos de pago</h3>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cardholderName">Titular de la tarjeta</Label>
              <Input
                id="cardholderName"
                value={cardholderName}
                onChange={(e) => setCardholderName(e.target.value)}
                placeholder="Juan Perez"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cardNumber">Numero de tarjeta</Label>
              <Input
                id="cardNumber"
                value={cardNumber.replace(/(\d{4})(?=\d)/g, '$1 ')}
                onChange={(e) => onCardNumber(e.target.value)}
                placeholder="4242 4242 4242 4242"
                inputMode="numeric"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="expiryDate">Expiracion</Label>
                <Input
                  id="expiryDate"
                  value={expiryDate}
                  onChange={(e) => onExpiry(e.target.value)}
                  placeholder="MM/YY"
                  inputMode="numeric"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cvv">CVV</Label>
                <Input
                  id="cvv"
                  value={cvv}
                  onChange={(e) => onCvv(e.target.value)}
                  placeholder="123"
                  inputMode="numeric"
                />
              </div>
            </div>

            <Button onClick={onSubmit} disabled={isProcessing} variant="success">
              {isProcessing && <Spinner className="h-4 w-4" />}
              Pagar ${selectedPlan.price}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
