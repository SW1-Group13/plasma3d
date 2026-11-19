import { useCallback, useEffect, useRef, useState } from 'react';
import type { DetectionBox, DetectionClass } from '@/entities/model3D/types';
import {
  center,
  clampBox,
  inside,
  moveBox,
  newId,
  normBox,
  openingOnWall,
  wallFromDrag,
  type Pt,
  type ReviewItem,
} from '../geometry';
import { useReviewStore } from '../store';
import { CLASS_COLOR, DOUBT_SCORE } from '../geometry';

type Corner = 'nw' | 'ne' | 'sw' | 'se';

type Drag =
  | { kind: 'pan'; start: Pt; vb: ViewBox; client: Pt }
  | { kind: 'move'; start: Pt; base: ReviewItem[]; ids: string[] }
  | { kind: 'resize'; id: string; corner: Corner; base: ReviewItem[] }
  | { kind: 'rect'; start: Pt; cur: Pt; purpose: 'marquee' | 'erase' | 'door' | 'window' | 'wall'; add: boolean };

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  imageUrl: string;
  width: number;
  height: number;
  thickness: number;
  overlayOpacity: number;
  hidden: Record<DetectionClass, boolean>;
  showOverlay: boolean;
}

export function PlanReviewCanvas({ imageUrl, width, height, thickness, overlayOpacity, hidden, showOverlay }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const items = useReviewStore((s) => s.items);
  const selected = useReviewStore((s) => s.selected);
  const tool = useReviewStore((s) => s.tool);
  const { commit, preview, select } = useReviewStore.getState();

  const [vb, setVb] = useState<ViewBox>({ x: 0, y: 0, w: width, h: height });
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const spaceRef = useRef(false);

  useEffect(() => setVb({ x: 0, y: 0, w: width, h: height }), [width, height]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const toImage = useCallback((clientX: number, clientY: number): Pt => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }, []);

  /** Unidades de imagen por píxel de pantalla (para tamaños de asas). */
  const pxUnit = () => {
    const w = svgRef.current?.clientWidth || 1;
    const h = svgRef.current?.clientHeight || 1;
    return Math.max(vb.w / w, vb.h / h);
  };

  // Zoom con la rueda, centrado en el cursor (listener no pasivo).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toImage(e.clientX, e.clientY);
      const f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      setVb((v) => {
        const w = Math.min(width * 4, Math.max(width / 40, v.w * f));
        const k = w / v.w;
        return { x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k, w, h: v.h * k };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [toImage, width]);

  const setD = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    const target = e.target as Element;
    svgRef.current?.setPointerCapture(e.pointerId);
    const p = toImage(e.clientX, e.clientY);

    if (e.button === 1 || e.button === 2 || spaceRef.current) {
      setD({ kind: 'pan', start: p, vb, client: { x: e.clientX, y: e.clientY } });
      return;
    }
    if (e.button !== 0) return;

    const handle = target.getAttribute('data-handle') as Corner | null;
    const itemId = target.getAttribute('data-item');

    if (tool === 'select') {
      if (handle && selected.length === 1) {
        setD({ kind: 'resize', id: selected[0], corner: handle, base: items });
        return;
      }
      if (itemId) {
        let ids = selected;
        if (e.shiftKey) ids = selected.includes(itemId) ? selected.filter((i) => i !== itemId) : [...selected, itemId];
        else if (!selected.includes(itemId)) ids = [itemId];
        select(ids);
        if (ids.includes(itemId)) setD({ kind: 'move', start: p, base: items, ids });
        return;
      }
      if (!e.shiftKey) select([]);
      setD({ kind: 'rect', start: p, cur: p, purpose: 'marquee', add: e.shiftKey });
      return;
    }
    if (tool === 'erase' && itemId) {
      commit(items.filter((i) => i.id !== itemId));
      return;
    }
    setD({ kind: 'rect', start: p, cur: p, purpose: tool, add: false });
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === 'pan') {
      const svg = svgRef.current!;
      const k = Math.max(d.vb.w / svg.clientWidth, d.vb.h / svg.clientHeight);
      setVb({ ...d.vb, x: d.vb.x - (e.clientX - d.client.x) * k, y: d.vb.y - (e.clientY - d.client.y) * k });
      return;
    }
    const p = toImage(e.clientX, e.clientY);
    if (d.kind === 'move') {
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      preview(d.base.map((it) => (d.ids.includes(it.id) ? { ...it, box: moveBox(it.box, dx, dy) } : it)));
      return;
    }
    if (d.kind === 'resize') {
      preview(
        d.base.map((it) => {
          if (it.id !== d.id) return it;
          const b = { ...it.box };
          if (d.corner.includes('n')) b.y1 = p.y;
          if (d.corner.includes('s')) b.y2 = p.y;
          if (d.corner.includes('w')) b.x1 = p.x;
          if (d.corner.includes('e')) b.x2 = p.x;
          return { ...it, box: b };
        }),
      );
      return;
    }
    setD({ ...d, cur: p });
  }

  function onPointerUp() {
    const d = dragRef.current;
    setD(null);
    if (!d || d.kind === 'pan') return;
    const cur = useReviewStore.getState().items;
    if (d.kind === 'move' || d.kind === 'resize') {
      if (cur === d.base) return;
      const ids = d.kind === 'move' ? d.ids : [d.id];
      const fixed = cur.map((it) =>
        ids.includes(it.id) ? { ...it, box: clampBox(it.box.line ? it.box : normBox(it.box), width, height) } : it,
      );
      // Historial: registra el estado de antes del arrastre.
      preview(d.base);
      commit(fixed);
      return;
    }
    const r = normBox({ x1: d.start.x, y1: d.start.y, x2: d.cur.x, y2: d.cur.y });
    const tiny = r.x2 - r.x1 < 3 && r.y2 - r.y1 < 3;

    if (d.purpose === 'marquee') {
      if (tiny) return;
      const hit = cur.filter((it) => inside(center(it.box), r)).map((it) => it.id);
      const prev = useReviewStore.getState().selected;
      select(d.add ? Array.from(new Set([...prev, ...hit])) : hit);
      return;
    }
    if (d.purpose === 'erase') {
      if (tiny) return;
      const left = cur.filter((it) => !inside(center(it.box), r));
      if (left.length !== cur.length) commit(left);
      return;
    }
    let box: DetectionBox | null;
    if (d.purpose === 'wall') {
      box = wallFromDrag(d.start, d.cur, thickness, cur);
    } else {
      if (tiny) return;
      box = openingOnWall(r, cur);
      if (box.x2 - box.x1 < 2 || box.y2 - box.y1 < 2) box = null;
    }
    if (!box) return;
    const item: ReviewItem = { id: newId(), cls: d.purpose, box: clampBox(box, width, height), score: 1 };
    commit([...cur, item]);
    select([item.id]);
  }

  const u = pxUnit();
  const visible = showOverlay ? items.filter((it) => !hidden[it.cls]) : [];
  const single = selected.length === 1 ? items.find((i) => i.id === selected[0]) : undefined;
  const rect = drag?.kind === 'rect' ? normBox({ x1: drag.start.x, y1: drag.start.y, x2: drag.cur.x, y2: drag.cur.y }) : null;
  const wallPreview =
    drag?.kind === 'rect' && drag.purpose === 'wall' ? wallFromDrag(drag.start, drag.cur, thickness, items) : null;

  const cursor =
    drag?.kind === 'pan' ? 'grabbing' : tool === 'select' ? 'default' : tool === 'erase' ? 'not-allowed' : 'crosshair';

  return (
    <svg
      ref={svgRef}
      className="h-full w-full touch-none select-none bg-neutral-200"
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <image href={imageUrl} x={0} y={0} width={width} height={height} />

      <g opacity={overlayOpacity}>
        {visible.map((it) => {
          const color = CLASS_COLOR[it.cls];
          const isSel = selected.includes(it.id);
          const doubt = it.score < DOUBT_SCORE;
          const common = {
            'data-item': it.id,
            stroke: isSel ? '#facc15' : doubt ? '#f59e0b' : color,
            strokeWidth: isSel ? 3 : 2,
            strokeDasharray: doubt && !isSel ? '6 4' : undefined,
            vectorEffect: 'non-scaling-stroke' as const,
            style: { cursor: tool === 'select' ? 'move' : undefined },
          };
          if (it.box.line) {
            const [ax, ay, bx, by] = it.box.line;
            return (
              <line
                key={it.id}
                {...common}
                x1={ax}
                y1={ay}
                x2={bx}
                y2={by}
                stroke={isSel ? '#facc15' : color}
                strokeOpacity={0.55}
                strokeWidth={it.box.thickness ?? thickness}
                vectorEffect={undefined}
                strokeLinecap="square"
              />
            );
          }
          return (
            <rect
              key={it.id}
              {...common}
              x={it.box.x1}
              y={it.box.y1}
              width={Math.max(0.5, it.box.x2 - it.box.x1)}
              height={Math.max(0.5, it.box.y2 - it.box.y1)}
              fill={color}
              fillOpacity={0.35}
            />
          );
        })}
      </g>

      {single && !single.box.line && tool === 'select' &&
        (['nw', 'ne', 'sw', 'se'] as Corner[]).map((c) => {
          const s = 9 * u;
          const x = c.includes('w') ? single.box.x1 : single.box.x2;
          const y = c.includes('n') ? single.box.y1 : single.box.y2;
          return (
            <rect
              key={c}
              data-handle={c}
              x={x - s / 2}
              y={y - s / 2}
              width={s}
              height={s}
              fill="#fff"
              stroke="#111"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              style={{ cursor: c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize' }}
            />
          );
        })}

      {wallPreview && (
        <rect
          x={wallPreview.x1}
          y={wallPreview.y1}
          width={wallPreview.x2 - wallPreview.x1}
          height={wallPreview.y2 - wallPreview.y1}
          fill={CLASS_COLOR.wall}
          fillOpacity={0.4}
          pointerEvents="none"
        />
      )}
      {rect && drag?.kind === 'rect' && drag.purpose !== 'wall' && (
        <rect
          x={rect.x1}
          y={rect.y1}
          width={rect.x2 - rect.x1}
          height={rect.y2 - rect.y1}
          fill={drag.purpose === 'erase' ? '#ef4444' : drag.purpose === 'marquee' ? '#facc15' : CLASS_COLOR[drag.purpose]}
          fillOpacity={0.15}
          stroke={drag.purpose === 'erase' ? '#ef4444' : '#111'}
          strokeDasharray="5 4"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}
    </svg>
  );
}
