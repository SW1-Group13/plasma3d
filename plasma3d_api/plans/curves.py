# plans/curves.py
"""
Muros diagonales y curvos sacados de la tinta (sin depender de Gemini).

Los detectores de muros solo arman tramos horizontales/verticales. Lo que
queda de tinta después de quitarlos puede ser:
  - una ochava o pared en ángulo, una bahía o pared curva   -> muro
  - arcos de puerta, muebles, textos, cotas                 -> no

Un trazo sobrante se acepta como muro si:
  1. tiene el grosor de una pared (los arcos de puerta y contornos de
     muebles son mucho más finos), y
  2. sus dos puntas llegan a paredes ya detectadas (una ochava o una curva
     une dos paredes; un mueble está suelto).

El trazo se reduce a su esqueleto y se simplifica en una línea quebrada;
cada tramo es un muro con 'line' (eje en px) que three.py arma girado.
"""
import numpy as np
from scipy import ndimage


def _walk(skel):
    """Recorre un esqueleto sin ramas desde una punta: lista de (y, x)."""
    pts = set(map(tuple, np.argwhere(skel)))
    if not pts:
        return []

    def nbrs(p):
        y, x = p
        return [(y + dy, x + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1)
                if (dy or dx) and (y + dy, x + dx) in pts]

    ends = [p for p in pts if len(nbrs(p)) == 1]
    start = ends[0] if ends else next(iter(pts))
    path, seen, cur = [start], {start}, start
    while True:
        nxt = [q for q in nbrs(cur) if q not in seen]
        if not nxt:
            break
        # preferir el vecino que sigue la dirección (evita saltos en ramas)
        cur = nxt[0]
        seen.add(cur)
        path.append(cur)
    return path


def residual_walls(ink, wall_boxes, thickness_px, S):
    """
    Args:
        ink: máscara booleana de tinta (paredes incluidas).
        wall_boxes: [{x1,y1,x2,y2}] muros rectos ya detectados (px).
        thickness_px: espesor típico de pared (px).
        S: lado mayor de la imagen.

    Returns:
        [{x1,y1,x2,y2,line:[ax,ay,bx,by],thickness}] tramos diagonales/curvos.
    """
    from skimage.measure import approximate_polygon
    from skimage.morphology import skeletonize

    if not wall_boxes:
        return []
    t = float(thickness_px or max(6, int(0.010 * S)))
    H, W = ink.shape
    covered = np.zeros_like(ink)
    grow = int(t * 0.8) + 2
    for b in wall_boxes:
        covered[max(0, int(b['y1']) - grow):min(H, int(b['y2']) + grow),
                max(0, int(b['x1']) - grow):min(W, int(b['x2']) + grow)] = True
    rest = ink & ~covered
    # el grosor de pared: un arco de puerta o un mueble (1-3 px) desaparece
    k = max(2, int(t * 0.5))
    rest = ndimage.binary_opening(rest, structure=np.ones((k, k), dtype=bool))
    labels, n = ndimage.label(rest, structure=np.ones((3, 3), dtype=bool))
    if n == 0:
        return []

    pad = t * 1.5 + grow

    def touches_wall(y, x):
        return any(b['x1'] - pad <= x <= b['x2'] + pad and b['y1'] - pad <= y <= b['y2'] + pad
                   for b in wall_boxes)

    out = []
    for i, sl in enumerate(ndimage.find_objects(labels), start=1):
        if sl is None:
            continue
        ys, xs = sl
        if max(ys.stop - ys.start, xs.stop - xs.start) < 0.04 * S:
            continue
        comp = labels[sl] == i
        skel = skeletonize(comp)
        path = _walk(skel)
        if len(path) < 0.04 * S:
            continue
        pts = np.array([(y + ys.start, x + xs.start) for y, x in path], dtype=float)
        (ya, xa), (yb, xb) = pts[0], pts[-1]
        # Contorno cerrado (ducha, mesa, mueble): sus "puntas" quedan juntas.
        # Una pared diagonal o curva va de una pared a otra: puntas lejos.
        span_ = max(ys.stop - ys.start, xs.stop - xs.start)
        if np.hypot(xb - xa, yb - ya) < 0.5 * span_:
            continue
        if not (touches_wall(ya, xa) and touches_wall(yb, xb)):
            continue  # suelto: mueble, texto, flecha
        poly = approximate_polygon(pts, tolerance=max(2.0, t * 0.35))
        if len(poly) < 2:
            continue
        # las puntas se cortaron al quitar los muros: estirarlas hasta ellos
        ext = grow + t / 2.0
        for a, b in ((0, 1), (-1, -2)):
            d = poly[a] - poly[b]
            nrm = float(np.hypot(*d))
            if nrm > 0:
                poly[a] = poly[a] + d / nrm * ext
        for (y1, x1), (y2, x2) in zip(poly[:-1], poly[1:]):
            if np.hypot(x2 - x1, y2 - y1) < 2:
                continue
            h = t / 2.0
            out.append({'x1': int(min(x1, x2) - h), 'y1': int(min(y1, y2) - h),
                        'x2': int(max(x1, x2) + h), 'y2': int(max(y1, y2) + h),
                        'line': [float(x1), float(y1), float(x2), float(y2)], 'thickness': t})
    return out
