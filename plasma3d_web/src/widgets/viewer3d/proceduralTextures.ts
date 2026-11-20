import * as THREE from 'three';
import type { Material } from '@/entities/materials/types';

/**
 * Texturas generadas por código a escala real (ladrillo, piedra, tejas…).
 * Cada patrón produce tres mapas a la vez: color, relieve (normal) y
 * rugosidad. Las UV de las piezas están en metros (ver `ensureBoxUVs`), así
 * que `repeat = 1 / tamaño` deja cada ladrillo de su tamaño real.
 */

export type Pattern =
  | 'ladrillo'
  | 'bloque'
  | 'piedra'
  | 'revoque'
  | 'pintura'
  | 'madera'
  | 'ceramica'
  | 'teja'
  | 'teja_concreto'
  | 'teja_asfaltica'
  | 'lamina'
  | 'chapa'
  | 'pizarra'
  | 'tejuela'
  | 'policarbonato'
  | 'grava'
  | 'membrana'
  | 'cesped'
  | 'vidrio';

export interface PatternMaps {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  /** Metros que cubre una repetición [ancho, alto]. */
  size: [number, number];
}

const PX = 512;

function normalize(text: string): string {
  return (text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Patrón según el material y el tipo de pieza. */
export function patternFor(material: Pick<Material, 'nombre' | 'categoria'>, kind?: string): Pattern {
  const name = normalize(material.nombre);
  const cat = normalize(material.categoria);
  if (cat.includes('vidrio') || name.includes('vidrio')) return 'vidrio';
  // Materiales de techo: un diseño por nombre.
  if (name.includes('teja de arcilla')) return 'teja';
  if (name.includes('teja de concreto')) return 'teja_concreto';
  if (name.includes('asfalt')) return 'teja_asfaltica';
  if (name.includes('trapezoidal')) return 'lamina';
  if (name.includes('corrugada')) return 'chapa';
  if (name.includes('pizarra')) return 'pizarra';
  if (name.includes('tejuela')) return 'tejuela';
  if (name.includes('policarbonato')) return 'policarbonato';
  if (name.includes('grava') || name.includes('alquitran')) return 'grava';
  if (name.includes('epdm') || name.includes('tpo') || name.includes('membrana')) return 'membrana';
  if (name.includes('techo verde') || name.includes('cesped')) return 'cesped';
  if (kind === 'roof') {
    // Material que no es de techo puesto en un techo.
    if (cat.includes('metal')) return 'chapa';
    if (cat.includes('madera')) return 'tejuela';
    if (name.includes('terracota')) return 'teja';
    return 'teja_concreto';
  }
  if (name.includes('ladrillo')) return 'ladrillo';
  if (name.includes('bloque')) return 'bloque';
  if (name.includes('piedra')) return 'piedra';
  if (cat.includes('madera') || name.includes('barniz')) return 'madera';
  if (cat.includes('piso') || name.includes('ceramica')) return 'ceramica';
  if (cat.includes('metal')) return 'chapa';
  if (cat.includes('pintura')) return 'pintura';
  return 'revoque';
}

const SIZES: Record<Pattern, [number, number]> = {
  ladrillo: [0.5, 0.32], // 2 ladrillos de 24 cm + junta, 4 hiladas de 7 cm + junta
  bloque: [0.8, 0.4],
  piedra: [1.2, 1.2],
  revoque: [1.5, 1.5],
  pintura: [2, 2],
  madera: [0.48, 1.6], // 4 tablas de 12 cm
  ceramica: [0.8, 0.8], // baldosas de 40 cm
  teja: [0.6, 0.4], // tejas de 30 × 20 cm
  teja_concreto: [0.66, 0.84], // tejas planas de 33 × 42 cm
  teja_asfaltica: [0.99, 0.28], // tejuelas de 33 × 14 cm
  lamina: [1, 1], // crestas cada 25 cm
  chapa: [0.38, 1], // ondas de 7,6 cm
  pizarra: [0.6, 0.4], // placas de 30 × 20 cm
  tejuela: [0.6, 0.4], // tejuelas de ~15 × 20 cm
  policarbonato: [0.32, 1], // canales cada 4 cm
  grava: [0.8, 0.8],
  membrana: [2, 2], // rollos de 1 m
  cesped: [1, 1],
  vidrio: [1, 1],
};

// --- utilidades -----------------------------------------------------------

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r * 255, c.g * 255, c.b * 255];
}

