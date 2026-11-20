# plans/pipeline.py
"""
Une la IA (Mask R-CNN) con el detector clásico de muros (cv_walls) y decide
la escala del plano. Así cualquier estilo de plano (CAD, render a color,
foto de una hoja) genera muros, puertas y ventanas razonables, y si algo no
se pudo detectar queda anotado en un informe de calidad.

Las detecciones originales de la IA se guardan en det['ml'] para poder
volver a combinarlas (Regenerar) sin duplicar nada.
"""
import copy

import numpy as np

from scipy import ndimage

from .cv_walls import (DOOR_REF_M, contrast_mask, detect_walls, find_door_gaps,
                       find_entry_markers, stroke_mask, wall_ink_coverage)

FALLBACK_PX2M = 0.01


def _overlaps(a, b, margin=6):
    return not (
        a['x2'] + margin < b['x1'] or b['x2'] + margin < a['x1']
        or a['y2'] + margin < b['y1'] or b['y2'] + margin < a['y1']
    )


def _boxes_of(det, name):
    pts = det.get('points', [])
    cls = det.get('classes', [])
    return [p for p, c in zip(pts, cls) if (c or {}).get('name') == name]


def _door_size(box):
    return max(abs(box['x2'] - box['x1']), abs(box['y2'] - box['y1']))


def _ink_ratio(ink, x1, y1, x2, y2):
    """Fracción del segmento (px) que pasa sobre trazo dibujado."""
    n = int(max(abs(x2 - x1), abs(y2 - y1))) + 1
    if n < 2:
        return 0.0
    xs = np.clip(np.linspace(x1, x2, n).round().astype(int), 0, ink.shape[1] - 1)
    ys = np.clip(np.linspace(y1, y2, n).round().astype(int), 0, ink.shape[0] - 1)
    return float(ink[ys, xs].mean())


def _inked_span(ink, x1, y1, x2, y2, max_gap):
    """
    Recorta el segmento al tramo continuo más largo que pasa sobre tinta
    (admite cortes de hasta max_gap px: puertas, ventanas). Devuelve None si
    ese tramo tiene menos del 75 % de tinta.
    """
    n = int(max(abs(x2 - x1), abs(y2 - y1))) + 1
    if n < 2:
        return None
    xs = np.clip(np.linspace(x1, x2, n).round().astype(int), 0, ink.shape[1] - 1)
    ys = np.clip(np.linspace(y1, y2, n).round().astype(int), 0, ink.shape[0] - 1)
    on = ink[ys, xs]
    best, start, last_on = None, None, None
    for i in range(n + 1):
        if i < n and on[i]:
            if start is None:
                start = i
            last_on = i
        elif start is not None and (i == n or i - last_on > max_gap):
            if best is None or last_on - start > best[1] - best[0]:
                best = (start, last_on)
            start = None
    if best is None:
        return None
    a, b = best
    if on[a:b + 1].mean() < 0.75:
        return None
    return xs[a], ys[a], xs[b], ys[b]


def _inside_house(segs, wall_boxes, S):
    """Se quedan los tramos cuyo punto medio cae dentro de la casa."""
    if not segs or not wall_boxes:
        return segs
    try:
        from shapely.geometry import Point, Polygon, box as sbox
        from shapely.ops import unary_union
        pad = max(10, int(0.02 * S))
        shape = unary_union([sbox(b['x1'], b['y1'], b['x2'], b['y2']).buffer(pad, join_style=2)
                             for b in wall_boxes if not b.get('line')])
        geoms = list(getattr(shape, 'geoms', [shape]))
        house = unary_union([Polygon(g.exterior) for g in geoms]).buffer(-pad / 2.0)
        out = []
        for s in segs:
            x1, y1, x2, y2 = s['line']
            if house.contains(Point((x1 + x2) / 2.0, (y1 + y2) / 2.0)):
                out.append(s)
        return out
    except Exception:
        return segs


