import { useState } from 'react';
import { Link } from 'react-router-dom';
import { HomeViewer } from '@/widgets/viewer3d/HomeViewer';
import { Button } from '@/shared/ui/button';
import { PlayCircleIcon } from '@/shared/ui/icons';
const STEPS = [
  { n: 1, title: 'Sube tu plano', text: 'PNG, JPG o PDF de tu plano 2D.', color: '#4f7cff' },
  { n: 2, title: 'La IA detecta muros', text: 'Muros, puertas y ventanas en segundos.', color: '#38bdf8' },
  { n: 3, title: 'Presupuesto automático', text: 'Materiales y costos calculados.', color: '#a78bfa' },
  { n: 4, title: 'Exporta en GLB', text: 'Lleva tu modelo a cualquier visor 3D.', color: '#22c55e' },
];

export function HomePage() {
  const [videoPlaying, setVideoPlaying] = useState(false);

  return (
    <div className="relative isolate overflow-hidden">
      {/* Fondo: grilla de plano en movimiento, bocetos que se dibujan y brillo */}
      <div aria-hidden className="p3d-home-grid pointer-events-none absolute inset-0 -z-10" />
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 h-full w-full text-primary"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.28}
        strokeWidth={1.4}
      >
        <path className="p3d-sketch" d="M60 640 h220 v150 h-220 z M60 700 h90 M170 640 v150 M220 790 v-40" />
        <path className="p3d-sketch" style={{ animationDelay: '-3s' }} d="M1180 600 h200 v180 h-200 z M1280 600 v80 M1180 690 h60 M1320 780 v-50" />
        <path className="p3d-sketch" style={{ animationDelay: '-6s' }} d="M640 760 h170 v100 h-170 z M720 760 v100" />
      </svg>
      <div aria-hidden className="pointer-events-none absolute right-[8%] top-20 -z-10 h-[620px] w-[620px] max-w-full rounded-full bg-[radial-gradient(circle,rgba(79,124,255,0.18),transparent_65%)] blur-[20px]" />

    <div className="relative mx-auto flex max-w-6xl flex-col gap-14 px-4 py-12 sm:py-16">
      <div className="grid items-center gap-10 lg:grid-cols-2">
        <div className="p3d-rise-in flex flex-col gap-5">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-muted">
            <span className="p3d-blink h-2 w-2 rounded-full bg-sky-400" />
            De planos 2D a modelos 3D con IA
          </span>

          <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-5xl">
            Modela tus planos en 3D con <span className="p3d-grad-text">Plasma3D</span>
          </h1>

          <p className="max-w-[480px] text-lg leading-relaxed text-muted">
            Sube tu plano, la IA detecta muros, puertas y ventanas y los convierte en un modelo 3D
            editable. Personaliza texturas y calcula presupuestos.
          </p>

          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="p3d-shine shadow-[0_10px_30px_rgba(79,124,255,0.4)]">
              <Link to="/register">Comenzar gratis</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="hover:border-primary">
              <Link to="/login">Iniciar sesión</Link>
            </Button>
          </div>
        </div>

        <div className="p3d-home-preview relative h-[360px] overflow-hidden rounded-2xl border border-primary/30 bg-[radial-gradient(ellipse_at_50%_40%,rgba(79,124,255,0.22),rgba(34,211,238,0.06)_45%,var(--color-canvas)_80%)] shadow-2xl shadow-primary/20 ring-1 ring-inset ring-white/5 sm:h-[440px]">
          <HomeViewer />
          <span className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-canvas/70 px-3 py-1 text-xs font-medium text-muted backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />
            Vista previa 3D · arrastra para rotar
          </span>
        </div>
      </div>

      {/* Video: fachada ligera; el iframe de YouTube recién se carga al pulsar play. */}
      <section aria-label="Video de Plasma3D" className="p3d-rise-in flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Video</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Mira Plasma3D en acción
            </h2>
          </div>
          <span className="text-sm text-muted">Carga rápida: el video solo se descarga al reproducirlo.</span>
        </div>

        <div className="mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-primary/25 bg-black shadow-2xl shadow-primary/10">
          <div className="relative aspect-video">
            {videoPlaying ? (
              <iframe
                className="absolute inset-0 h-full w-full"
                src="https://www.youtube-nocookie.com/embed/Hj_RZQ1wC6E?autoplay=1&rel=0&modestbranding=1"
                title="Video de Plasma3D"
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            ) : (
              <button
                type="button"
                onClick={() => setVideoPlaying(true)}
                className="group absolute inset-0 flex h-full w-full cursor-pointer items-center justify-center overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label="Reproducir video de Plasma3D en YouTube"
              >
                <img
                  src="https://i.ytimg.com/vi/Hj_RZQ1wC6E/maxresdefault.jpg"
                  onError={(event) => {
                    const image = event.currentTarget;
                    image.onerror = null;
                    image.src = 'https://i.ytimg.com/vi/Hj_RZQ1wC6E/hqdefault.jpg';
                  }}
                  alt="Miniatura del video de Plasma3D"
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover opacity-85 transition-transform duration-300 group-hover:scale-[1.02]"
                />
                <span className="absolute inset-0 bg-black/25 transition-colors group-hover:bg-black/15" />
                <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-[#ff0033] text-white shadow-xl shadow-black/40 transition-transform duration-200 group-hover:scale-110">
                  <PlayCircleIcon width={34} height={34} />
                </span>
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Cómo funciona */}
      <section aria-label="Cómo funciona" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <div
            key={s.n}
            className="p3d-rise-in flex flex-col gap-2.5 rounded-[14px] border border-border bg-surface/60 p-5 transition-[transform,border-color] duration-200 hover:-translate-y-[3px] hover:border-primary/50"
            style={{ animationDelay: `${0.1 + i * 0.15}s` }}
          >
            <small className="text-xs tracking-[0.1em] text-primary">PASO {s.n}</small>
            <strong className="text-[17px] text-foreground">{s.title}</strong>
            <span className="text-sm text-muted">{s.text}</span>
            <div className="h-1 overflow-hidden rounded bg-surface-2">
              <div className="p3d-bar" style={{ background: s.color, animationDelay: `${i}s` }} />
            </div>
          </div>
        ))}
      </section>
    </div>
    </div>
  );
}
