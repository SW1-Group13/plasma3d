import { useEffect, useState } from 'react';
import { Spinner } from '@/shared/ui/spinner';
import { PlanPanelFrame } from '@/widgets/viewer3d/PlanPanelFrame';

interface Props {
  src: string;
  onClose: () => void;
  className?: string;
}

/** Visor del plano original subido (imagen). */
export function OriginalPlanPanel({ src, onClose, className }: Props) {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => setStatus('loading'), [src]);

  return (
    <PlanPanelFrame
      title="Plano original"
      onClose={onClose}
      resetKey={src}
      className={className}
      overlay={
        status === 'loading' ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Spinner />
          </div>
        ) : status === 'error' ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-neutral-500">
            No se pudo cargar el plano
          </div>
        ) : null
      }
    >
      <img
        src={src}
        alt="Plano original"
        draggable={false}
        onLoad={() => setStatus('ok')}
        onError={() => setStatus('error')}
        className="h-full w-full object-contain"
      />
    </PlanPanelFrame>
  );
}