def _house_polygon(boxes, pad):
    """Planta de la casa (px) con los muros dados, huecos rellenos."""
    try:
        from shapely.geometry import Polygon, box as sbox
        from shapely.ops import unary_union
        shape = unary_union([sbox(b['x1'], b['y1'], b['x2'], b['y2']).buffer(pad, join_style=2)
                             for b in boxes if not b.get('line')])
        geoms = list(getattr(shape, 'geoms', [shape]))
        return unary_union([Polygon(g.exterior) for g in geoms]).buffer(-pad, join_style=2)
    except Exception:
        return None


def _near_house(house, x1, y1, x2, y2, tol):
    """¿El segmento está dentro o pegado (<= tol) a la casa conocida?"""
    if house is None or house.is_empty:
        return False  # sin casa conocida no se acepta una línea fina
    from shapely.geometry import LineString
    seg = LineString([(x1, y1), (x2, y2)])
    return seg.length > 0 and seg.intersection(house.buffer(tol)).length >= 0.9 * seg.length


def _house_outline(boxes, pad):
    """Borde exterior de la casa (px): unión de cajas de muro, huecos rellenos."""
    try:
        from shapely.geometry import Polygon, box as sbox
        from shapely.ops import unary_union
        shape = unary_union([sbox(b['x1'], b['y1'], b['x2'], b['y2']).buffer(pad, join_style=2)
                             for b in boxes])
        geoms = list(getattr(shape, 'geoms', [shape]))
        return unary_union([Polygon(g.exterior).buffer(-pad, join_style=2) for g in geoms]).exterior             if len(geoms) == 1 else unary_union([Polygon(g.exterior) for g in geoms]).boundary
    except Exception:
        return None


def _on_outline(outline, x1, y1, x2, y2, tol):
    """¿El segmento corre sobre el borde exterior de la casa?"""
    if outline is None:
        return False
    from shapely.geometry import LineString
    seg = LineString([(x1, y1), (x2, y2)])
    if seg.length == 0:
        return False
    return seg.intersection(outline.buffer(tol)).length >= 0.6 * seg.length


def _stroke_width(mask, x1, y1, x2, y2, thickness_px, samples=12):
    """
    Grosor típico (mediana, en px) del trazo a lo largo de un segmento H/V:
    en cada muestra se mide la corrida de tinta perpendicular al segmento
    (buscando cerca, porque la línea de Gemini puede estar corrida).
    """
    H, W = mask.shape
    horiz = abs(x2 - x1) >= abs(y2 - y1)
    reach = int(max(4, 2 * thickness_px))
    widths = []
    for k in range(samples):
        f = (k + 0.5) / samples
        x = int(round(x1 + (x2 - x1) * f))
        y = int(round(y1 + (y2 - y1) * f))
        if not (0 <= x < W and 0 <= y < H):
            continue
        if horiz:
            line = mask[max(0, y - reach):min(H, y + reach + 1), x]
            center = y - max(0, y - reach)
        else:
            line = mask[y, max(0, x - reach):min(W, x + reach + 1)]
            center = x - max(0, x - reach)
        idx = np.flatnonzero(line)
        if idx.size == 0:
            widths.append(0)
            continue
        # corrida de tinta más cercana al eje
        j = idx[np.argmin(np.abs(idx - center))]
        a = b = j
        while a - 1 >= 0 and line[a - 1]:
            a -= 1
        while b + 1 < line.size and line[b + 1]:
            b += 1
        widths.append(b - a + 1)
    return float(np.median(widths)) if widths else 0.0


