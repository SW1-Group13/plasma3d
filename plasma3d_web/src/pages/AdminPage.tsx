import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { adminApi } from '@/entities/admin/api';
import type {
  AdminMetrics,
  AdminPayment,
  AdminRole,
  AdminUser,
} from '@/entities/admin/types';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import {
  CreditCardIcon,
  LayersIcon,
  ShieldIcon,
  SparklesIcon,
  UsersIcon,
} from '@/shared/ui/icons';
import { Input } from '@/shared/ui/input';
import { Spinner } from '@/shared/ui/spinner';
import { toast } from '@/shared/ui/toast';

const ROLE_LABEL: Record<AdminRole, string> = {
  usuario_normal: 'Normal',
  usuario_premium: 'Premium',
  administrador: 'Administrador',
};

const ROLE_CLASS: Record<AdminRole, string> = {
  usuario_normal: 'border-border bg-surface-2 text-muted',
  usuario_premium: 'border-primary/40 bg-primary/10 text-primary',
  administrador: 'border-accent/40 bg-accent/10 text-accent',
};

function money(value: number): string {
  return `$${value.toLocaleString('es', { minimumFractionDigits: 2 })}`;
}

function dateLabel(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

export function AdminPage() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'todos' | AdminRole>('todos');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [metricsData, usersData, paymentsData] = await Promise.all([
        adminApi.metrics(),
        adminApi.users(),
        adminApi.payments(),
      ]);
      setMetrics(metricsData);
      setUsers(usersData.results);
      setPayments(paymentsData);
    } catch {
      toast.error('Error', 'No se pudo cargar el panel de administración.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredUsers = useMemo(() => {
    const text = query.trim().toLowerCase();
    return users.filter((user) => {
      const matchesText =
        !text ||
        user.nombre.toLowerCase().includes(text) ||
        user.email.toLowerCase().includes(text);
      const matchesRole = roleFilter === 'todos' || user.rol === roleFilter;
      return matchesText && matchesRole;
    });
  }, [users, query, roleFilter]);

  async function changeRole(user: AdminUser, rol: AdminRole) {
    if (user.rol === rol) return;
    setSavingId(user.id);
    try {
      await adminApi.updateUser(user.id, { rol });
      await load();
      toast.success('Rol actualizado', `${user.nombre} ahora es ${ROLE_LABEL[rol]}.`);
    } catch {
      toast.error('Error', 'No se pudo cambiar el rol del usuario.');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            <ShieldIcon width={22} height={22} className="text-primary" />
            Panel de administración
          </h1>
          <p className="mt-1 text-sm text-muted">
            Usuarios, actividad de modelos, pagos y análisis de riesgo.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner className="h-4 w-4" /> : 'Actualizar'}
        </Button>
      </div>

      {loading && !metrics ? (
        <div className="flex items-center gap-3 py-10 text-sm text-muted">
          <Spinner className="h-5 w-5 text-primary" /> Cargando métricas...
        </div>
      ) : (
        metrics && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                icon={<UsersIcon width={18} height={18} />}
                label="Usuarios"
                value={String(metrics.usuarios.total)}
                hint={`${metrics.usuarios.premium} premium · ${metrics.usuarios.administradores} admin · +${metrics.usuarios.nuevos_30d} en 30 días`}
              />
              <MetricCard
                icon={<LayersIcon width={18} height={18} />}
                label="Modelos 3D"
                value={String(metrics.modelos.total)}
                hint={`${metrics.modelos.con_3d} con 3D · ${metrics.modelos.nuevos_30d} nuevos en 30 días`}
              />
              <MetricCard
                icon={<CreditCardIcon width={18} height={18} />}
                label="Ingresos"
                value={money(metrics.pagos.ingresos)}
                hint={`${metrics.pagos.exitosos} pagos · ${money(metrics.pagos.ingresos_30d)} en 30 días`}
              />
              <MetricCard
                icon={<SparklesIcon width={18} height={18} />}
                label="Análisis de riesgo"
                value={String(metrics.riesgo.analisis)}
                hint={`${metrics.riesgo.altos} con riesgo alto/crítico`}
              />
            </div>

            <Card>
              <CardHeader className="flex-row items-center justify-between gap-3">
                <CardTitle>Usuarios ({filteredUsers.length})</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar nombre o email"
                    className="h-9 w-56"
                  />
                  <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value as 'todos' | AdminRole)}
                    className="h-9 cursor-pointer rounded-md border border-border bg-surface px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                    aria-label="Filtrar por rol"
                  >
                    <option value="todos">Todos los roles</option>
                    <option value="usuario_normal">Normal</option>
                    <option value="usuario_premium">Premium</option>
                    <option value="administrador">Administrador</option>
                  </select>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="border-y border-border bg-surface-2/60 text-xs uppercase tracking-wide text-muted">
                      <tr>
                        <th className="px-5 py-3 font-medium">Usuario</th>
                        <th className="px-5 py-3 font-medium">Rol</th>
                        <th className="px-5 py-3 font-medium">Modelos</th>
                        <th className="px-5 py-3 font-medium">Pagos</th>
                        <th className="px-5 py-3 font-medium">Registro</th>
                        <th className="px-5 py-3 font-medium">Último modelo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((user) => (
                        <tr key={user.id} className="border-b border-border/60 last:border-0">
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-3">
                              {user.url ? (
                                <img
                                  src={user.url}
                                  alt={user.nombre}
                                  className="h-8 w-8 rounded-full object-cover ring-1 ring-inset ring-border"
                                />
                              ) : (
                                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-foreground ring-1 ring-inset ring-border">
                                  {user.nombre.charAt(0).toUpperCase()}
                                </span>
                              )}
                              <div className="min-w-0">
                                <p className="truncate font-medium text-foreground">{user.nombre}</p>
                                <p className="truncate text-xs text-muted">{user.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <Badge className={ROLE_CLASS[user.rol]}>{ROLE_LABEL[user.rol]}</Badge>
                              <select
                                value={user.rol}
                                onChange={(e) => void changeRole(user, e.target.value as AdminRole)}
                                disabled={savingId === user.id}
                                className="h-8 cursor-pointer rounded-md border border-border bg-surface px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                                aria-label={`Cambiar rol de ${user.nombre}`}
                              >
                                <option value="usuario_normal">Normal</option>
                                <option value="usuario_premium">Premium</option>
                                <option value="administrador">Administrador</option>
                              </select>
                            </div>
                          </td>
                          <td className="px-5 py-3 tabular-nums text-foreground">{user.modelos}</td>
                          <td className="px-5 py-3 tabular-nums text-foreground">{user.pagos_exitosos}</td>
                          <td className="px-5 py-3 tabular-nums text-muted">{dateLabel(user.fecha_registro)}</td>
                          <td className="px-5 py-3 tabular-nums text-muted">{dateLabel(user.ultimo_modelo)}</td>
                        </tr>
                      ))}
                      {filteredUsers.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-5 py-8 text-center text-muted">
                            No hay usuarios que coincidan con el filtro.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Últimos pagos</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="border-y border-border bg-surface-2/60 text-xs uppercase tracking-wide text-muted">
                      <tr>
                        <th className="px-5 py-3 font-medium">Usuario</th>
                        <th className="px-5 py-3 font-medium">Plan</th>
                        <th className="px-5 py-3 font-medium">Monto</th>
                        <th className="px-5 py-3 font-medium">Estado</th>
                        <th className="px-5 py-3 font-medium">Fecha</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((payment) => (
                        <tr key={payment.id} className="border-b border-border/60 last:border-0">
                          <td className="px-5 py-3 text-foreground">{payment.usuario_email}</td>
                          <td className="px-5 py-3 text-muted">{payment.plan}</td>
                          <td className="px-5 py-3 tabular-nums text-foreground">{money(payment.monto)}</td>
                          <td className="px-5 py-3">
                            <Badge
                              className={
                                payment.estado === 'exitoso'
                                  ? 'border-success/40 bg-success/10 text-success'
                                  : 'border-warning/40 bg-warning/10 text-warning'
                              }
                            >
                              {payment.estado}
                            </Badge>
                          </td>
                          <td className="px-5 py-3 tabular-nums text-muted">{dateLabel(payment.fecha_pago ?? payment.fecha_creacion)}</td>
                        </tr>
                      ))}
                      {payments.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-5 py-8 text-center text-muted">
                            Todavía no hay pagos registrados.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )
      )}
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-5">
        <div className="flex items-center gap-2 text-muted">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
            {icon}
          </span>
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        </div>
        <p className="text-2xl font-bold tabular-nums text-foreground">{value}</p>
        <p className="text-xs text-muted">{hint}</p>
      </CardContent>
    </Card>
  );
}
