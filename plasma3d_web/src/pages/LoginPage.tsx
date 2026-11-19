import { LoginForm } from '@/features/auth/ui/LoginForm';

/** Escena animada: el plano 2D se dibuja y luego se levantan las paredes en 3D. */
function PlanTo3DScene() {
  return (
    <svg viewBox="0 0 660 560" className="block h-auto w-full text-primary" aria-hidden="true">
      <g className="p3d-ring" fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={1}>
        <circle cx="330" cy="300" r="250" strokeDasharray="4 10" />
        <circle cx="330" cy="300" r="200" />
      </g>

      {/* 1) Plano 2D que se dibuja */}
      <g className="p3d-plan" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
        <path d="M330 300 L538 420 L399 500 L191 380 Z" />
        <path d="M451 370 L312 450" />
      </g>

      {/* 2) Paredes que se levantan (extrusión) */}
      <g className="p3d-walls" stroke="currentColor" strokeOpacity={0.8} strokeWidth={1.6} strokeLinejoin="round" fill="currentColor">
        <path d="M330 300 L538 420 L538 310 L330 190 Z" fillOpacity={0.1} />
        <path d="M191 380 L330 300 L330 190 L191 270 Z" fillOpacity={0.16} />
        <path d="M538 420 L399 500 L399 390 L538 310 Z" fillOpacity={0.22} />
        <path d="M399 500 L191 380 L191 270 L399 390 Z" fillOpacity={0.28} />
        <path d="M451 370 L312 450 L312 340 L451 260 Z" fillOpacity={0.12} />
      </g>

      <g fontSize="13" fill="currentColor" letterSpacing="2" textAnchor="middle">
        <text className="p3d-l1" x="330" y="545">PLANO 2D · 12.0 × 8.0 m</text>
        <text className="p3d-l2" x="330" y="545">MODELO 3D · EXTRUSIÓN 2.7 m</text>
      </g>
    </svg>
  );
}

export function LoginPage() {
  return (
    <div className="relative isolate overflow-hidden">
      <div className="p3d-login-grid pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />
      <div className="p3d-login-glow pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />

      {/* Angosto: login ARRIBA y animación debajo. Ancho: animación a la izquierda, login a la derecha. */}
      <div className="mx-auto flex min-h-[calc(100dvh-8.5rem)] max-w-6xl flex-col items-center justify-center gap-8 px-4 py-10 lg:flex-row lg:gap-12">
        <div className="p3d-fade-in w-full max-w-[420px] shrink-0 rounded-2xl border border-primary/25 bg-surface/70 p-7 shadow-2xl shadow-black/40 backdrop-blur-md lg:order-2 lg:w-[380px]">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-[0.12em] text-primary">Del plano al modelo</p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Iniciar sesión</h1>
          <p className="mb-5 mt-1.5 text-sm text-muted">Accede a tu cuenta de Plasma3D.</p>
          <LoginForm />
        </div>

        <div className="w-full max-w-[480px] lg:order-1 lg:max-w-[660px] lg:flex-1">
          <PlanTo3DScene />
        </div>
      </div>
    </div>
  );
}
