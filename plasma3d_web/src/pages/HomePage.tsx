import { Link } from 'react-router-dom';
import { HomeViewer } from '@/widgets/viewer3d/HomeViewer';
import { Button } from '@/shared/ui/button';
import { SparklesIcon } from '@/shared/ui/icons';

export function HomePage() {
  return (
    <div className="relative mx-auto max-w-6xl px-4 py-12 sm:py-16">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-24 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />
        <div className="absolute right-0 top-40 h-64 w-64 rounded-full bg-accent/10 blur-[110px]" />
      </div>

      <div className="grid items-center gap-10 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-surface/70 px-3 py-1 text-xs font-medium text-muted">
            <SparklesIcon width={14} height={14} className="text-accent" />
            De planos 2D a modelos 3D con IA
          </span>

          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Modela tus planos en 3D con{' '}
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Plasma3D
            </span>
          </h1>

          <p className="max-w-prose text-lg leading-relaxed text-muted">
            Sube tu plano, la IA detecta muros, puertas y ventanas y los convierte en un modelo 3D
            editable. Personaliza texturas y calcula presupuestos.
          </p>

          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/register">Comenzar gratis</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/login">Iniciar sesion</Link>
            </Button>
          </div>

          <dl className="mt-2 grid max-w-md grid-cols-3 gap-4 border-t border-border/70 pt-5">
            {[
              { k: 'Muros detectados', v: 'IA' },
              { k: 'Presupuesto', v: 'Auto' },
              { k: 'Exportacion', v: 'GLB' },
            ].map((item) => (
              <div key={item.k}>
                <dt className="text-xs text-muted">{item.k}</dt>
                <dd className="text-sm font-semibold text-foreground">{item.v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="h-[420px] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl shadow-black/40">
          <HomeViewer />
        </div>
      </div>
    </div>
  );
}
