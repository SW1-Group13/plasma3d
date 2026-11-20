import type { FloorPlan2D, FloorPlanItem } from '@/widgets/viewer3d/engine';

/**
 * Imágenes para que el Agente IA compare el plano original con el modelo:
 * la planta actual se dibuja como SVG (igual estilo que "Ver plano trabajado")
 * y ambas se convierten a JPEG reducido (data URL).
 */

type P = [number, number];
const COLOR = { plano: '#374151', manual: '#16a34a', ia: '#8b5cf6', window: '#2563eb' };

const pts = (poly: P[]) => poly.map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join(' ');

function axes(poly: P[]) {
  const e1: P = [poly[1][0] - poly[0][0], poly[1][1] - poly[0][1]];
  const e3: P = [poly[3][0] - poly[0][0], poly[3][1] - poly[0][1]];
  return Math.hypot(...e1) >= Math.hypot(...e3) ? { u: e1, s: e3 } : { u: e3, s: e1 };
}

function tint(it: FloorPlanItem) {
  return it.source === 'plano' ? null : COLOR[it.source];
}

export function floorPlanToSvg(plan: FloorPlan2D): string {
  const b = plan.bounds;
  const pad = Math.max(0.5, Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.05);
  const vb = [b.minX - pad, b.minY - pad, b.maxX - b.minX + 2 * pad, b.maxY - b.minY + 2 * pad];
  // Grosor de trazo en metros (el SVG va en metros).
  const sw = Math.max(vb[2], vb[3]) / 600;
  const parts: string[] = [];
  plan.items.filter((it) => it.kind === 'wall').forEach((it) => {
    const c = tint(it) ?? COLOR.plano;
    parts.push(it.footprint
      ? `<path d="${it.footprint}" fill="${c}" stroke="${c}" stroke-width="${sw}"/>`
      : `<polygon points="${pts(it.poly as P[])}" fill="${c}"/>`);
  });
  plan.items.filter((it) => it.kind === 'window').forEach((it) => {
    const c = tint(it) ?? COLOR.window;
    const { u, s } = axes(it.poly as P[]);
    const a: P = [it.poly[0][0] + s[0] / 2, it.poly[0][1] + s[1] / 2];
    parts.push(`<polygon points="${pts(it.poly as P[])}" fill="#fff" stroke="${c}" stroke-width="${sw * 1.5}"/>`);
    parts.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${a[0] + u[0]}" y2="${a[1] + u[1]}" stroke="${c}" stroke-width="${sw}"/>`);
  });
  plan.items.filter((it) => it.kind === 'door').forEach((it) => {
    const c = tint(it) ?? '#111827';
    const { u, s } = axes(it.poly as P[]);
    const L = Math.hypot(...u) || 1;
    const sl = Math.hypot(...s) || 1;
    const n: P = [s[0] / sl, s[1] / sl];
    const hinge: P = [it.poly[0][0] + s[0], it.poly[0][1] + s[1]];
    const jamb: P = [hinge[0] + u[0], hinge[1] + u[1]];
    const leaf: P = [hinge[0] + n[0] * L, hinge[1] + n[1] * L];
    const sweep = (u[0] / L) * n[1] - (u[1] / L) * n[0] > 0 ? 1 : 0;
    parts.push(`<polygon points="${pts(it.poly as P[])}" fill="#fff" stroke="${c}" stroke-width="${sw}"/>`);
    parts.push(`<line x1="${hinge[0]}" y1="${hinge[1]}" x2="${leaf[0]}" y2="${leaf[1]}" stroke="${c}" stroke-width="${sw * 1.5}"/>`);
    parts.push(`<path d="M ${jamb[0]} ${jamb[1]} A ${L} ${L} 0 0 ${sweep} ${leaf[0]} ${leaf[1]}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-dasharray="${sw * 4} ${sw * 3}"/>`);
  });
  const ratio = vb[2] / vb[3];
  const w = ratio >= 1 ? 1200 : Math.round(1200 * ratio);
  const h = ratio >= 1 ? Math.round(1200 / ratio) : 1200;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb.join(' ')}">`
    + `<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="#ffffff"/>${parts.join('')}</svg>`;
}

function drawToJpeg(source: CanvasImageSource, width: number, height: number, maxDim: number): string {
  const k = Math.min(1, maxDim / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * k));
  canvas.height = Math.max(1, Math.round(height * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('El navegador no permite generar la imagen.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen.'));
    img.src = src;
  });
}

/** SVG (texto) → JPEG data URL. */
export async function svgToDataUrl(svg: string, maxDim = 1024): Promise<string> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = await loadImage(url);
    return drawToJpeg(img, img.naturalWidth || 1200, img.naturalHeight || 1200, maxDim);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Imagen remota (plano original) → JPEG data URL reducido. */
export async function imageUrlToDataUrl(url: string, maxDim = 1024): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error('No se pudo descargar el plano original.');
  }
  if (!response.ok) throw new Error(`No se pudo descargar el plano original (${response.status}).`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImage(objectUrl);
    return drawToJpeg(img, img.naturalWidth, img.naturalHeight, maxDim);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
