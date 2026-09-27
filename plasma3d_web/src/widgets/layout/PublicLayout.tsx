import { Link, Outlet } from 'react-router-dom';
import { CubeIcon } from '@/shared/ui/icons';

export function PublicLayout() {
  return (
    <section className="flex min-h-screen flex-col" aria-label="Pagina Plasma3D">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/home" className="flex items-center gap-2 font-semibold text-slate-800">
            <CubeIcon className="h-6 w-6 text-blue-600" />
            Plasma3D
          </Link>
          <div className="flex items-center gap-1 text-sm">
            <Link to="/home" className="rounded-md px-3 py-2 text-slate-600 hover:bg-slate-100">
              Inicio
            </Link>
            <Link to="/login" className="rounded-md px-3 py-2 text-slate-600 hover:bg-slate-100">
              Iniciar sesion
            </Link>
            <Link
              to="/register"
              className="rounded-md bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700"
            >
              Crear cuenta
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white py-6 text-center text-sm text-slate-500">
        © {new Date().getFullYear()} Plasma3D. Todos los derechos reservados.
      </footer>
    </section>
  );
}
