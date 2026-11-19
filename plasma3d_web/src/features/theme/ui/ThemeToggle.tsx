import { useThemeStore } from '@/entities/theme/store';
import { MoonIcon, SunIcon } from '@/shared/ui/icons';
import { cn } from '@/shared/lib/utils';

interface ThemeToggleProps {
  showLabel?: boolean;
}

export function ThemeToggle({ showLabel = false }: ThemeToggleProps) {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const light = theme === 'light';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={light}
      aria-label={light ? 'Activar modo oscuro' : 'Activar modo claro'}
      onClick={toggleTheme}
      className={cn(
        'group inline-flex cursor-pointer items-center rounded-lg text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70',
        showLabel ? 'h-12 w-full gap-3 px-3 hover:bg-surface-2 hover:text-foreground' : 'ml-1 p-1',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'relative block h-8 w-16 shrink-0 rounded-full border transition-colors duration-200',
          light ? 'border-[#d6deeb] bg-[#edf1f7]' : 'border-[#465064] bg-[#252b38]',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 flex h-6 w-6 items-center justify-center rounded-full shadow-md transition-transform duration-200 motion-reduce:transition-none',
            light ? 'left-0.5 translate-x-0 bg-white text-[#efb900]' : 'left-0.5 translate-x-8 bg-[#394150] text-[#ffe26b]',
          )}
        >
          {light ? <SunIcon width={18} height={18} /> : <MoonIcon width={18} height={18} />}
        </span>
      </span>
      {showLabel && <span className="text-sm">{light ? 'Modo claro' : 'Modo oscuro'}</span>}
    </button>
  );
}