function shade([r, g, b]: [number, number, number], f: number): string {
  const k = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${k(r)},${k(g)},${k(b)})`;
}

function canvas2d(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = PX;
  c.height = PX;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

/** Dibuja `fn` también desplazado ±tamaño para que el patrón sea continuo al repetirse. */
function wrapped(fn: (dx: number, dy: number) => void) {
  for (const dx of [-PX, 0, PX]) for (const dy of [-PX, 0, PX]) fn(dx, dy);
}

/** Grano fino (ruido) sobre color y altura. */
function grain(color: CanvasRenderingContext2D, height: CanvasRenderingContext2D, rand: () => number, amount: number, count = 9000) {
  for (let i = 0; i < count; i++) {
    const x = rand() * PX;
    const y = rand() * PX;
    const r = 0.6 + rand() * 1.6;
    const v = rand();
    color.fillStyle = v > 0.5 ? `rgba(255,255,255,${amount * rand()})` : `rgba(0,0,0,${amount * rand()})`;
    color.fillRect(x, y, r, r);
    height.fillStyle = v > 0.5 ? `rgba(255,255,255,${amount * 0.8})` : `rgba(0,0,0,${amount * 0.8})`;
    height.fillRect(x, y, r, r);
  }
}

/** Manchas suaves grandes (variación de tono). */
function blotches(color: CanvasRenderingContext2D, rand: () => number, amount: number, count = 14) {
  for (let i = 0; i < count; i++) {
    const x = rand() * PX;
    const y = rand() * PX;
    const r = 40 + rand() * 120;
    const dark = rand() > 0.5;
    wrapped((dx, dy) => {
      const g = color.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      g.addColorStop(0, dark ? `rgba(0,0,0,${amount})` : `rgba(255,255,255,${amount})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      color.fillStyle = g;
      color.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    });
  }
}

// --- patrones ---------------------------------------------------------------

interface Drawn {
  color: HTMLCanvasElement;
  height: HTMLCanvasElement;
  /** Rugosidad base (0-1) y variación según altura. */
  roughness: [number, number];
}

/** Hiladas trabadas (ladrillo y bloque). */
function drawCourses(base: [number, number, number], rows: number, cols: number, joint: number, seed: number, rough: [number, number]): Drawn {
  const [c, color] = canvas2d();
  const [h, height] = canvas2d();
  const rand = rng(seed);
  const mortar: [number, number, number] = [176, 170, 160];
  color.fillStyle = shade(mortar, 1);
  color.fillRect(0, 0, PX, PX);
  height.fillStyle = 'rgb(40,40,40)';
  height.fillRect(0, 0, PX, PX);
  const rowH = PX / rows;
  const colW = PX / cols;
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 === 0 ? 0 : colW / 2;
    for (let k = -1; k <= cols; k++) {
      const x = k * colW + offset + joint / 2;
      const y = r * rowH + joint / 2;
      const w = colW - joint;
      const hh = rowH - joint;
      const tone = 0.82 + rand() * 0.32;
      color.fillStyle = shade(base, tone);
      color.fillRect(x, y, w, hh);
      // sombra en el borde inferior y luz arriba (relieve visual)
      color.fillStyle = 'rgba(0,0,0,0.18)';
      color.fillRect(x, y + hh - 2, w, 2);
      color.fillStyle = 'rgba(255,255,255,0.10)';
      color.fillRect(x, y, w, 1.5);
      height.fillStyle = `rgb(${200 + Math.round(rand() * 40)},0,0)`;
      height.fillStyle = `rgb(${215 + Math.round(rand() * 30)},${215 + Math.round(rand() * 30)},${215 + Math.round(rand() * 30)})`;
      height.fillRect(x + 1, y + 1, w - 2, hh - 2);
    }
  }
  grain(color, height, rand, 0.12, 14000);
  blotches(color, rand, 0.06);
  return { color: c, height: h, roughness: rough };
}

