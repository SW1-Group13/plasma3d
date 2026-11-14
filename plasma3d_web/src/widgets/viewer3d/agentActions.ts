import type * as THREE from 'three';
import type { AgentAction } from '@/entities/agent/api';
import type { EditorEngine, RoofDrawKind, ViewName } from '@/widgets/viewer3d/engine';
import { MEASURE_KINDS, type MeasureKind, type MeasureUnit } from '@/widgets/viewer3d/measurements';

/** Lo que el chat necesita para ejecutar acciones fuera del motor. */
export interface AgentHost {
  engine: EditorEngine;
  setView: (view: ViewName) => void;
  setMeasures: (kinds: MeasureKind[], unit?: MeasureUnit) => void;
  /** Pide confirmación al usuario en el chat (borrar, cambios masivos). */
  confirm: (texto: string) => Promise<boolean>;
}

export interface AgentActionOutcome {
  /** Respuesta para el modelo de IA. */
  respuesta: Record<string, unknown>;
  /** Tarjeta para el chat (si hubo un cambio visible). */
  card?: { texto: string; undo?: () => void };
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

/** Pila de deshacer del agente (lo último primero). */
const undoStack: Array<{ texto: string; undo: () => void }> = [];

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

function rememberCreation(host: AgentHost, meshes: THREE.Mesh[], texto: string) {
  const undo = () => {
    host.engine.agentRemove(meshes.filter((m) => host.engine.agentHas(m)));
    const i = undoStack.findIndex((u) => u.undo === undo);
    if (i >= 0) undoStack.splice(i, 1);
  };
  undoStack.push({ texto, undo });
  return { texto, undo };
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
      case 'dibujar_muro': {
        const s = segment(a);
        const mesh = engine.agentCreateSegment('wall', s.x1, s.z1, s.x2, s.z2, {
          thickness: optNum(a.espesor, 0.05, 1.5),
          height: optNum(a.alto, 0.3, 12),
        });
        if (!mesh) throw new Error('No se pudo crear el muro');
        engine.agentCommit([mesh]);
        const texto = `Muro de ${f2(s.len)} m`;
        return { respuesta: { ok: true, creado: mesh.name, largo_m: +f2(s.len) }, card: rememberCreation(host, [mesh], texto) };
      }

      case 'dibujar_ambiente': {
        const x = num(a.x, 'x');
        const z = num(a.z, 'z');
        const w = optNum(a.ancho, 0.5, MAX_LEN) ?? 3;
        const d = optNum(a.largo, 0.5, MAX_LEN) ?? 4;
        const corners: Array<[number, number, number, number]> = [
          [x, z, x + w, z],
          [x + w, z, x + w, z + d],
          [x + w, z + d, x, z + d],
          [x, z + d, x, z],
        ];
        const created: THREE.Mesh[] = [];
        corners.forEach(([x1, z1, x2, z2]) => {
          const m = engine.agentCreateSegment('wall', x1, z1, x2, z2, { thickness: 0.15 });
          if (m) created.push(m);
        });
        if (a.con_piso) {
          const floor = engine.agentCreateSlab('floor', x, z, x + w, z + d);
          if (floor) created.push(floor);
        }
        if (created.length === 0) throw new Error('No se pudo crear el ambiente');
        engine.agentCommit(created);
        const texto = `Ambiente ${f2(w)} × ${f2(d)} m${a.con_piso ? ' con piso' : ''} (${(w * d).toFixed(1)} m²)`;
        return {
          respuesta: { ok: true, muros: 4, con_piso: Boolean(a.con_piso), area_m2: +(w * d).toFixed(2) },
          card: rememberCreation(host, created, texto),
        };
      }

      case 'agregar_puerta':
      case 'agregar_ventana': {
        const type = action.nombre === 'agregar_puerta' ? 'door' : 'window';
        const s = segment(a);
        const mesh = engine.agentCreateSegment(type, s.x1, s.z1, s.x2, s.z2);
        if (!mesh) throw new Error('No se pudo crear la pieza');
        engine.agentCommit([mesh]);
        const texto = `${type === 'door' ? 'Puerta' : 'Ventana'} de ${f2(s.len)} m`;
        return { respuesta: { ok: true, creado: mesh.name, ancho_m: +f2(s.len) }, card: rememberCreation(host, [mesh], texto) };
      }

      case 'dibujar_piso':
      case 'dibujar_techo': {
        const type = action.nombre === 'dibujar_piso' ? 'floor' : 'roof';
        const x1 = num(a.x1, 'x1');
        const z1 = num(a.z1, 'z1');
        const x2 = num(a.x2, 'x2');
        const z2 = num(a.z2, 'z2');
        const w = Math.abs(x2 - x1);
        const d = Math.abs(z2 - z1);
        if (w < 0.3 || d < 0.3) throw new Error('Cada lado debe medir al menos 0.3 m');
        const kind: RoofDrawKind = a.tipo === 'dos_aguas' ? 'dos_aguas' : 'plano';
        const mesh = engine.agentCreateSlab(type, x1, z1, x2, z2, kind);
        if (!mesh) throw new Error('No se pudo crear la losa');
        engine.agentCommit([mesh]);
        const texto =
          type === 'floor'
            ? `Piso ${f2(w)} × ${f2(d)} m`
            : `Techo ${kind === 'dos_aguas' ? 'a dos aguas' : 'plano'} ${f2(w)} × ${f2(d)} m`;
        return { respuesta: { ok: true, creado: mesh.name, area_m2: +(w * d).toFixed(2) }, card: rememberCreation(host, [mesh], texto) };
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
        if (meshes.length > BIG_CHANGE) {
          const ok = await host.confirm(`¿Cambiar ${meshes.length} piezas a "${material.nombre}"?`);
          if (!ok) return { respuesta: { ok: false, cancelado_por_usuario: true } };
        }
        const previous = engine.agentSetMaterial(meshes, material.id);
        const texto = `${meshes.length} ${scope === 'seleccion' ? 'piezas' : KIND_ES[scope] ?? scope} → ${material.nombre}`;
        const undo = () => {
          engine.agentRestoreMaterials(previous);
          const i = undoStack.findIndex((u) => u.undo === undo);
          if (i >= 0) undoStack.splice(i, 1);
        };
        undoStack.push({ texto, undo });
        return {
          respuesta: { ok: true, piezas: meshes.length, material: material.nombre, nota: 'Activa Texturas para verlo en 3D.' },
          card: { texto, undo },
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
        const ok = await host.confirm(`¿Eliminar ${what}? No se puede deshacer.`);
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
        // Guardar medidas y ubicación para poder deshacer
        const before = meshes.map((m) => ({
          m,
          geometry: m.geometry.clone(),
          position: m.position.clone(),
          rotation: m.rotation.clone(),
          scale: m.scale.clone(),
          opening: m.userData.opening,
        }));
        const fill = a.rellenar !== false;
        const results = meshes.map((m) => engine.snapOpeningToWall(m, fill));
        const ok = results.filter((r) => r.ok).length;
        engine.agentCommit([]);
        const texto = `${ok} de ${meshes.length} ${scope === 'door' ? 'puertas' : scope === 'window' ? 'ventanas' : 'piezas'} ajustadas al muro`;
        const undo = () => {
          before.forEach((b) => {
            if (!engine.agentHas(b.m)) return;
            b.m.geometry.dispose();
            b.m.geometry = b.geometry;
            b.m.position.copy(b.position);
            b.m.rotation.copy(b.rotation);
            b.m.scale.copy(b.scale);
            b.m.userData.opening = b.opening;
          });
          engine.agentCommit([]);
          const i = undoStack.findIndex((u) => u.undo === undo);
          if (i >= 0) undoStack.splice(i, 1);
        };
        undoStack.push({ texto, undo });
        return {
          respuesta: { ok: ok > 0, ajustadas: ok, total: meshes.length, detalles: results.map((r) => r.mensaje).slice(0, 10) },
          card: { texto, undo },
        };
      }

      case 'deshacer_ultima_accion': {
        const last = undoStack.pop();
        if (!last) return { respuesta: { ok: false, error: 'No hay acciones del agente para deshacer.' } };
        last.undo();
        return { respuesta: { ok: true, deshecho: last.texto }, card: { texto: `Deshecho: ${last.texto}` } };
      }

      default:
        return { respuesta: { ok: false, error: `Acción desconocida: ${action.nombre}` } };
    }
  } catch (err) {
    return { respuesta: { ok: false, error: err instanceof Error ? err.message : String(err) } };
  }
}
