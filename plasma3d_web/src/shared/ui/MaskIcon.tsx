import { cn } from '@/shared/lib/utils';

interface MaskIconProps {
  src: string;
  className?: string;
  title?: string;
}

/**
 * Renderiza un SVG (archivo) como mascara CSS, para que herede el color
 * de texto actual (currentColor) y se adapte al tema.
 */
export function MaskIcon({ src, className, title }: MaskIconProps) {
  return (
    <span
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn('inline-block bg-current', className)}
      style={{
        WebkitMaskImage: `url("${src}")`,
        maskImage: `url("${src}")`,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
      }}
    />
  );
}