function drawStone(base: [number, number, number], seed: number): Drawn {
  const [c, color] = canvas2d();
  const [h, height] = canvas2d();
  const rand = rng(seed);
  const points = Array.from({ length: 22 }, () => [rand() * PX, rand() * PX, 0.75 + rand() * 0.45] as const);
  const img = color.createImageData(PX, PX);
  const himg = height.createImageData(PX, PX);
  for (let y = 0; y < PX; y++) {
    for (let x = 0; x < PX; x++) {
      let d1 = Infinity;
      let d2 = Infinity;
      let tone = 1;
      for (const [px, py, t] of points) {
        let dx = Math.abs(x - px);
        let dy = Math.abs(y - py);
        dx = Math.min(dx, PX - dx);
        dy = Math.min(dy, PX - dy);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          tone = t;
        } else if (d < d2) d2 = d;
      }
      const edge = d2 - d1; // distancia a la junta
      const i = (y * PX + x) * 4;
      const isJoint = edge < 5;
      const bevel = Math.min(1, edge / 22);
      const f = isJoint ? 0.55 : tone * (0.85 + 0.15 * bevel);
      img.data[i] = Math.min(255, base[0] * f);
      img.data[i + 1] = Math.min(255, base[1] * f);
      img.data[i + 2] = Math.min(255, base[2] * f);
      img.data[i + 3] = 255;
      const hv = isJoint ? 20 : 120 + 120 * bevel;
      himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = hv;
      himg.data[i + 3] = 255;
    }
  }
  color.putImageData(img, 0, 0);
  height.putImageData(himg, 0, 0);
  grain(color, height, rand, 0.14, 16000);
  return { color: c, height: h, roughness: [0.9, 0.08] };
}

function drawPlaster(base: [number, number, number], seed: number, strength: number, rough: number): Drawn {
  const [c, color] = canvas2d();
  const [h, height] = canvas2d();
  const rand = rng(seed);
  color.fillStyle = shade(base, 1);
  color.fillRect(0, 0, PX, PX);
  height.fillStyle = 'rgb(128,128,128)';
  height.fillRect(0, 0, PX, PX);
  blotches(color, rand, 0.05 * strength, 18);
  grain(color, height, rand, 0.08 * strength, 26000);
  return { color: c, height: h, roughness: [rough, 0.05] };
}

function drawWood(base: [number, number, number], seed: number): Drawn {
  const [c, color] = canvas2d();
  const [h, height] = canvas2d();
  const rand = rng(seed);
  const planks = 4;
  const w = PX / planks;
  for (let p = 0; p < planks; p++) {
    const tone = 0.85 + rand() * 0.25;
    color.fillStyle = shade(base, tone);
    color.fillRect(p * w, 0, w, PX);
    // vetas
    for (let k = 0; k < 26; k++) {
      const x0 = p * w + rand() * w;
      color.strokeStyle = `rgba(0,0,0,${0.06 + rand() * 0.12})`;
      color.lineWidth = 0.6 + rand() * 1.6;
      color.beginPath();
      for (let y = -10; y <= PX + 10; y += 16) {
        const x = x0 + Math.sin(y / (30 + rand() * 40) + k) * 3;
        if (y === -10) color.moveTo(x, y);
        else color.lineTo(x, y);
      }
      color.stroke();
    }
    // nudo
    if (rand() > 0.5) {
      const kx = p * w + w * (0.3 + rand() * 0.4);
      const ky = rand() * PX;
      const g = color.createRadialGradient(kx, ky, 0, kx, ky, 9);
      g.addColorStop(0, 'rgba(40,20,5,0.55)');
      g.addColorStop(1, 'rgba(40,20,5,0)');
      color.fillStyle = g;
      color.fillRect(kx - 10, ky - 10, 20, 20);
    }
    height.fillStyle = 'rgb(200,200,200)';
    height.fillRect(p * w + 2, 0, w - 4, PX);
    color.fillStyle = 'rgba(0,0,0,0.35)';
    color.fillRect(p * w, 0, 2, PX);
  }
  grain(color, height, rand, 0.05, 6000);
  return { color: c, height: h, roughness: [0.6, 0.1] };
}

