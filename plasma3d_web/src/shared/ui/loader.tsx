import { cn } from '@/shared/lib/utils';
import { Spinner } from '@/shared/ui/spinner';

/** Overlay de carga para un contenedor (canvas, tarjetas, etc.). */
export function LoadingOverlay({
  show,
  label = 'Cargando...',
  className,
}: {
  show: boolean;
  label?: string;
  className?: string;
}) {
  if (!show) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-canvas/70 backdrop-blur-sm',
        className,
      )}
    >
      <Spinner className="h-8 w-8 text-primary" />
      <span className="text-sm text-muted">{label}</span>
    </div>
  );
}

/**
 * Indicador flotante no bloqueante para tareas en segundo plano
 * (subida/procesado de plano, guardado, etc.). Permite seguir navegando.
 */
export function BackgroundTask({ show, label }: { show: boolean; label: string }) {
  if (!show) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-[90] flex items-center gap-2.5 rounded-full border border-border bg-surface/95 px-4 py-2.5 text-sm text-foreground shadow-xl shadow-black/40 backdrop-blur"
    >
      <Spinner className="h-4 w-4 text-primary" />
      {label}
    </div>
  );
}
