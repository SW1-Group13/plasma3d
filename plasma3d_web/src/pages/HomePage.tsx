import { Link } from 'react-router-dom';
import { HomeViewer } from '@/widgets/viewer3d/HomeViewer';
import { Button } from '@/shared/ui/button';
import { CalculatorIcon, DownloadIcon, SparklesIcon } from '@/shared/ui/icons';

export function HomePage() {
  return (
    <div className="relative mx-auto max-w-6xl px-4 py-12 sm:py-16">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-24 left-1/2 h-72 w-[42rem] max-w-full -translate-x-1/2 rounded-full bg-primary/30 blur-[120px]" />
        <div className="absolute right-0 top-40 h-72 w-72 rounded-full bg-accent/20 blur-[110px]" />
        <div className="absolute -left-10 bottom-0 h-56 w-56 rounded-full bg-primary/15 blur-[100px]" />
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
              { k: 'Muros detectados', v: 'IA', Icon: SparklesIcon },
              { k: 'Presupuesto', v: 'Auto', Icon: CalculatorIcon },
              { k: 'Exportacion', v: 'GLB', Icon: DownloadIcon },
            ].map(({ k, v, Icon }) => (
              <div key={k} className="flex flex-col gap-1.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-accent">
                  <Icon width={16} height={16} />
                </span>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="bg-gradient-to-r from-primary to-accent bg-clip-text text-base font-bold text-transparent">
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="p3d-home-preview relative h-[360px] overflow-hidden rounded-2xl border border-primary/30 bg-[radial-gradient(ellipse_at_50%_40%,rgba(79,124,255,0.22),rgba(34,211,238,0.06)_45%,var(--color-canvas)_80%)] shadow-2xl shadow-primary/20 ring-1 ring-inset ring-white/5 sm:h-[440px]">
          <HomeViewer />
          <span className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-canvas/70 px-3 py-1 text-xs font-medium text-muted backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />
            Vista previa 3D · arrastra para rotar
          </span>
        </div>
      </div>
    </div>
  );
}
