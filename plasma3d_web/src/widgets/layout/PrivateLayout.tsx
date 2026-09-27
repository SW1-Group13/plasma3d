import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useSession } from '@/entities/session/store';
import { Button } from '@/shared/ui/button';
import { CubeIcon } from '@/shared/ui/icons';
import { cn } from '@/shared/lib/utils';

const links = [
  { to: '/private/dashboard', label: 'Dashboard' },
  { to: '/private/perfil', label: 'Perfil' },
  { to: '/private/pago', label: 'Pago' },
];

export function PrivateLayout() {
  const navigate = useNavigate();
  const user = useSession((s) => s.user);
  const logout = useSession((s) => s.logout);

  function onLogout() {
    logout();
    navigate('/login');
  }

  return (
    <section className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-6">
            <Link to="/private/dashboard" className="flex items-center gap-2 font-semibold text-slate-800">
              <CubeIcon className="h-6 w-6 text-blue-600" />
              Plasma3D
            </Link>
            <div className="hidden items-center gap-1 text-sm sm:flex">
              {links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={({ isActive }) =>
                    cn(
                      'rounded-md px-3 py-2 text-slate-600 hover:bg-slate-100',
                      isActive && 'bg-slate-100 font-medium text-slate-900',
                    )
                  }
                >
                  {link.label}
                </NavLink>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {user && (
              <div className="hidden text-right sm:block">
                <p className="text-sm font-medium text-slate-800">{user.nombre}</p>
                <p className="text-xs text-slate-500">{user.rol}</p>
              </div>
            )}
            <Button variant="outline" size="sm" onClick={onLogout}>
              Salir
            </Button>
          </div>
        </nav>
      </header>

      <main className="flex-1 bg-slate-50">
        <div className="mx-auto max-w-7xl px-4 py-6">
          <Outlet />
        </div>
      </main>
    </section>
  );
}
