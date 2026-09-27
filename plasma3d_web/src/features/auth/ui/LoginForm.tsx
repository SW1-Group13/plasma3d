import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { authApi, toUserInterface } from '@/features/auth/api';
import { useSession } from '@/entities/session/store';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Spinner } from '@/shared/ui/spinner';
import { toast } from '@/shared/ui/toast';

export function LoginForm() {
  const navigate = useNavigate();
  const setSession = useSession((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email || !password) {
      toast.error('Campos incompletos', 'Ingresa tu email y contrasena.');
      return;
    }

    setLoading(true);
    try {
      const response = await authApi.login({ email, password });
      setSession({
        user: toUserInterface(response),
        accessToken: response.access,
        refreshToken: response.refresh,
      });
      toast.success('Bienvenido a Plasma 3D !!', 'Inicio de sesion exitoso.');
      navigate('/private');
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? error.response?.data?.detail || error.response?.data?.message || 'Error al iniciar sesion'
        : 'Error al iniciar sesion';
      toast.error('Error', String(message));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@email.com"
          autoComplete="email"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Contrasena</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="current-password"
        />
      </div>

      <Button type="submit" disabled={loading} className="mt-2">
        {loading && <Spinner className="h-4 w-4" />}
        Iniciar sesion
      </Button>

      <p className="text-center text-sm text-slate-500">
        No tienes cuenta?{' '}
        <Link to="/register" className="font-medium text-blue-600 hover:underline">
          Crear cuenta
        </Link>
      </p>
    </form>
  );
}
