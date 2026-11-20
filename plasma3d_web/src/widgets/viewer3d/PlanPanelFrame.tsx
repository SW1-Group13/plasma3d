import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

interface Props {
  title: string;
  onClose: () => void;
  /** Contenido que se agranda y se mueve (imagen o SVG a pantalla completa del panel). */
  children: ReactNode;
  /** Capa fija encima (carga, errores, leyenda): no se mueve con el zoom. */
  overlay?: ReactNode;
  /** Acciones extra en la barra superior. */
  actions?: ReactNode;
  /** Al cambiar, se vuelve a la vista completa. */
  resetKey?: string;
  className?: string;
}

type View = { x: number; y: number; k: number };
const FIT: View = { x: 0, y: 0, k: 1 };

/** Panel lateral con zoom (rueda) y desplazamiento (arrastrar) para ver un plano. */
export function PlanPanelFrame({ title, onClose, children, overlay, actions, resetKey, className }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; v: View } | null>(null);
  const [view, setView] = useState<View>(FIT);

  useEffect(() => setView(FIT), [resetKey]);

  // Zoom centrado en el cursor (listener no pasivo para poder prevenir el scroll).
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = box.getBoundingClientRect();
      const cx = e.clientX - r.left - r.width / 2;
      const cy = e.clientY - r.top - r.height / 2;
      setView((v) => {
        const k = Math.min(20, Math.max(0.5, v.k * (e.deltaY > 0 ? 1 / 1.15 : 1.15)));
        const f = k / v.k;
        return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
      });
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <section className={cn('flex min-h-0 min-w-0 flex-col bg-surface', className)}>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-xs">
        <span className="font-semibold text-foreground">{title}</span>
        <div className="flex items-center gap-1">
          {actions}
          <button
            type="button"
            onClick={() => setView(FIT)}
            className="rounded-md px-2 py-1 text-muted hover:bg-surface-2 hover:text-foreground"
            title="Volver a la vista completa"
          >
            Ajustar
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-muted hover:bg-surface-2 hover:text-foreground"
            aria-label={`Cerrar ${title.toLowerCase()}`}
            title="Cerrar"
          >
            ✕
          </button>
        </div>
      </header>

      <div
        ref={boxRef}
        className="relative min-h-0 flex-1 cursor-grab touch-none select-none overflow-hidden bg-white active:cursor-grabbing"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragRef.current = { x: e.clientX, y: e.clientY, v: view };
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d) return;
          setView({ ...d.v, x: d.v.x + e.clientX - d.x, y: d.v.y + e.clientY - d.y });
        }}
        onPointerUp={() => (dragRef.current = null)}
        onPointerCancel={() => (dragRef.current = null)}
        onDoubleClick={() => setView(FIT)}
      >
        <div
          className="absolute inset-0"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: 'center' }}
        >
          {children}
        </div>
        {overlay}
      </div>
    </section>
  );
}
