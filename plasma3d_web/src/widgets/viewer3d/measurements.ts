import * as THREE from 'three';
import { upwardSurfaceArea } from '@/entities/model3D/three/Modelo3D';
import { WINDOW_SILL_M } from '@/entities/model3D/three/dimensions';

/** Unidades para las cotas del visor. */
export type MeasureUnit = 'cm' | 'm' | 'in';
/** Tipos de pieza a los que se les pueden mostrar medidas. */
export type MeasureKind = 'wall' | 'roof' | 'floor' | 'window' | 'door';

export const MEASURE_KINDS: MeasureKind[] = ['wall', 'roof', 'floor', 'window', 'door'];

/** Un color bien distinto por tipo: etiquetas en el visor y leyenda del menú. */
export const MEASURE_COLORS: Record<MeasureKind, string> = {
  wall: '#4f7cff', // azul
  roof: '#ef4444', // rojo
  floor: '#22c55e', // verde
  window: '#06b6d4', // celeste
  door: '#f59e0b', // ámbar
};

const LENGTH_FACTOR: Record<MeasureUnit, number> = { cm: 100, m: 1, in: 39.3701 };
const AREA_FACTOR: Record<MeasureUnit, number> = { cm: 10000, m: 1, in: 1550.0031 };
const DECIMALS: Record<MeasureUnit, number> = { cm: 0, m: 2, in: 1 };
const AREA_DECIMALS: Record<MeasureUnit, number> = { cm: 0, m: 1, in: 0 };

/** Número sin unidad (para combinar varios en una etiqueta). */
function num(meters: number, unit: MeasureUnit): string {
  return (meters * LENGTH_FACTOR[unit]).toFixed(DECIMALS[unit]);
}

function suffix(unit: MeasureUnit): string {
  return unit === 'in' ? '"' : ` ${unit}`;
}

export function formatLength(meters: number, unit: MeasureUnit): string {
  return `${num(meters, unit)}${suffix(unit)}`;
}

export function formatArea(m2: number, unit: MeasureUnit): string {
  const value = (m2 * AREA_FACTOR[unit]).toFixed(AREA_DECIMALS[unit]);
  const label = unit === 'in' ? 'pulg²' : `${unit}²`;
  return `${value} ${label}`;
}

/** 'largo': muros solo con su largo; 'completo': largo · alto · espesor. */
export type MeasureDetail = 'largo' | 'completo';

export interface MeasureResult {
  text: string;
  /** Punto (mundo) donde va la etiqueta. */
  anchor: THREE.Vector3;
  /** Segmentos de la línea de cota en mundo (pares de puntos); vacío = sin línea. */
  line: THREE.Vector3[];
}

const TICK_M = 0.18; // media longitud de las marcas de los extremos
const LINE_LIFT_M = 0.05; // la cota va apenas sobre la pieza

/**
 * Tamaño de la pieza en SUS ejes locales (caja de la geometría × escala), así
 * un muro rotado mide su largo real y no la caja alineada al mundo.
 */
function localBox(mesh: THREE.Mesh): THREE.Box3 {
  const geom = mesh.geometry as THREE.BufferGeometry;
  if (!geom.boundingBox) geom.computeBoundingBox();
  return geom.boundingBox!;
}

function localSize(mesh: THREE.Mesh): THREE.Vector3 {
  const size = localBox(mesh).getSize(new THREE.Vector3());
  return size.multiply(new THREE.Vector3(
    Math.abs(mesh.scale.x),
    Math.abs(mesh.scale.y),
    Math.abs(mesh.scale.z),
  ));
}

/**
 * Cota a lo largo del eje mayor horizontal de la pieza, sobre su borde
 * superior, con marcas perpendiculares en las puntas. Devuelve los segmentos
 * y el punto medio (para la etiqueta).
 */
function lengthDimension(mesh: THREE.Mesh): { line: THREE.Vector3[]; mid: THREE.Vector3 } {
  const box = localBox(mesh);
  const s = localSize(mesh);
  const alongX = s.x >= s.z;
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const top = box.max.y;
  const a = alongX ? new THREE.Vector3(box.min.x, top, cz) : new THREE.Vector3(cx, top, box.min.z);
  const b = alongX ? new THREE.Vector3(box.max.x, top, cz) : new THREE.Vector3(cx, top, box.max.z);
  a.applyMatrix4(mesh.matrixWorld);
  b.applyMatrix4(mesh.matrixWorld);
  a.y += LINE_LIFT_M;
  b.y += LINE_LIFT_M;

  const dir = new THREE.Vector3().subVectors(b, a).setY(0);
  if (dir.lengthSq() < 1e-8) dir.set(1, 0, 0);
  dir.normalize();
  const perp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(TICK_M);
  const line = [
    a, b,
    a.clone().add(perp), a.clone().sub(perp),
    b.clone().add(perp), b.clone().sub(perp),
  ];
  return { line, mid: new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5) };
}

/**
 * Alto del vano y altura del alféizar (en metros, mundo). Soporta ventanas
 * viejas cuya geometría incluía el antepecho desde el piso (se le resta) y las
 * nuevas, que empiezan en el alféizar.
 */
export function openingVertical(mesh: THREE.Mesh, kind: 'window' | 'door'): { height: number; sill: number } {
  mesh.updateMatrixWorld(true);
  const s = localSize(mesh);
  const world = new THREE.Box3().setFromObject(mesh);
  const fromFloor = world.min.y < 0.3;
  if (kind === 'window' && fromFloor && s.y > WINDOW_SILL_M + 0.1) {
    return { height: s.y - WINDOW_SILL_M, sill: WINDOW_SILL_M };
  }
  return { height: s.y, sill: Math.max(0, fromFloor ? 0 : world.min.y) };
}

