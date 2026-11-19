import { useEffect, useMemo, useState } from 'react';
import type { FloorPlan2D, FloorPlanItem } from '@/widgets/viewer3d/engine';
import { PlanPanelFrame } from '@/widgets/viewer3d/PlanPanelFrame';

interface Props {
  /** Lee la planta actual del motor 3D. */
  getPlan: () => FloorPlan2D | null;
  onClose: () => void;
  className?: string;
}

const REFRESH_MS = 300;

const COLOR = {
  plano: '#374151',
  manual: '#16a34a',
  ia: '#8b5cf6',
  window: '#2563eb',
};

type P = [number, number];
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
const mul = (a: P, k: number): P => [a[0] * k, a[1] * k];
const len = (a: P) => Math.hypot(a[0], a[1]);
const pts = (poly: P[]) => poly.map((p) => `${p[0]},${p[1]}`).join(' ');

/** Ejes de la huella: u = largo, s = grosor (vectores desde la esquina p0). */
function axes(poly: P[]) {
  const e1 = sub(poly[1], poly[0]);
  const e3 = sub(poly[3], poly[0]);
  return len(e1) >= len(e3) ? { u: e1, s: e3 } : { u: e3, s: e1 };
}

function tint(it: FloorPlanItem) {
  return it.source === 'plano' ? null : COLOR[it.source];
}

function Door({ it }: { it: FloorPlanItem }) {
  const { u, s } = axes(it.poly as P[]);
  const L = len(u);
  const sl = len(s) || 1;
  const n = mul(s, 1 / sl);
  const hinge = add(it.poly[0] as P, s); // cara del muro donde abre
  const jamb = add(hinge, u);
  const leaf = add(hinge, mul(n, L));
  const uh = mul(u, 1 / (L || 1));
  const sweep = uh[0] * n[1] - uh[1] * n[0] > 0 ? 1 : 0;
  const color = tint(it) ?? '#111827';
  return (
    <g>
      <polygon points={pts(it.poly as P[])} fill="#fff" stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <line x1={hinge[0]} y1={hinge[1]} x2={leaf[0]} y2={leaf[1]} stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <path
        d={`M ${jamb[0]} ${jamb[1]} A ${L} ${L} 0 0 ${sweep} ${leaf[0]} ${leaf[1]}`}
        fill="none"
        stroke={color}
        strokeWidth={1}
        strokeDasharray="4 3"
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

function Window({ it }: { it: FloorPlanItem }) {
  const { u, s } = axes(it.poly as P[]);
  const a = add(it.poly[0] as P, mul(s, 0.5));
  const b = add(a, u);
  const color = tint(it) ?? COLOR.window;
  return (
    <g>
      <polygon points={pts(it.poly as P[])} fill="#fff" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </g>
  );
}

/** Plano 2D generado desde el modelo 3D actual (se actualiza solo). */
export function WorkedPlanPanel({ getPlan, onClose, className }: Props) {
  const [plan, setPlan] = useState<FloorPlan2D | null>(() => getPlan());

  // Releer la planta periódicamente: captura dibujos, arrastres, agente y deshacer.
  useEffect(() => {
    let last = '';
    const tick = () => {
      const next = getPlan();
      const key = next ? JSON.stringify(next.items) : '';
      if (key !== last) {
        last = key;
        setPlan(next);
      }
    };
    tick();
    const id = window.setInterval(tick, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [getPlan]);

  const stats = useMemo(() => {
    const c = { muros: 0, puertas: 0, ventanas: 0, nuevos: { wall: 0, door: 0, window: 0 }, ia: 0 };
    for (const it of plan?.items ?? []) {
      if (it.kind === 'wall') c.muros++;
      else if (it.kind === 'door') c.puertas++;
      else c.ventanas++;
      if (it.source !== 'plano') c.nuevos[it.kind]++;
      if (it.source === 'ia') c.ia++;
    }
    return c;
  }, [plan]);

  const items = plan?.items ?? [];
  const b = plan?.bounds ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const pad = Math.max(0.5, Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.05);
  const viewBox = `${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`;
  const nuevos = stats.nuevos.wall + stats.nuevos.door + stats.nuevos.window;

  return (
    <PlanPanelFrame
      title="Plano trabajado"
      onClose={onClose}
      className={className}
      overlay={
        <div className="pointer-events-none absolute bottom-2 left-2 flex flex-col gap-1 rounded-md bg-white/90 px-2 py-1.5 text-[11px] text-neutral-700 shadow">
          <span className="flex items-center gap-1.5">
            <i className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR.plano }} /> Original
            <i className="ml-2 h-2.5 w-2.5 rounded-sm" style={{ background: COLOR.manual }} /> Nuevo (manual)
            <i className="ml-2 h-2.5 w-2.5 rounded-sm" style={{ background: COLOR.ia }} /> Nuevo (IA)
          </span>
          <span>
            {stats.muros} muros · {stats.puertas} puertas · {stats.ventanas} ventanas
            {nuevos > 0 && (
              <strong className="ml-1 text-green-700">
                (+{stats.nuevos.wall} muros, +{stats.nuevos.door} puertas, +{stats.nuevos.window} ventanas)
              </strong>
            )}
          </span>
          {!items.length && <span>Todavía no hay muros, puertas ni ventanas en el modelo.</span>}
        </div>
      }
    >
      <svg className="h-full w-full" viewBox={viewBox} preserveAspectRatio="xMidYMid meet">
        {items
          .filter((it) => it.kind === 'wall')
          .map((it) => {
            const c = tint(it);
            const label = `Muro ${it.length.toFixed(2)} m${c ? ` · nuevo (${it.source})` : ''}`;
            if (it.footprint) {
              return (
                <path key={it.id} d={it.footprint} fill={c ?? COLOR.plano} stroke={c ?? COLOR.plano} strokeWidth={0.5} vectorEffect="non-scaling-stroke">
                  <title>{label}</title>
                </path>
              );
            }
            return (
              <polygon
                key={it.id}
                points={pts(it.poly as P[])}
                fill={c ?? COLOR.plano}
                stroke={c ? '#14532d' : 'none'}
                strokeWidth={c ? 1 : 0}
                vectorEffect="non-scaling-stroke"
              >
                <title>{label}</title>
              </polygon>
            );
          })}
        {items
          .filter((it) => it.kind === 'window')
          .map((it) => (
            <Window key={it.id} it={it} />
          ))}
        {items
          .filter((it) => it.kind === 'door')
          .map((it) => (
            <Door key={it.id} it={it} />
          ))}
      </svg>
    </PlanPanelFrame>
  );
}
