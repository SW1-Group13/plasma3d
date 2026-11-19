import type * as THREE from 'three';
import type { AgentAction } from '@/entities/agent/api';
import type { AgentMoveDirection, AgentMoveProposal, AgentPreviewItem, EditorEngine, RoofDrawKind, ViewName } from '@/widgets/viewer3d/engine';
import { MEASURE_KINDS, type MeasureKind, type MeasureUnit } from '@/widgets/viewer3d/measurements';

/** Lo que el chat necesita para ejecutar acciones fuera del motor. */
export interface AgentHost {
  engine: EditorEngine;
  setView: (view: ViewName) => void;
  setMeasures: (kinds: MeasureKind[], unit?: MeasureUnit) => void;
  /** Pide confirmación al usuario en el chat (borrar, cambios masivos). */
  confirm: (texto: string) => Promise<boolean>;
  /** El chat ya pidió todas las confirmaciones antes de abrir la transacción. */
  preapproved?: boolean;
  /** Propuesta que el usuario vio y aprobó en el plano. */
  moveProposal?: AgentMoveProposal;
}

export interface AgentActionOutcome {
  /** Respuesta para el modelo de IA. */
  respuesta: Record<string, unknown>;
  /** Tarjeta para el chat (si hubo un cambio visible). */
  card?: { texto: string };
}

/** Geometría normalizada que se muestra antes de cambiar el plano. */
export interface AgentProposal {
  texto: string;
  items: AgentPreviewItem[];
}

export interface AgentMovePreparation {
  texto: string;
  proposal: AgentMoveProposal;
}

const MAX_LEN = 50; // m
const MAX_COORD = 200; // m desde el centro
const BIG_CHANGE = 10; // piezas: pedir confirmación
const KIND_ES: Record<string, string> = {
  wall: 'muros',
  door: 'puertas',
  window: 'ventanas',
  floor: 'pisos',
  roof: 'techos',
};

function num(v: unknown, name: string): number {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`"${name}" debe ser un número`);
  if (Math.abs(n) > MAX_COORD) throw new Error(`"${name}" está fuera del área de trabajo (±${MAX_COORD} m)`);
  return n;
}

function optNum(v: unknown, min: number, max: number): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
}

function segment(args: Record<string, unknown>) {
  const p = { x1: num(args.x1, 'x1'), z1: num(args.z1, 'z1'), x2: num(args.x2, 'x2'), z2: num(args.z2, 'z2') };
  const len = Math.hypot(p.x2 - p.x1, p.z2 - p.z1);
  if (len < 0.3) throw new Error('El largo debe ser al menos 0.3 m');
  if (len > MAX_LEN) throw new Error(`El largo máximo es ${MAX_LEN} m`);
  return { ...p, len };
}

function f2(n: number) {
  return n.toFixed(2);
}

/** Valida una acción de dibujo y devuelve una propuesta sin modificar el modelo. */
export function prepareAgentAction(action: AgentAction): AgentProposal | null {
  const a = action.args ?? {};
  switch (action.nombre) {
    case 'dibujar_muro':
    case 'agregar_puerta':
    case 'agregar_ventana': {
      const s = segment(a);
      const type = action.nombre === 'dibujar_muro' ? 'wall' : action.nombre === 'agregar_puerta' ? 'door' : 'window';
      const texto = `${type === 'wall' ? 'Muro' : type === 'door' ? 'Puerta' : 'Ventana'} de ${f2(s.len)} m`;
      return {
        texto,
        items: [{ kind: 'segment', type, x1: s.x1, z1: s.z1, x2: s.x2, z2: s.z2,
          ...(type === 'wall' ? { thickness: optNum(a.espesor, 0.05, 1.5), height: optNum(a.alto, 0.3, 12) } : {}) }],
      };
    }
    case 'dibujar_ambiente': {
      const x = num(a.x, 'x');
      const z = num(a.z, 'z');
      const w = optNum(a.ancho, 0.5, MAX_LEN) ?? 3;
      const d = optNum(a.largo, 0.5, MAX_LEN) ?? 4;
      const x2 = num(x + w, 'x + ancho');
      const z2 = num(z + d, 'z + largo');
      const items: AgentPreviewItem[] = [
        { kind: 'segment', type: 'wall', x1: x, z1: z, x2, z2: z, thickness: 0.15 },
        { kind: 'segment', type: 'wall', x1: x2, z1: z, x2, z2, thickness: 0.15 },
        { kind: 'segment', type: 'wall', x1: x2, z1: z2, x2: x, z2, thickness: 0.15 },
        { kind: 'segment', type: 'wall', x1: x, z1: z2, x2: x, z2: z, thickness: 0.15 },
      ];
      if (a.con_piso) items.push({ kind: 'slab', type: 'floor', x1: x, z1: z, x2, z2 });
      return { texto: `Ambiente ${f2(w)} × ${f2(d)} m${a.con_piso ? ' con piso' : ''} (${(w * d).toFixed(1)} m²)`, items };
    }
    case 'dibujar_piso':
    case 'dibujar_techo': {
      const x1 = num(a.x1, 'x1');
      const z1 = num(a.z1, 'z1');
      const x2 = num(a.x2, 'x2');
      const z2 = num(a.z2, 'z2');
      const w = Math.abs(x2 - x1);
      const d = Math.abs(z2 - z1);
      if (w < 0.3 || d < 0.3) throw new Error('Cada lado debe medir al menos 0.3 m');
      if (w > MAX_LEN || d > MAX_LEN) throw new Error(`Cada lado debe medir como máximo ${MAX_LEN} m`);
      const type = action.nombre === 'dibujar_piso' ? 'floor' : 'roof';
      const kind: RoofDrawKind = a.tipo === 'dos_aguas' ? 'dos_aguas' : 'plano';
      return {
        texto: type === 'floor' ? `Piso ${f2(w)} × ${f2(d)} m` : `Techo ${kind === 'dos_aguas' ? 'a dos aguas' : 'plano'} ${f2(w)} × ${f2(d)} m`,
        items: [{ kind: 'slab', type, x1, z1, x2, z2, ...(type === 'roof' ? { roofKind: kind } : {}) }],
      };
    }
    default:
      return null;
  }
}

