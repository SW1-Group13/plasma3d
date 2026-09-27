import * as ToastPrimitive from '@radix-ui/react-toast';
import { create } from 'zustand';
import { cn } from '@/shared/lib/utils';

export type ToastVariant = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  title?: string;
  description?: string;
  variant?: ToastVariant;
}

interface ToastStore {
  items: ToastItem[];
  push: (toast: Omit<ToastItem, 'id'>) => void;
  dismiss: (id: number) => void;
}

let counter = 0;

export const useToastStore = create<ToastStore>((set) => ({
  items: [],
  push: (toast) => set((state) => ({ items: [...state.items, { ...toast, id: ++counter }] })),
  dismiss: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
}));

function push(toast: Omit<ToastItem, 'id'>) {
  useToastStore.getState().push(toast);
}

export const toast = {
  success: (title: string, description?: string) => push({ title, description, variant: 'success' }),
  error: (title: string, description?: string) => push({ title, description, variant: 'error' }),
  info: (title: string, description?: string) => push({ title, description, variant: 'info' }),
};

const variantStyles: Record<ToastVariant, string> = {
  success: 'border-success/40 bg-success/10 text-success',
  error: 'border-danger/40 bg-danger/10 text-danger',
  info: 'border-border bg-surface text-foreground',
};

export function Toaster() {
  const items = useToastStore((state) => state.items);
  const dismiss = useToastStore((state) => state.dismiss);

  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {items.map((item) => (
        <ToastPrimitive.Root
          key={item.id}
          duration={3600}
          onOpenChange={(open) => {
            if (!open) dismiss(item.id);
          }}
          className={cn(
            'p3d-fade-in relative rounded-xl border p-4 shadow-xl shadow-black/40 backdrop-blur',
            variantStyles[item.variant ?? 'info'],
          )}
        >
          {item.title && (
            <ToastPrimitive.Title className="text-sm font-semibold">
              {item.title}
            </ToastPrimitive.Title>
          )}
          {item.description && (
            <ToastPrimitive.Description className="mt-0.5 text-sm opacity-90">
              {item.description}
            </ToastPrimitive.Description>
          )}
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[100] flex w-[22rem] max-w-[90vw] flex-col gap-2" />
    </ToastPrimitive.Provider>
  );
}