function drawTiles(base: [number, number, number], seed: number): Drawn {
  const [c, color] = canvas2d();
  const [h, height] = canvas2d();
  const rand = rng(seed);
  color.fillStyle = 'rgb(150,146,140)';
  color.fillRect(0, 0, PX, PX);
  height.fillStyle = 'rgb(30,30,30)';
  height.fillRect(0, 0, PX, PX);
  const n = 2;
  const s = PX / n;
  const joint = 5;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = i * s + joint / 2;
      const y = j * s + joint / 2;
      color.fillStyle = shade(base, 0.92 + rand() * 0.14);
      color.fillRect(x, y, s - joint, s - joint);
      const g = color.createLinearGradient(x, y, x + s, y + s);
      g.addColorStop(0, 'rgba(255,255,255,0.10)');
      g.addColorStop(1, 'rgba(0,0,0,0.06)');
      color.fillStyle = g;
      color.fillRect(x, y, s - joint, s - joint);
      height.fillStyle = 'rgb(220,220,220)';
      height.fillRect(x, y, s - joint, s - joint);
    }
  }
  blotches(color, rand, 0.04);
  return { color: c, height: h, roughness: [0.35, 0.4] };
}

function drawRoofTiles(base: [number, number, number], seed: number): Drawn {
  const [c, color] = canvas2d();
  const [h, height] = canvas2d();
  const rand = rng(seed);
  const cols = 2;
  const rows = 2;
  const w = PX / cols;
  const rowH = PX / rows;
  color.fillStyle = shade(base, 0.45);
  color.fillRect(0, 0, PX, PX);
  height.fillStyle = 'rgb(0,0,0)';
  height.fillRect(0, 0, PX, PX);
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 ? w / 2 : 0;
    for (let k = -1; k <= cols; k++) {
      const x = k * w + offset;
      const y = r * rowH;
      const tone = 0.85 + rand() * 0.25;
      // teja curva: degradado horizontal claro al centro, sombra a los lados
      const g = color.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, shade(base, tone * 0.62));
      g.addColorStop(0.5, shade(base, tone * 1.08));
      g.addColorStop(1, shade(base, tone * 0.62));
      color.fillStyle = g;
      color.beginPath();
      color.roundRect(x + 2, y, w - 4, rowH - 2, [0, 0, w / 2.4, w / 2.4]);
      color.fill();
      // sombra que deja la fila de arriba
      color.fillStyle = 'rgba(0,0,0,0.30)';
      color.fillRect(x + 2, y, w - 4, 8);
      const hg = height.createLinearGradient(x, 0, x + w, 0);
      hg.addColorStop(0, 'rgb(70,70,70)');
      hg.addColorStop(0.5, 'rgb(240,240,240)');
      hg.addColorStop(1, 'rgb(70,70,70)');
      height.fillStyle = hg;
      height.beginPath();
      height.roundRect(x + 2, y, w - 4, rowH - 2, [0, 0, w / 2.4, w / 2.4]);
      height.fill();
    }
  }
  grain(color, height, rand, 0.1, 10000);
  return { color: c, height: h, roughness: [0.75, 0.1] };
}

function drawCorrugated(base: [number, number, number], seed: number): Drawn {
  const [c, color] = canvas2d();
  const [h, height] = canvas2d();
  const rand = rng(seed);
  const waves = 5;
  for (let x = 0; x < PX; x++) {
    const v = 0.5 + 0.5 * Math.sin((x / PX) * waves * Math.PI * 2);
    color.fillStyle = shade(base, 0.7 + 0.45 * v);
    color.fillRect(x, 0, 1, PX);
    const hv = Math.round(40 + 200 * v);
    height.fillStyle = `rgb(${hv},${hv},${hv})`;
    height.fillRect(x, 0, 1, PX);
  }
  blotches(color, rand, 0.05);
  return { color: c, height: h, roughness: [0.4, 0.1] };
}

