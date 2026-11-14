import { Link, Outlet } from 'react-router-dom';
import { CubeIcon } from '@/shared/ui/icons';
import { Button } from '@/shared/ui/button';

export function PublicLayout() {
  return (
    <section className="flex min-h-dvh flex-col bg-canvas" aria-label="Pagina Plasma3D">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-canvas/80 backdrop-blur-md">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link
            to="/home"
            className="flex items-center gap-2 rounded-md font-semibold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary ring-1 ring-inset ring-primary/30">
              <CubeIcon className="h-5 w-5" />
            </span>
            Plasma3D
          </Link>

          <div className="flex items-center gap-1 text-sm">
            <Link
              to="/login"
              className="rounded-md px-2 py-2 text-muted sm:px-3 transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
            >
              Iniciar sesion
            </Link>
            <Button asChild size="sm" className="ml-1">
              <Link to="/register">Crear cuenta</Link>
            </Button>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-border/70 py-6 text-center text-sm text-muted">
        © {new Date().getFullYear()} Plasma3D. Todos los derechos reservados.
      </footer>
    </section>
  );
}
