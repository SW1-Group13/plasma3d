import * as React from 'react';
import { cn } from '@/shared/lib/utils';

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      'flex h-11 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground shadow-inner shadow-black/20 transition-colors placeholder:text-muted/60 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-50',
      'file:mr-3 file:rounded-md file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground hover:file:bg-surface-2',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';