/**
 * Eje de una pieza alargada (muro/puerta/ventana) en el piso: extremos en
 * mundo (y = 0), sobre la línea central de su espesor.
 */
export function pieceAxis(mesh: THREE.Mesh): { a: THREE.Vector3; b: THREE.Vector3 } {
  mesh.updateMatrixWorld(true);
  const box = localBox(mesh);
  const s = localSize(mesh);
  const alongX = s.x >= s.z;
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const y = box.min.y;
  const a = alongX ? new THREE.Vector3(box.min.x, y, cz) : new THREE.Vector3(cx, y, box.min.z);
  const b = alongX ? new THREE.Vector3(box.max.x, y, cz) : new THREE.Vector3(cx, y, box.max.z);
  a.applyMatrix4(mesh.matrixWorld).setY(0);
  b.applyMatrix4(mesh.matrixWorld).setY(0);
  return { a, b };
}

/** Bordes de la cara superior (contorno exacto de la losa), en local. */
const topOutlineCache = new WeakMap<THREE.BufferGeometry, THREE.Vector3[]>();

function topOutline(mesh: THREE.Mesh): THREE.Vector3[] {
  const geom = mesh.geometry as THREE.BufferGeometry;
  let local = topOutlineCache.get(geom);
  if (!local) {
    const top = localBox(mesh).max.y;
    const eps = 1e-3 + (top - localBox(mesh).min.y) * 0.01;
    const edges = new THREE.EdgesGeometry(geom, 30);
    const pos = edges.attributes.position as THREE.BufferAttribute;
    local = [];
    for (let i = 0; i + 1 < pos.count; i += 2) {
      const p = new THREE.Vector3().fromBufferAttribute(pos, i);
      const q = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
      if (Math.abs(p.y - top) < eps && Math.abs(q.y - top) < eps) local.push(p, q);
    }
    edges.dispose();
    topOutlineCache.set(geom, local);
  }
  return local.map((p) => {
    const w = p.clone().applyMatrix4(mesh.matrixWorld);
    w.y += 0.02;
    return w;
  });
}

/** Medidas reales de una pieza para el presupuesto (metros, m², m³). */
export interface PieceQuantities {
  length: number;
  height: number;
  thickness: number;
  area: number;
  volume: number;
}

/**
 * Cantidades en ejes locales (sirve para piezas rotadas):
 * - Muro/puerta/ventana: área de la cara (largo × alto), volumen con espesor.
 *   En ventanas el alto es el del vano (sin antepecho), igual que en las cotas.
 * - Piso/techo: área real de la cara superior (con pendiente) y área × espesor.
 */
export function pieceQuantities(mesh: THREE.Mesh, kind: MeasureKind): PieceQuantities {
  mesh.updateMatrixWorld(true);
  const s = localSize(mesh);
  const length = Math.max(s.x, s.z);
  const thickness = Math.min(s.x, s.z);
  if (kind === 'floor' || kind === 'roof') {
    const area = upwardSurfaceArea(mesh);
    return { length, height: s.y, thickness: s.y, area, volume: area * s.y };
  }
  const height = kind === 'window' || kind === 'door' ? openingVertical(mesh, kind).height : s.y;
  return { length, height, thickness, area: length * height, volume: length * height * thickness };
}

/** Texto de la etiqueta, punto de anclaje y línea de cota (todo en mundo). */
export function measureMesh(
  mesh: THREE.Mesh,
  kind: MeasureKind,
  unit: MeasureUnit,
  detail: MeasureDetail = 'completo',
): MeasureResult {
  mesh.updateMatrixWorld(true);
  const world = new THREE.Box3().setFromObject(mesh);
  const s = localSize(mesh);
  const long = Math.max(s.x, s.z);
  const short = Math.min(s.x, s.z);
  const u = suffix(unit);

  switch (kind) {
    case 'wall': {
      const { line, mid } = lengthDimension(mesh);
      mid.y += 0.12;
      const text =
        detail === 'largo'
          ? formatLength(long, unit)
          : `L ${num(long, unit)} · A ${num(s.y, unit)} · e ${num(short, unit)}${u}`;
      return { text, anchor: mid, line };
    }
    case 'door': {
      const { line, mid } = lengthDimension(mesh);
      mid.y += 0.12;
      return { text: `${num(long, unit)} × ${num(s.y, unit)}${u}`, anchor: mid, line };
    }
    case 'window': {
      const { line, mid } = lengthDimension(mesh);
      mid.y += 0.12;
      const v = openingVertical(mesh, 'window');
      const text = `${num(long, unit)} × ${num(v.height, unit)}${u} (alf. ${num(v.sill, unit)})`;
      return { text, anchor: mid, line };
    }
    case 'floor': {
      const anchor = world.getCenter(new THREE.Vector3());
      anchor.y = world.max.y + 0.05;
      return {
        text: `${num(s.x, unit)} × ${num(s.z, unit)}${u} · ${formatArea(upwardSurfaceArea(mesh), unit)}`,
        anchor,
        line: topOutline(mesh),
      };
    }
    case 'roof': {
      const anchor = world.getCenter(new THREE.Vector3());
      anchor.y = world.max.y + 0.2;
      return {
        text: `${num(s.x, unit)} × ${num(s.z, unit)}${u} · ${formatArea(upwardSurfaceArea(mesh), unit)}`,
        anchor,
        line: [],
      };
    }
  }
}