def _covered(seg, boxes, tol):
    """¿El segmento ya está cubierto (>=70 %) por cajas de muro existentes?"""
    x1, y1, x2, y2 = seg
    n = int(max(abs(x2 - x1), abs(y2 - y1)) // 3) + 2
    hits = 0
    for t in np.linspace(0.0, 1.0, n):
        px, py = x1 + (x2 - x1) * t, y1 + (y2 - y1) * t
        if any(b['x1'] - tol <= px <= b['x2'] + tol and b['y1'] - tol <= py <= b['y2'] + tol for b in boxes):
            hits += 1
    return hits >= 0.7 * n


def gemini_walls(image, gem_walls, existing, thickness_px):
    """
    Muros que vio Gemini y no los detectores, SOLO si en la imagen hay trazo
    dibujado a lo largo (>= 60 %). Se enderezan a horizontal/vertical.
    """
    if not gem_walls:
        return []
    # Tinta oscura o de cualquier color que contraste con el papel (bocetos
    # con marcador). Tolerancia ~0,8 % de la imagen: Gemini ubica el eje con
    # unos px de error y a mano las líneas no son perfectamente rectas.
    raw = stroke_mask(image, max_gray=205) | contrast_mask(image)
    ink = ndimage.binary_dilation(raw, iterations=max(3, int(0.008 * max(image.size))))
    t = max(4, int(round((thickness_px or 12) * 0.4)))
    tol = max(6, (thickness_px or 12))
    # contorno de la casa (con los muros que ya hay + los de Gemini)
    edge_px = max(10, int(0.025 * max(image.size)))
    # Borde de la casa con TODAS las paredes (las exteriores rayadas a veces
    # solo las ve Gemini), y la casa de los muros ya detectados para que una
    # línea de afuera (terraza, marcas) no cuente como borde.
    gem_boxes = [{'x1': min(w['x1'], w['x2']), 'y1': min(w['y1'], w['y2']),
                  'x2': max(w['x1'], w['x2']) + 1, 'y2': max(w['y1'], w['y2']) + 1} for w in gem_walls]
    outline = _house_outline(existing + gem_boxes, edge_px)
    house_known = _house_polygon(existing, edge_px)
    out = []
    for w in gem_walls:
        x1, y1, x2, y2 = w['x1'], w['y1'], w['x2'], w['y2']
        dx, dy = abs(x2 - x1), abs(y2 - y1)
        if max(dx, dy) < 6 * t:
            continue
        if dy <= 0.15 * dx:
            y1 = y2 = (y1 + y2) / 2.0
        elif dx <= 0.15 * dy:
            x1 = x2 = (x1 + x2) / 2.0
        else:
            continue  # diagonal: lo resuelve diagonal_walls()
        trimmed = _inked_span(ink, x1, y1, x2, y2, max_gap=2 * tol)
        if trimmed is None:
            continue
        x1, y1, x2, y2 = trimmed
        if max(abs(x2 - x1), abs(y2 - y1)) < 6 * t:
            continue
        if _covered((x1, y1, x2, y2), existing + out, tol):
            continue
        # La línea tiene que tener GROSOR DE PARED: el borde de una mesada,
        # un mueble o una cota es una línea fina (Gemini a veces la ve como
        # pared y, como hay tinta, pasaba los controles).
        # Excepción: paredes EXTERIORES dibujadas rayadas (dos líneas finas con
        # rulos) están en el borde de la casa; ahí se aceptan aunque sean finas.
        if thickness_px and _stroke_width(raw, x1, y1, x2, y2, thickness_px) < 0.6 * thickness_px                 and not (_on_outline(outline, x1, y1, x2, y2, edge_px)
                         and _near_house(house_known, x1, y1, x2, y2, edge_px)):
            continue
        h = t / 2.0
        out.append({'x1': int(min(x1, x2) - h), 'y1': int(min(y1, y2) - h),
                    'x2': int(max(x1, x2) + h), 'y2': int(max(y1, y2) + h)})
    return out


def diagonal_walls(image, gem_walls, thickness_px, ink=None):
    """
    Muros diagonales (ochavas, paredes en ángulo) y tramos de muros curvos
    que ve Gemini. Cada uno se corre en paralelo hasta caer sobre la tinta
    y se recorta al tramo dibujado. Devuelve muros con 'line' (eje en px) y
    'thickness'; three.py los construye como rectángulos girados.
    """
    S = max(image.size)
    if ink is None:
        ink = stroke_mask(image, max_gray=205) | contrast_mask(image)
    tight = ndimage.binary_dilation(ink, iterations=2)
    t = float(thickness_px or max(6, int(0.010 * S)))
    reach = max(6, int(0.02 * S))
    out = []
    for w in gem_walls or []:
        x1, y1, x2, y2 = w['x1'], w['y1'], w['x2'], w['y2']
        dx, dy = x2 - x1, y2 - y1
        L = float(np.hypot(dx, dy))
        if L < 0.04 * S or abs(dy) <= 0.15 * abs(dx) or abs(dx) <= 0.15 * abs(dy):
            continue  # corto o casi recto (eso lo hacen los otros detectores)
        nx, ny = -dy / L, dx / L
        best, best_cov = None, 0.0
        for off in range(-reach, reach + 1, 2):
            cov = _ink_ratio(tight, x1 + nx * off, y1 + ny * off, x2 + nx * off, y2 + ny * off)
            if cov > best_cov:
                best, best_cov = off, cov
        if best is None or best_cov < 0.5:
            continue
        sx1, sy1, sx2, sy2 = x1 + nx * best, y1 + ny * best, x2 + nx * best, y2 + ny * best
        span = _inked_span(tight, sx1, sy1, sx2, sy2, max_gap=int(0.03 * S))
        if span is None:
            continue
        ax, ay, bx, by = (float(v) for v in span)
        if np.hypot(bx - ax, by - ay) < 0.04 * S:
            continue
        h = t / 2.0
        out.append({'x1': int(min(ax, bx) - h), 'y1': int(min(ay, by) - h),
                    'x2': int(max(ax, bx) + h), 'y2': int(max(ay, by) + h),
                    'line': [ax, ay, bx, by], 'thickness': t})
    return out


def _merge_overlapping_openings(det):
    """
    Dos vanos encimados (IA + hueco + Gemini sobre la misma puerta) armaban
    dos dinteles corridos que en el 3D parecen pedazos de pared sobresalientes.
    Se unen en uno solo (la caja que cubre a ambos); puerta gana a ventana.
    """
    pts, cls = det['points'], det['classes']
    scs = list(det.get('scores') or [1.0] * len(pts))
    idx = [i for i, c in enumerate(cls) if (c or {}).get('name') in ('door', 'window')]
    drop = set()
    for n, i in enumerate(idx):
        if i in drop:
            continue
        for j in idx[n + 1:]:
            if j in drop:
                continue
            a, b = pts[i], pts[j]
            ix = min(a['x2'], b['x2']) - max(a['x1'], b['x1'])
            iy = min(a['y2'], b['y2']) - max(a['y1'], b['y1'])
            if ix <= 0 or iy <= 0:
                continue  # solo se tocan en un borde: son dos vanos distintos
            pts[i] = {'x1': min(a['x1'], b['x1']), 'y1': min(a['y1'], b['y1']),
                      'x2': max(a['x2'], b['x2']), 'y2': max(a['y2'], b['y2'])}
            if cls[j].get('name') == 'door':
                cls[i] = {'name': 'door'}
            drop.add(j)
    if drop:
        keep = [k for k in range(len(pts)) if k not in drop]
        det['points'] = [pts[k] for k in keep]
        det['classes'] = [cls[k] for k in keep]
        det['scores'] = [scs[k] for k in keep]


def _wall_like(b, dark, cv_walls, min_fill=0.40, thickness=None):
    """
    ¿La caja de muro de la IA es un muro de verdad? Sí si está rellena de
    tinta oscura (pared maciza o rayada) o si coincide con un muro del
    detector clásico. Un mueble (color, o solo su contorno fino) no.
    """
    H, W = dark.shape
    x1, y1 = max(0, int(b['x1'])), max(0, int(b['y1']))
    x2, y2 = min(W, int(b['x2'])), min(H, int(b['y2']))
    if x2 <= x1 or y2 <= y1:
        return False
    area = float((x2 - x1) * (y2 - y1))
    long_, short_ = max(x2 - x1, y2 - y1), min(x2 - x1, y2 - y1)
    # Un muro es alargado: un bloque macizo casi cuadrado (ducha, mueble de
    # cocina, marcador) o mucho más grueso que una pared no lo es.
    if long_ < 2.5 * max(short_, 1) or (thickness and short_ > 3.0 * thickness):
        return False
    # más fino que media pared: contorno de mueble/escalera (salvo que el
    # detector clásico vea ahí un muro)
    thin = bool(thickness) and min(x2 - x1, y2 - y1) < 0.5 * thickness
    if not thin and dark[y1:y2, x1:x2].mean() >= min_fill:
        return True
    for w in cv_walls:
        ix = min(x2, w['x2']) - max(x1, w['x1'])
        iy = min(y2, w['y2']) - max(y1, w['y1'])
        if ix > 0 and iy > 0 and ix * iy >= 0.5 * area:
            return True
    return False


def _host_wall(b, walls, tol):
    """Muro sobre el que cae el vano (su centro a <= tol del muro)."""
    cx, cy = (b['x1'] + b['x2']) / 2.0, (b['y1'] + b['y2']) / 2.0
    best, best_d = None, None
    for w in walls:
        dx = max(w['x1'] - cx, 0, cx - w['x2'])
        dy = max(w['y1'] - cy, 0, cy - w['y2'])
        d = (dx * dx + dy * dy) ** 0.5
        if d <= tol and (best_d is None or d < best_d):
            best, best_d = w, d
    return best


def _onto_wall(b, w):
    """Encaja el vano en el eje y espesor del muro anfitrión."""
    horiz = (w['x2'] - w['x1']) >= (w['y2'] - w['y1'])
    if horiz:
        span = max(b['x2'] - b['x1'], 1)
        return {'x1': b['x1'], 'x2': b['x1'] + span, 'y1': w['y1'], 'y2': w['y2']}
    span = max(b['y2'] - b['y1'], 1)
    return {'x1': w['x1'], 'x2': w['x2'], 'y1': b['y1'], 'y2': b['y1'] + span}


def quality_score(n_walls, n_inner, n_doors, source):
    """Puntaje 0-100 de qué tan confiable es la lectura del plano."""
    score = 0
    score += 30 if n_walls >= 4 else 10 * n_walls // 2
    score += 30 if n_inner >= 1 else 0
    score += 15 if n_doors >= 1 else 0
    score += {'usuario': 25, 'cotas': 25, 'puertas': 15, 'puertas_dibujadas': 10}.get(source, 0)
    return min(100, score)


def raw_ml(det):
    """Detecciones originales de la IA (sin lo agregado por el pipeline)."""
    return copy.deepcopy(det.get('ml') or {k: v for k, v in det.items() if k not in ('ml', 'quality')})


def enrich_detections(ml_det, image, real_width_m=None):
    """
    Combina la IA con el detector clásico y calcula la escala.

    Args:
        ml_det: detecciones de la IA ({points, classes, scores, ...}).
        image: PIL.Image del plano (rasterizado).
        real_width_m: ancho total real del plano en metros (opcional).

    Returns:
        det combinado: mismos campos + metersPerPixel, scaleSource,
        quality (informe) y ml (detecciones originales de la IA).
    """
    ml = copy.deepcopy(ml_det)
    det = copy.deepcopy(ml_det)
    det['ml'] = ml

    try:
        cv = detect_walls(image)
    except Exception as exc:  # nunca romper la generación por el detector
        cv = {'walls': [], 'doors': [], 'thickness_px': None, 'extent_px': None, 'error': str(exc)}

    # Árbitro: Gemini lee cotas y muros (opcional, nunca rompe el flujo).
    gem = None
    try:
        from .gemini_plan import read_plan
        gem = read_plan(image)
    except Exception:
        gem = None

    # Muebles que la IA cree muros (sofá, isla de cocina, escalera): su caja
    # casi no tiene tinta de pared. Se quitan, salvo que el detector clásico
    # vea ahí un muro.
    dropped_ml = 0
    try:
        dark = stroke_mask(image)
        keep_idx = []
        for i, (p, c) in enumerate(zip(det['points'], det['classes'])):
            if (c or {}).get('name') == 'wall' and not _wall_like(p, dark, cv['walls'], thickness=cv.get('thickness_px')):
                dropped_ml += 1
                continue
            keep_idx.append(i)
        if dropped_ml:
            sc_old = list(det.get('scores') or [1.0] * len(det['points']))
            det['points'] = [det['points'][i] for i in keep_idx]
            det['classes'] = [det['classes'][i] for i in keep_idx]
            det['scores'] = [sc_old[i] for i in keep_idx]
    except Exception:
        pass

    ml_windows = _boxes_of(ml, 'window')
    ml_doors = _boxes_of(ml, 'door')
    scores = list(det.get('scores') or [1.0] * len(det.get('points', [])))

    # Modo boceto (dibujo a mano): Gemini decide qué es muro y la tinta dónde.
    from .sketch import is_sketch, keep_long_extra, sketch_walls
    sketch = False
    gem_added = []
    if is_sketch(cv):
        snapped = sketch_walls(image, (gem or {}).get('walls') or [])
        if len(snapped) >= 4:
            sketch = True
            # Fuera los muros de la IA y del detector (letras, flechas,
            # pedazos): quedan los de Gemini ajustados + los largos que falten.
            keep = [(p, c, sc) for p, c, sc in zip(det['points'], det['classes'], scores)
                    if (c or {}).get('name') != 'wall']
            det['points'] = [k[0] for k in keep]
            det['classes'] = [k[1] for k in keep]
            scores = [k[2] for k in keep]
            for wall in snapped + keep_long_extra(cv['walls'], snapped, max(image.size)):
                det['points'].append(wall)
                det['classes'].append({'name': 'wall'})
                scores.append(0.95)
            gem_added = snapped
            cv['doors'] = []  # en un boceto no hay hojas de puerta de color
            xs = [b['x1'] for b in snapped] + [b['x2'] for b in snapped]
            ys = [b['y1'] for b in snapped] + [b['y2'] for b in snapped]
            cv['extent_px'] = (min(xs), min(ys), max(xs), max(ys))

    # Muros del detector clásico (los duplicados con la IA se quitan luego
    # en walls_fix._dedupe).
    for wall in ([] if sketch else cv['walls']):
        det['points'].append(wall)
        det['classes'].append({'name': 'wall'})
        scores.append(0.99)
    # Muros que solo vio Gemini (validados contra la tinta del plano).
    if gem and not sketch:
        gem_added = gemini_walls(image, gem['walls'], _boxes_of(det, 'wall'), cv.get('thickness_px'))
        for wall in gem_added:
            det['points'].append(wall)
            det['classes'].append({'name': 'wall'})
            scores.append(0.9)
    # Muros diagonales y tramos de muros curvos (validados con la tinta).
    # 1) de la tinta que sobra (no depende de Gemini); 2) si no hay, lo que
    #    diga Gemini, corrido sobre la tinta.
    diag = []
    try:
        from .curves import residual_walls
        S_ = max(image.size)
        if sketch:
            from .sketch import ink_mask
            ink_d, t_d = ink_mask(image), max(6, int(0.010 * S_))
        else:
            ink_d = ndimage.binary_closing(stroke_mask(image) & contrast_mask(image, min_dist=50.0),
                                           structure=np.ones((3, 3), dtype=bool))
            t_d = cv.get('thickness_px')
        diag = residual_walls(ink_d, [b for b in _boxes_of(det, 'wall') if not b.get('line')], t_d, S_)
        # una pared diagonal o curva está DENTRO de la casa: las líneas de la
        # terraza, barandas o marcas exteriores no son muros
        # la casa de los muros vistos en el dibujo (IA + detector), sin los de
        # Gemini: una línea de terraza aceptada por error no la agranda
        known = _boxes_of(ml, 'wall') + list(cv.get('walls') or [])
        diag = _inside_house(diag, known or _boxes_of(det, 'wall'), S_)
    except Exception as exc:  # nunca romper la generación por esto
        import logging
        logging.getLogger(__name__).warning('muros curvos: %s', exc)
        diag = []
    if not diag and gem:
        try:
            diag = diagonal_walls(image, gem['walls'], cv.get('thickness_px'))
            # también dentro de la casa (terraza, barandas, marcas: afuera)
            known = _boxes_of(ml, 'wall') + list(cv.get('walls') or [])
            diag = _inside_house(diag, known or _boxes_of(det, 'wall'), max(image.size))
        except Exception:
            diag = []
    for wall in diag:
        det['points'].append(wall)
        det['classes'].append({'name': 'wall'})
        scores.append(0.9)

    # Puertas dibujadas que la IA no vio (nunca sobre una ventana/puerta).
    cv_doors = [d for d in cv['doors'] if not any(_overlaps(d, o) for o in ml_windows + ml_doors)]
    for door in cv_doors:
        det['points'].append(door)
        det['classes'].append({'name': 'door'})
        scores.append(0.95)
    det['scores'] = scores

    # Escala: ancho real del usuario > cotas leídas > puertas de la IA >
    # puertas por color > fijo
    extent = cv.get('extent_px')
    if not extent:
        walls_px = _boxes_of(det, 'wall')
        if walls_px:
            extent = (min(b['x1'] for b in walls_px), min(b['y1'] for b in walls_px),
                      max(b['x2'] for b in walls_px), max(b['y2'] for b in walls_px))
    avg_door = float(ml.get('averageDoor') or 0.0)
    cotas = None
    if gem and extent:
        ests = []
        if gem.get('width_m') and extent[2] - extent[0] > 10:
            ests.append(gem['width_m'] / float(extent[2] - extent[0]))
        if gem.get('height_m') and extent[3] - extent[1] > 10:
            ests.append(gem['height_m'] / float(extent[3] - extent[1]))
        # Si ancho y alto discrepan > 15 % la lectura no es confiable.
        if ests and (len(ests) == 1 or max(ests) <= 1.15 * min(ests)):
            cotas = float(np.mean(ests))
    if real_width_m and extent and extent[2] - extent[0] > 10:
        px2m, source = float(real_width_m) / float(extent[2] - extent[0]), 'usuario'
    elif cotas:
        px2m, source = cotas, 'cotas'
    elif avg_door > 4:
        px2m, source = 0.90 / avg_door, 'puertas'
    elif cv_doors:
        px2m, source = DOOR_REF_M / float(np.median([_door_size(d) for d in cv_doors])), 'puertas_dibujadas'
    else:
        px2m, source = FALLBACK_PX2M, 'estimada'
    det['metersPerPixel'] = px2m
    det['scaleSource'] = source

    # Boceto: un hueco con ancho de puerta entre dos tramos de la misma
    # pared ES una puerta (a mano se dibuja así). Sin esto el 3D lo rellena.
    gap_doors = []
    if sketch:
        oriented = []
        for b in _boxes_of(det, 'wall'):
            o = 'h' if (b['x2'] - b['x1']) >= (b['y2'] - b['y1']) else 'v'
            oriented.append((o, b['x1'], b['y1'], b['x2'], b['y2']))
        openings = [(o['x1'], o['y1'], o['x2'], o['y2'])
                    for o in _boxes_of(det, 'door') + _boxes_of(det, 'window')]
        from .sketch import end_gap_doors
        found = find_door_gaps(oriented, px2m, openings)
        found += end_gap_doors(_boxes_of(det, 'wall'), px2m,
                               openings + [(d['x1'], d['y1'], d['x2'], d['y2']) for d in found])
        for b in found:
            det['points'].append(b)
            det['classes'].append({'name': 'door'})
            det['scores'].append(0.9)
            gap_doors.append(b)

    # Símbolos de entrada (marca negra sobre el muro) -> puerta.
    entry_doors = []
    try:
        markers = [] if sketch else find_entry_markers(
            image, cv.get('_oriented') or [], cv.get('thickness_px'), px2m)
        # Una ENTRADA siempre está en el borde de la casa: una marca oscura
        # adentro (rayado de chimenea, mueble oscuro) no es una puerta.
        edge_px = max(10, int(0.025 * max(image.size)))
        house = _house_outline(_boxes_of(det, 'wall'), edge_px)
        markers = [b for b in markers
                   if _on_outline(house, b['x1'], (b['y1'] + b['y2']) / 2.0, b['x2'], (b['y1'] + b['y2']) / 2.0, edge_px)
                   or _on_outline(house, (b['x1'] + b['x2']) / 2.0, b['y1'], (b['x1'] + b['x2']) / 2.0, b['y2'], edge_px)]
        for b in markers:
            if not any(_overlaps(b, o) for o in _boxes_of(det, 'door') + _boxes_of(det, 'window')):
                det['points'].append(b)
                det['classes'].append({'name': 'door'})
                det['scores'].append(0.9)
                entry_doors.append(b)
    except Exception:
        pass

    # Puertas/ventanas que solo vio Gemini (símbolos de entrada, planos sin
    # arcos). Se aceptan si caen sobre un muro y tienen ancho razonable.
    gem_doors = gem_windows = 0
    if gem:
        walls_px = _boxes_of(det, 'wall')
        tol = max(6, int((cv.get('thickness_px') or 12) * 1.5))
        if sketch:  # en un boceto la puerta es un hueco: su centro queda lejos de las puntas
            tol = max(tol, int(0.03 * max(image.size)))
        for kind, lo_m, hi_m in (('door', 0.5, 2.6), ('window', 0.4, 4.0)):
            existing = _boxes_of(det, 'door') + _boxes_of(det, 'window')
            for b in gem.get(kind + 's') or []:
                b = {k: int(round(v)) for k, v in b.items()}
                if any(_overlaps(b, o) for o in existing):
                    continue
                host = _host_wall(b, walls_px, tol)
                if host is None:
                    continue
                b = _onto_wall(b, host)
                if any(_overlaps(b, o, margin=2) for o in existing):
                    continue  # ya hay un vano ahí (revisado YA encajado en el muro)
                # Una puerta real deja hueco o lleva símbolo: sobre un muro
                # dibujado continuo, Gemini la está inventando.
                if (kind == 'door' or sketch) and wall_ink_coverage(image, b) >= 0.9:
                    continue
                width_m = _door_size(b) * px2m
                if not (lo_m <= width_m <= hi_m):
                    continue
                det['points'].append(b)
                det['classes'].append({'name': kind})
                det['scores'].append(0.85)
                existing.append(b)
                if kind == 'door':
                    gem_doors += 1
                else:
                    gem_windows += 1

    _merge_overlapping_openings(det)

    n_walls = len(_boxes_of(det, 'wall'))
    n_doors = len(_boxes_of(det, 'door'))
    n_windows = len(_boxes_of(det, 'window'))
    warnings = []
    if n_doors == 0:
        warnings.append('No se detectaron puertas: revisa el modelo en el editor.')
    if source == 'estimada':
        warnings.append('Escala estimada: indica el ancho real del plano para medidas exactas.')
    if n_walls < 4:
        warnings.append('Se detectaron muy pocos muros: el plano puede ser poco legible.')
    if extent:
        ex1, ey1, ex2, ey2 = extent
        pad = (cv.get('thickness_px') or 10) * 2
        n_inner = sum(1 for b in _boxes_of(det, 'wall')
                      if b['x1'] > ex1 + pad and b['x2'] < ex2 - pad
                      or b['y1'] > ey1 + pad and b['y2'] < ey2 - pad)
    else:
        n_inner = 0
    if n_walls >= 4 and n_inner == 0:
        warnings.append('Solo se detectó el contorno: revisa los muros interiores en el editor.')
    width_m = (extent[2] - extent[0]) * px2m if extent else None
    det['quality'] = {
        'muros': n_walls,
        'muros_ia': len(_boxes_of(ml, 'wall')),
        'muros_detector': len(cv['walls']),
        'puertas': n_doors,
        'puertas_ia': len(ml_doors),
        'puertas_detector': len(cv_doors),
        'ventanas': n_windows,
        'escala': source,
        'metros_por_px': round(px2m, 5),
        'ancho_m': round(width_m, 2) if width_m else None,
        'espesor_pared_px': cv.get('thickness_px'),
        'muros_gemini': len(gem_added),
        'muros_ia_descartados': dropped_ml,
        'muros_diagonales': len(diag),
        'puertas_gemini': gem_doors,
        'puertas_entrada': len(entry_doors),
        'boceto': sketch,
        'puertas_hueco': len(gap_doors),
        'ventanas_gemini': gem_windows,
        'muros_interiores': n_inner,
        'gemini': bool(gem),
        'habitaciones': (gem or {}).get('rooms') or [],
        'score': quality_score(n_walls, n_inner, n_doors, source),
        'avisos': warnings,
    }
    return det
