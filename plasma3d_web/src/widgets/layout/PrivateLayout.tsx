import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '@/entities/session/store';
import { Button } from '@/shared/ui/button';
import { CubeIcon, CreditCardIcon, LayoutDashboardIcon, LogOutIcon, UserIcon } from '@/shared/ui/icons';
import { assetUrl } from '@/shared/lib/assetUrl';
import { cn } from '@/shared/lib/utils';

const links = [
  { to: '/private/dashboard', label: 'Dashboard', icon: LayoutDashboardIcon },
  { to: '/private/perfil', label: 'Perfil', icon: UserIcon },
  { to: '/private/pago', label: 'Pagos', icon: CreditCardIcon },
];

export function PrivateLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const fullBleed = location.pathname.startsWith('/private/editor');
  const user = useSession((s) => s.user);
  const logout = useSession((s) => s.logout);

  function onLogout() {
    logout();
    navigate('/login');
  }

  return (
    <section className="flex min-h-dvh flex-col bg-canvas">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-canvas/85 backdrop-blur-md">
        <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-6">
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
              {links.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
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

      <main className="flex-1">
        {fullBleed ? (
          <Outlet />
        ) : (
          <div className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
            <Outlet />
          </div>
        )}
      </main>
    </section>
  );
}
