import { useEffect, useRef, useState } from 'react';
import { userApi } from '@/entities/user/api';
import { mediaApi } from '@/entities/media/api';
import { useSession } from '@/entities/session/store';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Spinner } from '@/shared/ui/spinner';
import { ImageIcon } from '@/shared/ui/icons';
import { toast } from '@/shared/ui/toast';

interface ProfileForm {
  nombre: string;
  email: string;
  telefono: string;
  rol: string;
  fechaExpiracion: string;
  fechaRegistro: string;
}

const EMPTY_FORM: ProfileForm = {
  nombre: '',
  email: '',
  telefono: '',
  rol: '',
  fechaExpiracion: '',
  fechaRegistro: '',
};

function toDateValue(iso?: string): string {
  return iso ? iso.split('T')[0] : '';
}

export function PerfilPage() {
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);

  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [isReadOnly, setIsReadOnly] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    userApi
      .get(user.id)
      .then((data) => {
        setForm({
          nombre: data.nombre ?? '',
          email: data.email ?? '',
          telefono: data.telefono ?? '',
          rol: data.rol ?? '',
          fechaExpiracion: toDateValue(data.fecha_expiracion_plan),
          fechaRegistro: toDateValue(data.fecha_registro),
        });
        setUser(data);
      })
      .catch(() => toast.error('Error', 'No se pudo cargar el perfil.'));
  }, [user?.id, setUser]);

  async function onSave() {
    if (!user?.id) return;
    setIsLoading(true);
    try {
      const payload: Record<string, string> = {};
      if (form.nombre) payload.nombre = form.nombre;
      if (form.email) payload.email = form.email;
      if (form.rol) payload.rol = form.rol;
      if (form.fechaExpiracion) payload.fecha_expiracion_plan = form.fechaExpiracion;
      if (form.fechaRegistro) payload.fecha_registro = form.fechaRegistro;

      const updated = await userApi.edit(user.id, payload);
      setUser(updated);
      toast.success('Exito', 'Perfil actualizado.');
      setIsReadOnly(true);
    } catch {
      toast.error('Error', 'No se pudo actualizar el perfil.');
    } finally {
      setIsLoading(false);
    }
  }

  async function onImageSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !user?.id) return;

    setIsUploading(true);
    try {
      const upload = await mediaApi.uploadImage(file);
      const updated = await userApi.edit(user.id, { url: upload.url });
      setUser(updated);
      toast.success('Exito', 'Imagen de perfil actualizada.');
    } catch {
      toast.error('Error', 'No se pudo subir la imagen.');
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Mi perfil</h1>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="h-fit">
          <CardContent className="flex flex-col items-center gap-4 p-6">
            <div className="relative">
              <div className="h-32 w-32 overflow-hidden rounded-full border-2 border-border bg-surface-2">
                {user?.url ? (
                  <img src={user.url} alt="Avatar" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-3xl font-semibold text-muted">
                    {user?.nombre?.charAt(0)?.toUpperCase() ?? '?'}
                  </div>
                )}
              </div>
              {isUploading && (
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60">
                  <Spinner className="h-6 w-6 text-white" />
                </span>
              )}
            </div>

            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onImageSelected} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={isUploading}
            >
              <ImageIcon width={15} height={15} /> Cambiar imagen
            </Button>

            <div className="text-center">
              <p className="font-medium text-foreground">{user?.nombre}</p>
              <p className="text-sm text-muted">{user?.email}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Informacion</CardTitle>
            <Button variant="outline" size="sm" onClick={() => setIsReadOnly((v) => !v)}>
              {isReadOnly ? 'Editar' : 'Cancelar'}
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre" value={form.nombre} disabled={isReadOnly} onChange={(v) => setForm({ ...form, nombre: v })} />
              <Field label="Email" type="email" value={form.email} disabled={isReadOnly} onChange={(v) => setForm({ ...form, email: v })} />
              <Field label="Telefono" type="tel" value={form.telefono} disabled={isReadOnly} onChange={(v) => setForm({ ...form, telefono: v })} />
              <Field label="Plan / Rol" value={form.rol} disabled={isReadOnly} onChange={(v) => setForm({ ...form, rol: v })} />
              <Field label="Fecha expiracion" type="date" value={form.fechaExpiracion} disabled={isReadOnly} onChange={(v) => setForm({ ...form, fechaExpiracion: v })} />
              <Field label="Fecha registro" type="date" value={form.fechaRegistro} disabled={isReadOnly} onChange={(v) => setForm({ ...form, fechaRegistro: v })} />
            </div>

            {!isReadOnly && (
              <Button className="mt-6" onClick={onSave} disabled={isLoading}>
                {isLoading && <Spinner className="h-4 w-4" />}
                Guardar cambios
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  disabled,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={disabled ? 'border-transparent bg-surface-2/40 text-muted' : undefined}
      />
    </div>
  );
}
