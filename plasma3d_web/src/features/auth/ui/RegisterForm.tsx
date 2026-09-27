import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { authApi } from '@/features/auth/api';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Spinner } from '@/shared/ui/spinner';
import { EyeIcon, EyeOffIcon } from '@/shared/ui/icons';
import { toast } from '@/shared/ui/toast';

export function RegisterForm() {
  const navigate = useNavigate();
  const nombreId = useId();
  const emailId = useId();
  const telefonoId = useId();
  const passwordId = useId();

  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();

    if (nombre.trim().length < 5) {
      toast.error('Nombre invalido', 'Debe tener al menos 5 caracteres.');
      return;
    }
    if (!email.includes('@')) {
      toast.error('Email invalido', 'Ingresa un email valido.');
      return;
    }
    if (password.length < 4 || password.length > 10) {
      toast.error('Contrasena invalida', 'Debe tener entre 4 y 10 caracteres.');
      return;
    }
    if (telefono.trim().length < 7) {
      toast.error('Telefono invalido', 'Debe tener al menos 7 digitos.');
      return;
    }

    setLoading(true);
    try {
      await authApi.register({ nombre, email, password, rol: 'usuario_normal', telefono });
      toast.success('Bienvenido a Plasma3D', 'Registro de usuario exitoso.');
      navigate('/login');
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? error.response?.data?.detail || error.response?.data?.message || 'Error al crear la cuenta'
        : 'Error al crear la cuenta';
      toast.error('No se pudo crear la cuenta', String(message));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={nombreId}>Nombre completo</Label>
        <Input id={nombreId} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Juan Perez" />
      </div>

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
        <Label htmlFor={telefonoId}>Telefono</Label>
        <Input
          id={telefonoId}
          type="tel"
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          placeholder="77712345"
          autoComplete="tel"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={passwordId}>Contrasena</Label>
        <div className="relative">
          <Input
            id={passwordId}
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="4 a 10 caracteres"
            autoComplete="new-password"
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
        Crear cuenta
      </Button>

      <p className="text-center text-sm text-muted">
        Ya tienes cuenta?{' '}
        <Link to="/login" className="font-medium text-primary hover:underline">
          Iniciar sesion
        </Link>
      </p>
    </form>
  );
}
