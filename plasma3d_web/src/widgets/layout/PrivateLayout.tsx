import { Fragment, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '@/entities/session/store';
import { userApi } from '@/entities/user/api';
import { Button } from '@/shared/ui/button';
import {
  CubeIcon,
  CreditCardIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  ShieldIcon,
  UserIcon,
  XIcon,
} from '@/shared/ui/icons';
import { assetUrl } from '@/shared/lib/assetUrl';
import { cn } from '@/shared/lib/utils';
import { ThemeToggle } from '@/features/theme/ui/ThemeToggle';
import { SupportChat } from '@/features/support/ui/SupportChat';

const links: {
  to: string;
  label: string;
  icon: typeof LayoutDashboardIcon;
  adminOnly?: boolean;
}[] = [
  { to: '/private/dashboard', label: 'Dashboard', icon: LayoutDashboardIcon },
  { to: '/private/perfil', label: 'Perfil', icon: UserIcon },
  { to: '/private/pago', label: 'Pagos', icon: CreditCardIcon },
  { to: '/private/admin', label: 'Admin', icon: ShieldIcon, adminOnly: true },
];

export function PrivateLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const fullBleed = location.pathname.startsWith('/private/editor');
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);
  const logout = useSession((s) => s.logout);
  const [menuOpen, setMenuOpen] = useState(false);

  // Mantiene el rol/avatar sincronizados (p. ej. si un admin te cambia el rol).
  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    userApi
      .get(user.id)
      .then((fresh) => {
        if (alive) setUser(fresh);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [user?.id, setUser]);

  const visibleLinks = links.filter(
    (link) => !link.adminOnly || user?.rol === 'administrador',
  );

  // Cerrar el menú móvil al navegar o con Esc.
  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  function onLogout() {
    logout();
    navigate('/login');
  }

  return (
    <section className="flex min-h-dvh flex-col bg-canvas">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-canvas/85 backdrop-blur-md">
        <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-2 sm:gap-6">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="-ml-1 flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 sm:hidden"
              aria-label="Abrir menu"
              aria-expanded={menuOpen}
            >
              <MenuIcon width={20} height={20} />
            </button>
            <Link
              to="/private/dashboard"
              className="flex items-center gap-2 rounded-md font-semibold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary ring-1 ring-inset ring-primary/30">
                <CubeIcon className="h-5 w-5" />
              </span>
              Plasma3D
            </Link>

            <div className="hidden items-center gap-1 text-sm sm:flex">
              {visibleLinks.map(({ to, label, icon: Icon }) => (
                <Fragment key={to}>
                  <NavLink
                    to={to}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2 rounded-lg px-3 py-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70',
                        isActive && 'bg-surface-2 font-medium text-foreground',
                      )
                    }
                  >
                    <Icon width={16} height={16} />
                    {label}
                  </NavLink>
                  {to === '/private/pago' && <ThemeToggle />}
                </Fragment>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {user && (
              <div className="hidden items-center gap-2 sm:flex">
                {user.url ? (
                  <img
                    src={assetUrl(user.url)}
                    alt={user.nombre ?? 'Avatar'}
                    className="h-8 w-8 rounded-full object-cover ring-1 ring-inset ring-border"
                  />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold text-foreground ring-1 ring-inset ring-border">
                    {user.nombre?.charAt(0)?.toUpperCase() ?? '?'}
                  </span>
                )}
                <div className="text-right leading-tight">
                  <p className="text-sm font-medium text-foreground">{user.nombre}</p>
                  <p className="text-xs text-muted">{user.rol}</p>
                </div>
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onLogout}
              className="text-muted hover:text-danger"
              aria-label="Cerrar sesion"
            >
              <LogOutIcon width={16} height={16} />
              <span className="hidden sm:inline">Salir</span>
            </Button>
          </div>
        </nav>
      </header>

      {/* Menú móvil (solo < sm): panel lateral con navegación y sesión */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 sm:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
            onClick={() => setMenuOpen(false)}
            aria-label="Cerrar menu"
          />
          <aside className="p3d-fade-in absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-2 border-r border-border bg-surface p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-2 font-semibold text-foreground">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary ring-1 ring-inset ring-primary/30">
                  <CubeIcon className="h-5 w-5" />
                </span>
                Plasma3D
              </span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                aria-label="Cerrar menu"
              >
                <XIcon width={18} height={18} />
              </button>
            </div>

            {user && (
              <div className="mb-2 flex items-center gap-3 rounded-lg bg-surface-2/60 p-3">
                {user.url ? (
                  <img
                    src={assetUrl(user.url)}
                    alt={user.nombre ?? 'Avatar'}
                    className="h-10 w-10 rounded-full object-cover ring-1 ring-inset ring-border"
                  />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-base font-semibold text-foreground ring-1 ring-inset ring-border">
                    {user.nombre?.charAt(0)?.toUpperCase() ?? '?'}
                  </span>
                )}
                <div className="min-w-0 leading-tight">
                  <p className="truncate text-sm font-medium text-foreground">{user.nombre}</p>
                  <p className="truncate text-xs text-muted">{user.rol}</p>
                </div>
              </div>
            )}

            {visibleLinks.map(({ to, label, icon: Icon }) => (
              <Fragment key={to}>
                <NavLink
                  to={to}
                  className={({ isActive }) =>
                    cn(
                      'flex h-12 items-center gap-3 rounded-lg px-3 text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70',
                      isActive && 'bg-surface-2 font-medium text-foreground',
                    )
                  }
                >
                  <Icon width={18} height={18} />
                  {label}
                </NavLink>
                {to === '/private/pago' && <ThemeToggle showLabel />}
              </Fragment>
            ))}

            <button
              type="button"
              onClick={onLogout}
              className="mt-auto flex h-12 cursor-pointer items-center gap-3 rounded-lg px-3 text-muted transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
            >
              <LogOutIcon width={18} height={18} />
              Cerrar sesion
            </button>
          </aside>
        </div>
      )}

      <main className="flex-1">
        {fullBleed ? (
          <Outlet />
        ) : (
          <div className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
            <Outlet />
          </div>
        )}
      </main>
      {!fullBleed && <SupportChat />}
    </section>
  );
}