/** Filas de piezas planas trabadas (teja de concreto, asfáltica, pizarra, tejuela). */
function drawShingles(
  base: [number, number, number],
  seed: number,
  opts: { rows: number; cols: number; gap: number; variation: number; jitterWidth: boolean; rib?: boolean; grain?: number; wood?: boolean },
): Drawn {
  const [c, color] = canvas2d();
  const [h, height] = canvas2d();
  const rand = rng(seed);
  color.fillStyle = shade(base, 0.35);
  color.fillRect(0, 0, PX, PX);
  height.fillStyle = 'rgb(10,10,10)';
  height.fillRect(0, 0, PX, PX);
  const rowH = PX / opts.rows;
  for (let r = 0; r < opts.rows; r++) {
    const y = r * rowH;
    let x = r % 2 ? -PX / opts.cols / 2 : 0;
    while (x < PX) {
      const w = (PX / opts.cols) * (opts.jitterWidth ? 0.6 + rand() * 0.8 : 1);
      const tone = 1 - opts.variation / 2 + rand() * opts.variation;
      // pieza: sombra arriba (bajo la fila anterior), más clara abajo
      const g = color.createLinearGradient(0, y, 0, y + rowH);
      g.addColorStop(0, shade(base, tone * 0.6));
      g.addColorStop(0.25, shade(base, tone));
      g.addColorStop(1, shade(base, tone * 1.05));
      color.fillStyle = g;
      color.fillRect(x + opts.gap / 2, y, w - opts.gap, rowH - 1);
      const hg = height.createLinearGradient(0, y, 0, y + rowH);
      hg.addColorStop(0, 'rgb(60,60,60)');
      hg.addColorStop(1, 'rgb(235,235,235)');
      height.fillStyle = hg;
      height.fillRect(x + opts.gap / 2, y, w - opts.gap, rowH - 1);
      if (opts.rib) {
        color.fillStyle = 'rgba(255,255,255,0.12)';
        color.fillRect(x + w / 2 - 3, y, 6, rowH - 1);
        height.fillStyle = 'rgb(255,255,255)';
        height.fillRect(x + w / 2 - 3, y + rowH * 0.2, 6, rowH * 0.8);
      }
      if (opts.wood) {
        for (let k = 0; k < 6; k++) {
          color.strokeStyle = `rgba(40,20,5,${0.08 + rand() * 0.12})`;
          color.lineWidth = 1;
          const gx = x + rand() * w;
          color.beginPath();
          color.moveTo(gx, y);
          color.lineTo(gx + (rand() - 0.5) * 6, y + rowH);
          color.stroke();
        }
      }
      x += w;
    }
  }
  if (opts.grain) grain(color, height, rand, opts.grain, 26000);
  blotches(color, rand, 0.05);
  return { color: c, height: h, roughness: [0.85, 0.1] };
}

/** Lámina trapezoidal: crestas planas separadas por valles anchos. */
function drawTrapezoidal(base: [number, number, number], seed: number): Drawn {
  const [c, color] = canvas2d();
  const [h, height] = canvas2d();
  const rand = rng(seed);
  const period = PX / 4;
  for (let x = 0; x < PX; x++) {
    const t = (x % period) / period;
    let v: number;
    if (t < 0.18) v = 1;
    else if (t < 0.28) v = 1 - (t - 0.18) / 0.1;
    else if (t < 0.9) v = 0;
    else v = (t - 0.9) / 0.1;
    const light = t >= 0.18 && t < 0.28 ? 0.6 : t >= 0.9 ? 1.15 : 0.85 + 0.2 * v;
    color.fillStyle = shade(base, light);
    color.fillRect(x, 0, 1, PX);
    const hv = Math.round(30 + 220 * v);
    height.fillStyle = `rgb(${hv},${hv},${hv})`;
    height.fillRect(x, 0, 1, PX);
  }
  blotches(color, rand, 0.04);
  return { color: c, height: h, roughness: [0.35, 0.1] };
}

function drawPolycarbonate(base: [number, number, number], seed: number): Drawn {
  const [c, color] = canvas2d();
  const [h, height] = canvas2d();
  const rand = rng(seed);
  const channels = 8;
  const w = PX / channels;
  for (let i = 0; i < channels; i++) {
    const g = color.createLinearGradient(i * w, 0, (i + 1) * w, 0);
    g.addColorStop(0, shade(base, 0.8));
    g.addColorStop(0.5, shade(base, 1.1));
    g.addColorStop(1, shade(base, 0.8));
    color.fillStyle = g;
    color.fillRect(i * w, 0, w, PX);
    color.fillStyle = 'rgba(255,255,255,0.5)';
    color.fillRect(i * w, 0, 2, PX);
    height.fillStyle = 'rgb(200,200,200)';
    height.fillRect(i * w + 3, 0, w - 6, PX);
  }
  blotches(color, rand, 0.03);
  return { color: c, height: h, roughness: [0.15, 0.05] };
}