/** Valida dirección y distancia; el motor fija la pieza seleccionada y su estado actual. */
export function prepareAgentMoveAction(host: AgentHost, action: AgentAction): AgentMovePreparation {
  if (action.nombre !== 'mover_seleccion') throw new Error('La acción no es un movimiento.');
  const args = action.args ?? {};
  const direction = String(args.direccion ?? '');
  const directions: AgentMoveDirection[] = ['derecha', 'izquierda', 'arriba', 'abajo'];
  if (!directions.includes(direction as AgentMoveDirection)) {
    throw new Error('Indica derecha, izquierda, arriba o abajo en la vista de planta.');
  }
  const rawDistance = args.distancia_m;
  const distanceM = typeof rawDistance === 'number' || typeof rawDistance === 'string' && rawDistance.trim()
    ? Number(rawDistance)
    : Number.NaN;
  if (!Number.isFinite(distanceM) || distanceM < 0.01 || distanceM > MAX_LEN) {
    throw new Error('Indica una distancia entre 0.01 y 50 metros.');
  }
  const proposal = host.engine.prepareAgentMove(direction as AgentMoveDirection, distanceM);
  return { texto: `Mover ${proposal.selected.name} ${distanceM.toFixed(2)} m hacia ${direction}`, proposal };
}

/** Pide las confirmaciones antes de tocar el modelo o abrir el historial. */
export async function confirmAgentAction(host: AgentHost, action: AgentAction, selectionMayChange = false): Promise<boolean> {
  const a = action.args ?? {};
  if (action.nombre === 'eliminar') {
    const scope = String(a.alcance ?? 'seleccion');
    const meshes = host.engine.agentFind(scope);
    const what = meshes.length === 0
      ? 'las piezas que seleccione la IA'
      : scope === 'seleccion' ? `${meshes.length} pieza(s) seleccionada(s)` : `${meshes.length} ${KIND_ES[scope] ?? scope}`;
    return host.confirm(`¿Eliminar ${what}?`);
  }
  if (action.nombre === 'cambiar_material') {
    const scope = String(a.alcance ?? 'seleccion');
    const material = host.engine.agentMaterialByName(String(a.material ?? ''));
    const meshes = host.engine.agentFind(scope);
    if (material && (meshes.length > BIG_CHANGE || (scope === 'seleccion' && selectionMayChange))) {
      const what = selectionMayChange && scope === 'seleccion'
        ? 'las piezas que seleccione la IA'
        : `${meshes.length} piezas`;
      return host.confirm(`¿Cambiar ${what} a "${material.nombre}"?`);
    }
  }
  return true;
}

/**
 * Ejecuta una herramienta del editor pedida por el agente. Nunca lanza: los
 * errores vuelven al modelo para que se corrija.
 */
