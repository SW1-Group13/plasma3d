import { create } from 'zustand';
import type { DetectionClass } from '@/entities/model3D/types';
import type { ReviewItem } from './geometry';

export type ReviewTool = 'select' | 'wall' | 'door' | 'window' | 'erase';

const MAX_HISTORY = 100;

interface ReviewStore {
  items: ReviewItem[];
  past: ReviewItem[][];
  future: ReviewItem[][];
  selected: string[];
  tool: ReviewTool;
  dirty: boolean;
  /** Carga inicial: limpia el historial. */
  load: (items: ReviewItem[]) => void;
  /** Aplica un cambio guardándolo en el historial. */
  commit: (items: ReviewItem[]) => void;
  /** Cambio en vivo (arrastre) sin historial; luego llamar a commit. */
  preview: (items: ReviewItem[]) => void;
  undo: () => void;
  redo: () => void;
  select: (ids: string[]) => void;
  setTool: (t: ReviewTool) => void;
  removeSelected: () => void;
  setClassSelected: (cls: DetectionClass) => void;
  markSaved: () => void;
}

export const useReviewStore = create<ReviewStore>((set, get) => ({
  items: [],
  past: [],
  future: [],
  selected: [],
  tool: 'select',
  dirty: false,

  load: (items) => set({ items, past: [], future: [], selected: [], dirty: false }),

  commit: (items) => {
    const { past, items: prev } = get();
    set({ items, past: [...past, prev].slice(-MAX_HISTORY), future: [], dirty: true });
  },

  preview: (items) => set({ items }),

  undo: () => {
    const { past, future, items } = get();
    if (!past.length) return;
    set({
      items: past[past.length - 1],
      past: past.slice(0, -1),
      future: [items, ...future],
      selected: [],
      dirty: true,
    });
  },

  redo: () => {
    const { past, future, items } = get();
    if (!future.length) return;
    set({ items: future[0], past: [...past, items], future: future.slice(1), selected: [], dirty: true });
  },

  select: (ids) => set({ selected: ids }),
  setTool: (tool) => set({ tool, selected: tool === 'select' ? get().selected : [] }),

  removeSelected: () => {
    const { items, selected } = get();
    if (!selected.length) return;
    get().commit(items.filter((i) => !selected.includes(i.id)));
    set({ selected: [] });
  },

  setClassSelected: (cls) => {
    const { items, selected } = get();
    if (!selected.length) return;
    get().commit(
      items.map((i) => {
        if (!selected.includes(i.id) || i.cls === cls) return i;
        // Puertas y ventanas son cajas rectas: se descarta el eje girado.
        const box = cls === 'wall' ? i.box : { x1: i.box.x1, y1: i.box.y1, x2: i.box.x2, y2: i.box.y2 };
        return { ...i, cls, box, score: 1 };
      }),
    );
  },

  markSaved: () => set({ dirty: false }),
}));