/** Grava sobre alquitrán: muchas piedritas. */
function drawGravel(base: [number, number, number], seed: number): Drawn {
  const [c, color] = canvas2d();
  const [h, height] = canvas2d();
  const rand = rng(seed);
  color.fillStyle = shade(base, 0.45);
  color.fillRect(0, 0, PX, PX);
  height.fillStyle = 'rgb(30,30,30)';
  height.fillRect(0, 0, PX, PX);
  for (let i = 0; i < 5200; i++) {
    const x = rand() * PX;
    const y = rand() * PX;
    const r = 1.5 + rand() * 3.5;
    const tone = 0.7 + rand() * 0.7;
    const squash = 0.6 + rand() * 0.4;
    const angle = rand() * 3;
    wrapped((dx, dy) => {
      if (x + dx < -8 || x + dx > PX + 8 || y + dy < -8 || y + dy > PX + 8) return;
      color.fillStyle = shade(base, tone);
      color.beginPath();
      color.ellipse(x + dx, y + dy, r, r * squash, angle, 0, Math.PI * 2);
      color.fill();
      height.fillStyle = 'rgb(220,220,220)';
      height.beginPath();
      height.arc(x + dx, y + dy, r, 0, Math.PI * 2);
      height.fill();
    });
  }
  return { color: c, height: h, roughness: [1, 0] };
}

/** Membrana (EPDM / TPO): lisa con juntas de rollo. */
function drawMembrane(base: [number, number, number], seed: number): Drawn {
  const [c, color] = canvas2d();
  const [h, height] = canvas2d();
  const rand = rng(seed);
  color.fillStyle = shade(base, 1);
  color.fillRect(0, 0, PX, PX);
  height.fillStyle = 'rgb(128,128,128)';
  height.fillRect(0, 0, PX, PX);
  blotches(color, rand, 0.05, 10);
  for (const x of [0, PX / 2]) {
    color.fillStyle = 'rgba(0,0,0,0.22)';
    color.fillRect(x, 0, 4, PX);
    color.fillStyle = 'rgba(255,255,255,0.12)';
    color.fillRect(x + 4, 0, 3, PX);
    height.fillStyle = 'rgb(200,200,200)';
    height.fillRect(x, 0, 7, PX);
  }
  grain(color, height, rand, 0.04, 8000);
  return { color: c, height: h, roughness: [0.6, 0.05] };
}

/** Techo verde: césped. */
function drawGrass(base: [number, number, number], seed: number): Drawn {
  const [c, color] = canvas2d();
  const [h, height] = canvas2d();
  const rand = rng(seed);
  color.fillStyle = shade(base, 0.7);
  color.fillRect(0, 0, PX, PX);
  height.fillStyle = 'rgb(60,60,60)';
  height.fillRect(0, 0, PX, PX);
  blotches(color, rand, 0.12, 24);
  for (let i = 0; i < 14000; i++) {
    const x = rand() * PX;
    const y = rand() * PX;
    const len = 4 + rand() * 9;
    color.strokeStyle = shade(base, 0.7 + rand() * 0.7);
    color.lineWidth = 1;
    color.beginPath();
    color.moveTo(x, y);
    color.lineTo(x + (rand() - 0.5) * 4, y - len);
    color.stroke();
    height.strokeStyle = 'rgba(255,255,255,0.5)';
    height.beginPath();
    height.moveTo(x, y);
    height.lineTo(x, y - len);
    height.stroke();
  }
  return { color: c, height: h, roughness: [0.95, 0.05] };
}

