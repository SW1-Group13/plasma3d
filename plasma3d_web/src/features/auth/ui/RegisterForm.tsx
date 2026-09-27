import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { authApi } from '@/features/auth/api';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Spinner } from '@/shared/ui/spinner';
import { toast } from '@/shared/ui/toast';

export function RegisterForm() {
  const navigate = useNavigate();
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [telefono, setTelefono] = useState('');
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
      await authApi.register({
        nombre,
        email,
        password,
        rol: 'usuario_normal',
        telefono,
      });
      toast.success('Bienvenido a Plasma 3D !!', 'Registro de usuario exitoso.');
      navigate('/login');
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? error.response?.data?.detail || error.response?.data?.message || 'Error al crear la cuenta'
        : 'Error al crear la cuenta';
      toast.error('Error', String(message));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="nombre">Nombre completo</Label>
        <Input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Juan Perez" />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@email.com"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="telefono">Telefono</Label>
        <Input
          id="telefono"
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          placeholder="77712345"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Contrasena</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="4 a 10 caracteres"
        />
      </div>

      <Button type="submit" disabled={loading} className="mt-2">
        {loading && <Spinner className="h-4 w-4" />}
        Crear cuenta
      </Button>

      <p className="text-center text-sm text-slate-500">
        Ya tienes cuenta?{' '}
        <Link to="/login" className="font-medium text-blue-600 hover:underline">
          Iniciar sesion
        </Link>
      </p>
    </form>
  );
}