export async function runAgentAction(host: AgentHost, action: AgentAction): Promise<AgentActionOutcome> {
  const { engine } = host;
  const a = action.args ?? {};
  try {
    switch (action.nombre) {
      case 'mover_seleccion': {
        const prepared = host.moveProposal
          ? { proposal: host.moveProposal, texto: `Mover ${host.moveProposal.selected.name} ${host.moveProposal.distanceM.toFixed(2)} m hacia ${host.moveProposal.direction}` }
          : prepareAgentMoveAction(host, action);
        engine.applyAgentMove(prepared.proposal);
        return {
          respuesta: {
            ok: true,
            pieza: prepared.proposal.selected.name,
            direccion: prepared.proposal.direction,
            distancia_m: prepared.proposal.distanceM,
          },
          card: { texto: prepared.texto },
        };
      }
      case 'dibujar_muro': {
        const proposal = prepareAgentAction(action)!;
        const s = proposal.items[0];
        if (s.kind !== 'segment') throw new Error('Geometría inválida para muro');
        const mesh = engine.agentCreateSegment('wall', s.x1, s.z1, s.x2, s.z2, { thickness: s.thickness, height: s.height });
        if (!mesh) throw new Error('No se pudo crear el muro');
        return { respuesta: { ok: true, creado: mesh.name, largo_m: +f2(Math.hypot(s.x2 - s.x1, s.z2 - s.z1)) }, card: { texto: proposal.texto } };
      }

      case 'dibujar_ambiente': {
        const proposal = prepareAgentAction(action)!;
        const created: THREE.Mesh[] = [];
        try {
          for (const item of proposal.items) {
            const mesh = item.kind === 'segment'
              ? engine.agentCreateSegment('wall', item.x1, item.z1, item.x2, item.z2, { thickness: item.thickness, height: item.height })
              : engine.agentCreateSlab('floor', item.x1, item.z1, item.x2, item.z2);
            if (!mesh) throw new Error('No se pudo crear el ambiente completo');
            created.push(mesh);
          }
        } catch (error) {
          if (created.length > 0) engine.agentRemove(created);
          throw error;
        }
        const first = proposal.items[0];
        const third = proposal.items[2];
        if (first.kind !== 'segment' || third.kind !== 'segment') throw new Error('Geometría inválida para ambiente');
        const area = Math.abs((first.x2 - first.x1) * (third.z1 - first.z1));
        return {
          respuesta: { ok: true, muros: 4, con_piso: Boolean(a.con_piso), area_m2: +area.toFixed(2) },
          card: { texto: proposal.texto },
        };
      }

      case 'agregar_puerta':
      case 'agregar_ventana': {
        const proposal = prepareAgentAction(action)!;
        const type = action.nombre === 'agregar_puerta' ? 'door' : 'window';
        const s = proposal.items[0];
        if (s.kind !== 'segment') throw new Error('Geometría inválida para abertura');
        const mesh = engine.agentCreateSegment(type, s.x1, s.z1, s.x2, s.z2);
        if (!mesh) throw new Error('No se pudo crear la pieza');
        return { respuesta: { ok: true, creado: mesh.name, ancho_m: +f2(Math.hypot(s.x2 - s.x1, s.z2 - s.z1)) }, card: { texto: proposal.texto } };
      }

      case 'dibujar_piso':
      case 'dibujar_techo': {
        const proposal = prepareAgentAction(action)!;
        const type = action.nombre === 'dibujar_piso' ? 'floor' : 'roof';
        const slab = proposal.items[0];
        if (slab.kind !== 'slab') throw new Error('Geometría inválida para losa');
        const w = Math.abs(slab.x2 - slab.x1);
        const d = Math.abs(slab.z2 - slab.z1);
        const kind: RoofDrawKind = a.tipo === 'dos_aguas' ? 'dos_aguas' : 'plano';
        const mesh = engine.agentCreateSlab(type, slab.x1, slab.z1, slab.x2, slab.z2, kind);
        if (!mesh) throw new Error('No se pudo crear la losa');
        return { respuesta: { ok: true, creado: mesh.name, area_m2: +(w * d).toFixed(2) }, card: { texto: proposal.texto } };
      }

      case 'cambiar_material': {
        const scope = String(a.alcance ?? 'seleccion');
        const material = engine.agentMaterialByName(String(a.material ?? ''));
        if (!material) {
          return {
            respuesta: {
              ok: false,
              error: `El material "${String(a.material)}" no está en el catálogo.`,
              disponibles: engine.getAgentContext().materiales_catalogo,
            },
          };
        }
        const meshes = engine.agentFind(scope);
        if (meshes.length === 0) {
          return { respuesta: { ok: false, error: scope === 'seleccion' ? 'No hay piezas seleccionadas.' : `No hay ${KIND_ES[scope] ?? scope}.` } };
        }
        if (meshes.length > BIG_CHANGE && !host.preapproved) {
          const ok = await host.confirm(`¿Cambiar ${meshes.length} piezas a "${material.nombre}"?`);
          if (!ok) return { respuesta: { ok: false, cancelado_por_usuario: true } };
        }
        engine.agentSetMaterial(meshes, material.id);
        const texto = `${meshes.length} ${scope === 'seleccion' ? 'piezas' : KIND_ES[scope] ?? scope} → ${material.nombre}`;
        return {
          respuesta: { ok: true, piezas: meshes.length, material: material.nombre, nota: 'Activa Texturas para verlo en 3D.' },
          card: { texto },
        };
      }

      case 'seleccionar': {
        const scope = a.categoria ? String(a.categoria) : undefined;
        const meshes = engine.agentFind(scope, a.nombre ? String(a.nombre) : undefined);
        engine.agentSelect(meshes);
        return { respuesta: { ok: true, seleccionadas: meshes.length, nombres: meshes.slice(0, 10).map((m) => m.name) } };
      }

      case 'eliminar': {
        const scope = String(a.alcance ?? 'seleccion');
        const meshes = engine.agentFind(scope);
        if (meshes.length === 0) return { respuesta: { ok: false, error: 'No hay piezas para eliminar.' } };
        const what = scope === 'seleccion' ? `${meshes.length} pieza(s) seleccionada(s)` : `${meshes.length} ${KIND_ES[scope] ?? scope}`;
        const ok = host.preapproved || await host.confirm(`¿Eliminar ${what}?`);
        if (!ok) return { respuesta: { ok: false, cancelado_por_usuario: true } };
        engine.agentRemove(meshes);
        return { respuesta: { ok: true, eliminadas: meshes.length }, card: { texto: `Eliminadas ${what}` } };
      }

      case 'mostrar_medidas': {
        const kinds = (Array.isArray(a.categorias) ? a.categorias : [])
          .map(String)
          .filter((k): k is MeasureKind => (MEASURE_KINDS as string[]).includes(k));
        const unit = ['cm', 'm', 'in'].includes(String(a.unidad)) ? (String(a.unidad) as MeasureUnit) : undefined;
        host.setMeasures(kinds, unit);
        return { respuesta: { ok: true, mostrando: kinds, unidad: unit ?? 'actual' } };
      }

      case 'cambiar_vista': {
        const views: ViewName[] = ['planta', 'alzado', 'perfil', 'isometrica', '3d'];
        const view = String(a.vista) as ViewName;
        if (!views.includes(view)) return { respuesta: { ok: false, error: 'Vista inválida' } };
        host.setView(view);
        return { respuesta: { ok: true, vista: view } };
      }

      case 'ajustar_al_muro': {
        const scope = String(a.alcance ?? 'seleccion');
        const meshes = engine.agentFind(scope).filter((m) => {
          const k = m.name.toLowerCase();
          return k.includes('door') || k.includes('window');
        });
        if (meshes.length === 0) return { respuesta: { ok: false, error: 'No hay puertas o ventanas para ajustar.' } };
        const fill = a.rellenar !== false;
        const results = meshes.map((m) => engine.snapOpeningToWall(m, fill));
        const ok = results.filter((r) => r.ok).length;
        const texto = `${ok} de ${meshes.length} ${scope === 'door' ? 'puertas' : scope === 'window' ? 'ventanas' : 'piezas'} ajustadas al muro`;
        return {
          respuesta: { ok: ok > 0, ajustadas: ok, total: meshes.length, detalles: results.map((r) => r.mensaje).slice(0, 10) },
          ...(ok > 0 ? { card: { texto } } : {}),
        };
      }

      case 'deshacer_ultima_accion': {
        const undone = engine.undoAgentTransaction();
        if (!undone) return { respuesta: { ok: false, error: 'No hay una acción del agente reciente para deshacer; puede haber otra edición posterior.' } };
        return { respuesta: { ok: true, deshecho: 'Última acción del agente' }, card: { texto: 'Deshecha la última acción del agente' } };
      }

      default:
        return { respuesta: { ok: false, error: `Acción desconocida: ${action.nombre}` } };
    }
  } catch (err) {
    return { respuesta: { ok: false, error: err instanceof Error ? err.message : String(err) } };
  }
}
