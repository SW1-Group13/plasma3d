import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/shared/ui/button';

/**
 * Registra el service worker de la PWA y, cuando se publica una versión
 * nueva, ofrece actualizar (no se recarga sola para no perder lo que el
 * usuario está editando).
 */
export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.warn('No se pudo registrar el service worker de la PWA', error);
    },
  });

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      className="p3d-fade-in fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[60] mx-auto flex max-w-md items-center gap-3 rounded-xl border border-primary/40 bg-surface/95 p-3 text-sm text-foreground shadow-2xl shadow-black/50 backdrop-blur"
    >
      <span className="flex-1">Hay una versión nueva de Plasma3D.</span>
      <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>
        Luego
      </Button>
      <Button size="sm" onClick={() => void updateServiceWorker(true)}>
        Actualizar
      </Button>
    </div>
  );
}