function draw(pattern: Pattern, base: [number, number, number], seed: number): Drawn {
  switch (pattern) {
    case 'ladrillo':
      return drawCourses(base, 4, 2, 6, seed, [0.9, 0.05]);
    case 'bloque':
      return drawCourses(base, 2, 2, 7, seed, [0.95, 0.05]);
    case 'piedra':
      return drawStone(base, seed);
    case 'madera':
      return drawWood(base, seed);
    case 'ceramica':
      return drawTiles(base, seed);
    case 'teja':
      return drawRoofTiles(base, seed);
    case 'teja_concreto':
      return drawShingles(base, seed, { rows: 2, cols: 2, gap: 6, variation: 0.12, jitterWidth: false, rib: true, grain: 0.08 });
    case 'teja_asfaltica':
      return drawShingles(base, seed, { rows: 2, cols: 3, gap: 4, variation: 0.3, jitterWidth: false, grain: 0.16 });
    case 'pizarra':
      return drawShingles(base, seed, { rows: 2, cols: 2, gap: 5, variation: 0.25, jitterWidth: true, grain: 0.05 });
    case 'tejuela':
      return drawShingles(base, seed, { rows: 2, cols: 4, gap: 3, variation: 0.3, jitterWidth: true, wood: true, grain: 0.04 });
    case 'lamina':
      return drawTrapezoidal(base, seed);
    case 'chapa':
      return drawCorrugated(base, seed);
    case 'policarbonato':
      return drawPolycarbonate(base, seed);
    case 'grava':
      return drawGravel(base, seed);
    case 'membrana':
      return drawMembrane(base, seed);
    case 'cesped':
      return drawGrass(base, seed);
    case 'pintura':
      return drawPlaster(base, seed, 0.4, 0.85);
    default:
      return drawPlaster(base, seed, 1, 0.95);
  }
}

/** Mapa normal a partir de la altura (diferencias con vecinos, continuo al repetir). */
function normalFromHeight(height: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const ctx = height.getContext('2d', { willReadFrequently: true })!;
  const src = ctx.getImageData(0, 0, PX, PX).data;
  const [c, out] = canvas2d();
  const img = out.createImageData(PX, PX);
  const at = (x: number, y: number) => src[(((y + PX) % PX) * PX + ((x + PX) % PX)) * 4] / 255;
  for (let y = 0; y < PX; y++) {
    for (let x = 0; x < PX; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * PX + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  out.putImageData(img, 0, 0);
  return c;
}

function roughnessFromHeight(height: HTMLCanvasElement, [base, variation]: [number, number]): HTMLCanvasElement {
  const ctx = height.getContext('2d', { willReadFrequently: true })!;
  const src = ctx.getImageData(0, 0, PX, PX).data;
  const [c, out] = canvas2d();
  const img = out.createImageData(PX, PX);
  for (let i = 0; i < src.length; i += 4) {
    // lo hundido (junta) es más áspero
    const v = Math.max(0, Math.min(1, base + variation * (0.5 - src[i] / 255) * 2));
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 255;
    img.data[i + 3] = 255;
  }
  out.putImageData(img, 0, 0);
  return c;
}

function texture(canvas: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const cache = new Map<string, { drawn: Drawn; normal: HTMLCanvasElement; rough: HTMLCanvasElement }>();

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function generated(pattern: Pattern, color: string) {
  const key = `${pattern}|${color}`;
  let entry = cache.get(key);
  if (!entry) {
    const drawn = draw(pattern, hexToRgb(color), hashSeed(key));
    const strength = pattern === 'pintura' ? 1.5 : pattern === 'revoque' ? 3 : 6;
    entry = { drawn, normal: normalFromHeight(drawn.height, strength), rough: roughnessFromHeight(drawn.height, drawn.roughness) };
    cache.set(key, entry);
  }
  return entry;
}

/**
 * Mapas listos para un material (texturas nuevas: el llamador las libera).
 * Las imágenes base quedan en caché, así generarlas otra vez es instantáneo.
 */
export function patternMaps(pattern: Pattern, color: string): PatternMaps {
  const entry = generated(pattern, color);
  const size = SIZES[pattern];
  const maps = {
    map: texture(entry.drawn.color, true),
    normalMap: texture(entry.normal, false),
    roughnessMap: texture(entry.rough, false),
  };
  Object.values(maps).forEach((t) => t.repeat.set(1 / size[0], 1 / size[1]));
  return { ...maps, size };
}

/** Imagen (data URL) del patrón para la muestra del panel. */
export function patternPreview(pattern: Pattern, color: string): string {
  return generated(pattern, color).drawn.color.toDataURL('image/jpeg', 0.8);
}

export function disposePatternMaps(maps: Partial<PatternMaps> | null | undefined) {
  maps?.map?.dispose();
  maps?.normalMap?.dispose();
  maps?.roughnessMap?.dispose();
}
