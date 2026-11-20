import type { DetectionBox, DetectionClass, PlanDetections } from '@/entities/model3D/types';

/** Elemento editable del plano (una caja de la detección). */
export interface ReviewItem {
  id: string;
  cls: DetectionClass;
  box: DetectionBox;
  score: number;
}

export type Pt = { x: number; y: number };

export const CLASS_COLOR: Record<DetectionClass, string> = {
  wall: '#ef4444',
  door: '#22c55e',
  window: '#3b82f6',
};

/** Por debajo de este score la detección se marca como dudosa. */
export const DOUBT_SCORE = 0.9;

const CLASSES: DetectionClass[] = ['wall', 'door', 'window'];
let seq = 0;
export const newId = () => `i${Date.now().toString(36)}${(seq++).toString(36)}`;

/** JSON del backend -> lista editable (solo muros, puertas y ventanas). */
export function toItems(det: PlanDetections): ReviewItem[] {
  const scores = det.scores ?? [];
  const out: ReviewItem[] = [];
  det.points.forEach((p, i) => {
    const name = det.classes[i]?.name as DetectionClass;
    if (!CLASSES.includes(name)) return;
    out.push({ id: newId(), cls: name, box: normBox({ ...p }), score: scores[i] ?? 1 });
  });
  return out;
}

/** Lista editable -> JSON para el backend (conserva escala y metadatos). */
export function toDetections(base: PlanDetections, items: ReviewItem[]): PlanDetections {
  return {
    ...base,
    points: items.map((it) => it.box),
    classes: items.map((it) => ({ name: it.cls })),
    scores: items.map((it) => it.score),
  };
}

export function normBox(b: DetectionBox): DetectionBox {
  const x1 = Math.min(b.x1, b.x2);
  const x2 = Math.max(b.x1, b.x2);
  const y1 = Math.min(b.y1, b.y2);
  const y2 = Math.max(b.y1, b.y2);
  return { ...b, x1, y1, x2, y2 };
}

export function clampBox(b: DetectionBox, W: number, H: number): DetectionBox {
  const c = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
  return { ...b, x1: c(b.x1, W), x2: c(b.x2, W), y1: c(b.y1, H), y2: c(b.y2, H) };
}

export function moveBox(b: DetectionBox, dx: number, dy: number): DetectionBox {
  const moved: DetectionBox = { ...b, x1: b.x1 + dx, x2: b.x2 + dx, y1: b.y1 + dy, y2: b.y2 + dy };
  if (b.line) moved.line = [b.line[0] + dx, b.line[1] + dy, b.line[2] + dx, b.line[3] + dy];
  return moved;
}

export function center(b: DetectionBox): Pt {
  return { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
}

export function inside(p: Pt, r: DetectionBox): boolean {
  return p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2;
}

/** Grosor típico de muro: el del backend o la mediana del lado corto de los muros. */
export function wallThickness(det: PlanDetections | null, items: ReviewItem[]): number {
  const t = Number(det?.quality?.thickness_px);
  if (Number.isFinite(t) && t > 1) return t;
  const shorts = items
    .filter((i) => i.cls === 'wall' && !i.box.line)
    .map((i) => Math.min(i.box.x2 - i.box.x1, i.box.y2 - i.box.y1))
    .sort((a, b) => a - b);
  return shorts.length ? Math.max(3, shorts[Math.floor(shorts.length / 2)]) : 10;
}

/** Puntos de enganche: extremos del eje de cada muro y sus esquinas. */
function snapPoints(items: ReviewItem[]): Pt[] {
  const pts: Pt[] = [];
  for (const it of items) {
    if (it.cls !== 'wall') continue;
    const b = it.box;
    if (b.line) {
      pts.push({ x: b.line[0], y: b.line[1] }, { x: b.line[2], y: b.line[3] });
      continue;
    }
    const horiz = b.x2 - b.x1 >= b.y2 - b.y1;
    const cy = (b.y1 + b.y2) / 2;
    const cx = (b.x1 + b.x2) / 2;
    if (horiz) pts.push({ x: b.x1, y: cy }, { x: b.x2, y: cy });
    else pts.push({ x: cx, y: b.y1 }, { x: cx, y: b.y2 });
  }
  return pts;
}

export function snapPoint(p: Pt, items: ReviewItem[], tol: number): Pt {
  let best: Pt | null = null;
  let bestD = tol;
  for (const s of snapPoints(items)) {
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best ?? p;
}

/**
 * Muro dibujado de A a B: engancha extremos a muros cercanos y endereza a
 * 0/90° si está casi recto. Recto -> caja alineada; diagonal -> muro 'line'.
 */
export function wallFromDrag(a0: Pt, b0: Pt, t: number, items: ReviewItem[]): DetectionBox | null {
  const tol = Math.max(8, t * 1.5);
  const a = snapPoint(a0, items, tol);
  let b = snapPoint(b0, items, tol);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.hypot(dx, dy) < t) return null;
  const ang = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI) % 180;
  const half = t / 2;
  if (ang < 8 || ang > 172) b = { x: b.x, y: a.y };
  else if (Math.abs(ang - 90) < 8) b = { x: a.x, y: b.y };
  if (b.y === a.y) {
    return normBox({ x1: a.x - half, x2: b.x + (b.x >= a.x ? half : -half), y1: a.y - half, y2: a.y + half });
  }
  if (b.x === a.x) {
    return normBox({ x1: a.x - half, x2: a.x + half, y1: a.y - half, y2: b.y + (b.y >= a.y ? half : -half) });
  }
  return {
    x1: Math.min(a.x, b.x) - half,
    y1: Math.min(a.y, b.y) - half,
    x2: Math.max(a.x, b.x) + half,
    y2: Math.max(a.y, b.y) + half,
    line: [a.x, a.y, b.x, b.y],
    thickness: t,
  };
}

/**
 * Puerta/ventana dibujada: si cae sobre un muro recto, se encaja en él
 * (mismo grosor y eje que el muro) para que el 3D la corte bien.
 */
export function openingOnWall(r: DetectionBox, items: ReviewItem[]): DetectionBox {
  const c = center(r);
  let host: DetectionBox | null = null;
  let bestD = Infinity;
  for (const it of items) {
    if (it.cls !== 'wall' || it.box.line) continue;
    const b = it.box;
    const pad = Math.max(6, Math.min(b.x2 - b.x1, b.y2 - b.y1));
    if (c.x < b.x1 - pad || c.x > b.x2 + pad || c.y < b.y1 - pad || c.y > b.y2 + pad) continue;
    const d = Math.hypot(center(b).x - c.x, center(b).y - c.y);
    if (d < bestD) {
      bestD = d;
      host = b;
    }
  }
  if (!host) return r;
  const horiz = host.x2 - host.x1 >= host.y2 - host.y1;
  if (horiz) {
    return { x1: Math.max(host.x1, r.x1), x2: Math.min(host.x2, r.x2), y1: host.y1, y2: host.y2 };
  }
  return { x1: host.x1, x2: host.x2, y1: Math.max(host.y1, r.y1), y2: Math.min(host.y2, r.y2) };
}
