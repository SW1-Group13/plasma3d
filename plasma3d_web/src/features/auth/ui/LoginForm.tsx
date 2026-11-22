import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { authApi, toUserInterface } from '@/features/auth/api';
import { useSession } from '@/entities/session/store';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Spinner } from '@/shared/ui/spinner';
import { EyeIcon, EyeOffIcon } from '@/shared/ui/icons';
import { toast } from '@/shared/ui/toast';

const DEMO_ADMIN_EMAIL = 'admin@plasma3d.local';
const DEMO_ADMIN_PASSWORD = 'Admin12345!';

export function LoginForm() {
  const navigate = useNavigate();
  const setSession = useSession((s) => s.setSession);
  const emailId = useId();
  const passwordId = useId();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
      toast.success('Bienvenido a Plasma3D', 'Inicio de sesion exitoso.');
      navigate('/private');
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? error.response?.data?.detail || error.response?.data?.message || 'Error al iniciar sesion'
        : 'Error al iniciar sesion';
      toast.error('No se pudo iniciar sesion', String(message));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={emailId}>Email</Label>
        <Input
          id={emailId}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@email.com"
          autoComplete="email"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor={passwordId}>Contrasena</Label>
          <button
            type="button"
            onClick={() => {
              setEmail(DEMO_ADMIN_EMAIL);
              setPassword(DEMO_ADMIN_PASSWORD);
            }}
            className="cursor-pointer text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
            title="Autocompletar credenciales del administrador"
          >
            Usar admin
          </button>
        </div>
        <div className="relative">
          <Input
            id={passwordId}
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            className="pr-11"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Ocultar contrasena' : 'Mostrar contrasena'}
            className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
          >
            {showPassword ? <EyeOffIcon width={18} height={18} /> : <EyeIcon width={18} height={18} />}
          </button>
        </div>
      </div>

      <Button type="submit" disabled={loading} className="mt-2">
        {loading && <Spinner className="h-4 w-4" />}
        Iniciar sesion
      </Button>

      <p className="text-center text-sm text-muted">
        No tienes cuenta?{' '}
        <Link to="/register" className="font-medium text-primary hover:underline">
          Crear cuenta
        </Link>
      </p>
    </form>
  );
}
