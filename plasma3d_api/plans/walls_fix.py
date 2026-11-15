# plans/walls_fix.py
"""
Corrección de muros detectados por la IA antes de construir el 3D.

La IA entrega cada muro como una caja suelta: a veces parte una pared en dos
tramos, deja esquinas sin tocar o detecta el mismo muro dos veces. Aquí se
dejan los muros continuos y cerrados:

1. Quitar duplicados (un muro casi contenido en otro).
2. Alinear tramos casi colineales (mismo eje).
3. Unir tramos colineales separados por un hueco SIN puerta/ventana.
4. Cerrar esquinas en L y uniones en T alargando hasta el muro perpendicular.

Un espacio donde hay una puerta o ventana detectada NUNCA se rellena: ese
hueco lo cierra el vano (three._snap_opening).

Todo en metros, con cajas alineadas a los ejes (shapely.box).
"""
from shapely.geometry import Point, box

ALIGN_TOL_M = 0.08  # ejes a esta distancia o menos son el mismo muro
MERGE_GAP_M = 1.20  # hueco máximo entre tramos que se une (sin vano)
PASSAGE_KEEP_M = 0.30  # con "dejar paso", solo se unen huecos de hasta esto
CORNER_GAP_M = 0.60  # punta de muro a esto o menos de un perpendicular: se cierra
OPENING_MARGIN_M = 0.15  # margen para decidir si un hueco tiene un vano
DUPLICATE_RATIO = 0.85  # fracción contenida para considerar duplicado
ALWAYS_CLOSE_M = 0.10  # imprecisión de la detección: siempre se cierra
INK_COVERAGE = 0.70  # parte del largo del hueco con trazo para decir "hay pared"
INK_COVERAGE_LOOSE = 0.60  # con trazo gris/rayado y un poco más de ancho
INK_PAD_M = 0.05  # cuánto más ancho se mira (muro corrido de su línea)


class _Wall:
    """Muro como segmento con espesor: eje (a0..a1), centro transversal c."""

    __slots__ = ('horiz', 'a0', 'a1', 'c', 't', 'ext', 'idx')

    def __init__(self, poly, ext, idx):
        x0, y0, x1, y1 = poly.bounds
        self.horiz = (x1 - x0) >= (y1 - y0)
        if self.horiz:
            self.a0, self.a1, c0, c1 = x0, x1, y0, y1
        else:
            self.a0, self.a1, c0, c1 = y0, y1, x0, x1
        self.c = (c0 + c1) / 2.0
        self.t = c1 - c0
        self.ext = ext
        self.idx = idx

    @property
    def length(self):
        return self.a1 - self.a0

    def poly(self):
        h = self.t / 2.0
        if self.horiz:
            return box(self.a0, self.c - h, self.a1, self.c + h)
        return box(self.c - h, self.a0, self.c + h, self.a1)


def _rect(horiz, a0, a1, c0, c1):
    return box(a0, c0, a1, c1) if horiz else box(c0, a0, c1, a1)


def make_ink_checker(image, px2m, sketch=False):
    """
    Crea una función que mira la IMAGEN DEL PLANO en una región (metros) y
    dice si ahí hay una pared dibujada.

    Mide qué parte del largo de la región tiene trazo oscuro (por columnas a
    lo largo del eje): una pared dibujada (llena o con dos líneas) tiene trazo
    en todo su largo; una abertura real queda en blanco (o solo con el arco
    de la puerta). Así el 3D queda igual al plano.
    """
    if image is None or not px2m:
        return None
    try:
        import numpy as np
        from .cv_walls import stroke_mask
        # Trazo = oscuro y poco saturado (misma definición que el detector):
        # sirve para paredes negras y grises; el piso de color queda fuera.
        dark = stroke_mask(image)
        if sketch:  # boceto: la pared puede ser de color o lápiz claro
            from .cv_walls import contrast_mask
            dark = dark | contrast_mask(image)
    except Exception:
        return None
    height, width = dark.shape

    def drawn(region):
        x0, y0, x1, y1 = region.bounds
        horiz = (x1 - x0) >= (y1 - y0)
        c0 = max(0, int(x0 / px2m))
        c1 = min(width, int(round(x1 / px2m)) + 1)
        r0 = max(0, int(y0 / px2m))
        r1 = min(height, int(round(y1 / px2m)) + 1)
        if c1 <= c0 or r1 <= r0:
            return None
        crop = dark[r0:r1, c0:c1]
        # columnas a lo largo del eje que tienen al menos un pixel de trazo
        along = crop.any(axis=0) if horiz else crop.any(axis=1)
        if bool(along.size) and float(along.mean()) >= INK_COVERAGE:
            return True
        # Pared rayada o gris (tramos con rayado de líneas finas, muros
        # dibujados con dos líneas): se mira algo más ancho que el muro y se
        # acepta el trazo gris. Un paso abierto de verdad queda en blanco.
        broad = getattr(drawn, 'audit_mask', None)
        if broad is None:
            return False
        pad = max(1, int(round(INK_PAD_M / px2m)))
        if horiz:
            r0b, r1b, c0b, c1b = max(0, r0 - pad), min(height, r1 + pad), c0, c1
        else:
            r0b, r1b, c0b, c1b = r0, r1, max(0, c0 - pad), min(width, c1 + pad)
        crop = broad[r0b:r1b, c0b:c1b]
        along = crop.any(axis=0) if horiz else crop.any(axis=1)
        return bool(along.size) and float(along.mean()) >= INK_COVERAGE_LOOSE

    drawn.mask = dark  # para fidelity_check (comparar el 3D con el plano)
    drawn.image = image  # para la imagen de control
    # Para la auditoría final: TODO trazo de pared, también gris claro
    # (tabiques finos) y de color en bocetos. Un piso de color saturado no.
    try:
        from .cv_walls import stroke_mask as _sm, contrast_mask as _cm
        broad = _sm(image, max_gray=215)
        if sketch:
            broad = broad | _cm(image)
        drawn.audit_mask = broad
    except Exception:
        drawn.audit_mask = dark
    drawn.px2m = px2m
    return drawn


def _may_fill(region, gap, drawn):
    """¿Se puede rellenar este hueco? Igual al plano si hay imagen."""
    if gap <= ALWAYS_CLOSE_M or drawn is None:
        return True
    result = drawn(region)
    return True if result is None else result


def _has_opening(region, openings):
    """¿Hay un vano detectado (puerta/ventana) en esa región?"""
    zone = region.buffer(OPENING_MARGIN_M)
    return any(zone.intersects(o) for o in openings)


def _dedupe(walls):
    keep = []
    for w in sorted(walls, key=lambda w: -w.poly().area):
        p = w.poly()
        dup = False
        for k in keep:
            if k.horiz != w.horiz:
                continue
            inter = p.intersection(k.poly()).area
            if p.area > 0 and inter / p.area >= DUPLICATE_RATIO:
                # absorbe el largo del duplicado
                k.a0, k.a1 = min(k.a0, w.a0), max(k.a1, w.a1)
                k.ext = k.ext or w.ext
                dup = True
                break
        if not dup:
            keep.append(w)
    return keep


PARALLEL_GAP_M = 0.15  # caras de dos muros paralelos a esto o menos: es el mismo


def _typical_t(walls):
    ts = sorted(w.t for w in walls)
    return ts[len(ts) // 2] if ts else 0.15


def _merge_parallel(walls):
    """
    Muro doble: el mismo muro detectado dos veces (IA + detector, o las dos
    líneas de un muro dibujado con doble trazo), corrido unos cm. Quedaba una
    rendija oscura entre los dos y la puerta cortaba solo uno. Se unen en un
    solo muro que va de la cara exterior de uno a la del otro, en el tramo
    común; lo que sobra de cada uno queda como tramo propio.
    Si el muro unido saldría mucho más grueso que una pared, son dos muros
    reales cercanos y no se tocan.
    """
    t_typ = _typical_t(walls)
    changed = True
    while changed:
        changed = False
        for i, a in enumerate(walls):
            for b in walls[i + 1:]:
                if a.horiz != b.horiz:
                    continue
                lo, hi = max(a.a0, b.a0), min(a.a1, b.a1)
                common = hi - lo
                if common <= 0 or common < 0.5 * min(a.length, b.length):
                    continue
                c0 = min(a.c - a.t / 2, b.c - b.t / 2)
                c1 = max(a.c + a.t / 2, b.c + b.t / 2)
                gap = (c1 - c0) - a.t - b.t  # <0: se pisan
                if gap > PARALLEL_GAP_M or abs(a.c - b.c) < 1e-6:
                    continue
                # Pegados (<= 6 cm): las dos líneas de un muro rayado/doble
                # trazo, siempre es el mismo muro (hasta un muro grueso real).
                # Más separados: solo si no queda mucho más grueso que una pared.
                if gap <= 0.06:
                    if (c1 - c0) > 0.40:
                        continue
                elif (c1 - c0) > 1.5 * max(t_typ, a.t, b.t):
                    continue
                merged = _Wall(_rect(a.horiz, lo, hi, c0, c1), a.ext or b.ext, min(a.idx, b.idx))
                rest = []
                for w in (a, b):
                    for s0, s1 in ((w.a0, lo), (hi, w.a1)):
                        if s1 - s0 > 0.05:
                            h = w.t / 2
                            rest.append(_Wall(_rect(w.horiz, s0, s1, w.c - h, w.c + h), w.ext, w.idx))
                walls = [w for w in walls if w is not a and w is not b] + [merged] + rest
                changed = True
                break
            if changed:
                break
    return walls


def _align(walls):
    """Iguala el eje de tramos casi colineales (promedio pesado por largo)."""
    for horiz in (True, False):
        group = sorted([w for w in walls if w.horiz == horiz], key=lambda w: w.c)
        cluster = []
        for w in group + [None]:
            if w is not None and cluster and abs(w.c - cluster[-1].c) <= ALIGN_TOL_M:
                cluster.append(w)
                continue
            if len(cluster) > 1:
                total = sum(m.length for m in cluster) or 1.0
                c = sum(m.c * m.length for m in cluster) / total
                for m in cluster:
                    m.c = c
            cluster = [w] if w is not None else []


def _merge(walls, openings, fill_gaps, passages, drawn=None):
    """Une tramos colineales separados por un hueco sin vano."""
    limit = MERGE_GAP_M if fill_gaps else PASSAGE_KEEP_M
    out = []
    for horiz in (True, False):
        lines = {}
        for w in walls:
            if w.horiz == horiz:
                lines.setdefault(round(w.c, 3), []).append(w)
        for segs in lines.values():
            segs.sort(key=lambda w: w.a0)
            cur = segs[0]
            for nxt in segs[1:]:
                gap = nxt.a0 - cur.a1
                t = max(cur.t, nxt.t)
                region = _rect(horiz, cur.a1, nxt.a0, cur.c - t / 2, cur.c + t / 2)
                if gap <= 0:
                    join = True
                elif _has_opening(region, openings):
                    join = False  # ahí hay una puerta/ventana: no se rellena
                else:
                    join = gap <= limit and _may_fill(region, gap, drawn)
                    if not join and gap <= MERGE_GAP_M and gap > ALWAYS_CLOSE_M:
                        passages.append(region)  # abertura sin puerta: dintel arriba
                if join:
                    cur.a1 = max(cur.a1, nxt.a1)
                    cur.t = t
                    cur.ext = cur.ext or nxt.ext
                else:
                    out.append(cur)
                    cur = nxt
            out.append(cur)
    return out


def _reach_openings(walls, openings, limit, drawn=None):
    """
    Alarga la punta de un muro hasta el vano de su misma línea (ventana o
    puerta detectada un poco separada): el hueco entre ambos se rellena con
    muro, el vano queda donde la IA lo detectó.
    """
    ops = [_Wall(o, False, -1) for o in openings]
    for w in walls:
        h = w.t / 2
        for o in ops:
            if o.horiz != w.horiz or abs(o.c - w.c) > max(ALIGN_TOL_M, (o.t + w.t) / 2):
                continue
            if 0 < o.a0 - w.a1 <= limit:
                region = _rect(w.horiz, w.a1, o.a0, w.c - h, w.c + h)
                if not any(region.buffer(-0.01).intersects(x) for x in openings)                         and _may_fill(region, o.a0 - w.a1, drawn):
                    w.a1 = o.a0
            if 0 < w.a0 - o.a1 <= limit:
                region = _rect(w.horiz, o.a1, w.a0, w.c - h, w.c + h)
                if not any(region.buffer(-0.01).intersects(x) for x in openings)                         and _may_fill(region, w.a0 - o.a1, drawn):
                    w.a0 = o.a1


def _close_corners(walls, openings, gap_limit=CORNER_GAP_M, drawn=None):
    """Alarga puntas de muro hasta la cara exterior del muro perpendicular."""
    CORNER = gap_limit
    for _ in range(2):  # dos pasadas: L con ambas puntas cortas
        for w in walls:
            for p in walls:
                if p.horiz == w.horiz:
                    continue
                # p corre en el eje transversal de w: ¿el eje de w cruza a p?
                if not (p.a0 - CORNER_GAP_M <= w.c <= p.a1 + CORNER_GAP_M):
                    continue
                near_lo, near_hi = p.c - p.t / 2, p.c + p.t / 2
                h = w.t / 2
                # punta final de w hacia p
                if w.a1 <= near_hi and 0 < near_lo - w.a1 <= CORNER:
                    region = _rect(w.horiz, w.a1, near_lo, w.c - h, w.c + h)
                    if not _has_opening(region, openings) and _may_fill(region, near_lo - w.a1, drawn):
                        w.a1 = near_hi
                # punta inicial de w hacia p
                if w.a0 >= near_lo and 0 < w.a0 - near_hi <= CORNER:
                    region = _rect(w.horiz, near_hi, w.a0, w.c - h, w.c + h)
                    if not _has_opening(region, openings) and _may_fill(region, w.a0 - near_hi, drawn):
                        w.a0 = near_lo
                # (el caso inverso, p corto hacia w, se resuelve cuando p es "w")


JOG_GAP_M = 0.60  # punta a esto o menos del siguiente tramo corrido
JOG_OFFSET_M = 0.80  # desplazamiento lateral máximo de un quiebre


def _close_jogs(walls, openings, drawn):
    """
    Quiebres de pared (escalón en L): un muro termina y el siguiente tramo
    (muro o vano) sigue paralelo pero corrido hacia un lado. Se completa con
    una pieza perpendicular que cruza de una línea a la otra y un tramo por
    la línea del siguiente. Solo si en el plano hay pared dibujada ahí.
    """
    # (destino, polígono original del vano o None si es un muro)
    targets = [(w, None) for w in walls] + [(_Wall(o, False, -1), o) for o in openings]
    added = []
    next_idx = max((w.idx for w in walls), default=0) + 1000
    for w in walls:
        h = w.t / 2
        for end, sign in (('a1', 1), ('a0', -1)):
            tip = getattr(w, end)
            for o, source in targets:
                if o is w or o.horiz != w.horiz:
                    continue
                offset = abs(o.c - w.c)
                if offset <= ALIGN_TOL_M or offset > JOG_OFFSET_M:
                    continue
                start = o.a0 if sign > 0 else o.a1  # punta del siguiente que mira a w
                gap = (start - tip) * sign
                if not (0 < gap <= JOG_GAP_M):
                    continue
                # ¿el siguiente ya está unido a algo en ese extremo? (no duplicar)
                lo, hi = sorted((tip, start))
                t = max(w.t, o.t)
                c_lo, c_hi = sorted((w.c, o.c))
                # pieza perpendicular en la punta de w, de una línea a la otra
                cross = _rect(w.horiz, min(tip, tip - sign * t), max(tip, tip - sign * t), c_lo - t / 2, c_hi + t / 2)
                # tramo por la línea del siguiente, desde la punta de w hasta él
                run = _rect(w.horiz, lo, hi, o.c - o.t / 2, o.c + o.t / 2)
                if _has_opening(run, [x for x in openings if x is not source]):
                    continue
                ok = drawn is None or bool(drawn(run)) or bool(drawn(cross))
                if not ok:
                    continue
                for piece in (cross, run):
                    if piece.area > 1e-6:
                        added.append(_Wall(piece, w.ext, next_idx))
                        next_idx += 1
                break
    walls.extend(added)


def fix_walls(walls, openings, fill_gaps=True, drawn=None):
    """
    Corrige los muros detectados.

    Args:
        walls: [(Polygon caja, is_external, index)] en metros.
        openings: [Polygon] cajas de puertas/ventanas detectadas (metros).
        fill_gaps: True rellena huecos sin vano de hasta MERGE_GAP_M;
            False solo cierra rendijas (<= PASSAGE_KEEP_M) y deja los pasos.
        drawn: función de make_ink_checker(); si se da, un hueco solo se
            rellena si en la imagen del plano hay pared dibujada ahí (igual
            al plano). Sin imagen se usa solo la geometría.

    Returns:
        (walls corregidos [(Polygon, is_external, index)],
         passages [Polygon] pasos sin puerta que llevan dintel).
    """
    items = [_Wall(p, ext, idx) for p, ext, idx in walls]
    if not items:
        return walls, []
    items = _dedupe(items)
    items = _merge_parallel(items)
    _align(items)
    passages = []
    items = _merge(items, openings, fill_gaps, passages, drawn)
    _reach_openings(items, openings, MERGE_GAP_M if fill_gaps else PASSAGE_KEEP_M, drawn)
    # Uniones en T/L: con "Rellenar" el mismo alcance que los tramos (sin vano).
    _close_corners(items, openings, MERGE_GAP_M if fill_gaps else CORNER_GAP_M, drawn)
    # Quiebres de pared (escalón en L) hacia un tramo corrido.
    _close_jogs(items, openings, drawn)
    items.sort(key=lambda w: w.idx)
    return [(w.poly(), w.ext, w.idx) for w in items], passages


def open_ends(wall_polys, opening_polys, tol=0.03, reach=MERGE_GAP_M, drawn=None):
    """
    Huecos abiertos: puntas de muro que no tocan otro muro ni un vano pero
    tienen algo a menos de `reach` hacia donde apuntan (debían unirse).
    Las puntas sueltas que sobresalen de una esquina no cuentan, ni (con
    `drawn`) los huecos que en la imagen del plano son aberturas reales.

    Returns:
        [(x, y, hueco_m)] posición de cada punta abierta y el hueco.
    """
    items = [_Wall(p, False, i) for i, p in enumerate(wall_polys)]
    others = list(wall_polys) + list(opening_polys)
    ends = []
    for i, w in enumerate(items):
        h = w.t / 2
        for a, sign in ((w.a0, -1), (w.a1, 1)):
            probe = _rect(w.horiz, min(a, a + sign * tol), max(a, a + sign * tol), w.c - h, w.c + h)
            if any(j != i and probe.intersects(o) for j, o in enumerate(others)):
                continue
            far = _rect(w.horiz, min(a, a + sign * reach), max(a, a + sign * reach), w.c - h, w.c + h)
            near = [o for j, o in enumerate(others) if j != i and far.intersects(o)]
            if not near:
                continue  # punta suelta (sobresale de una esquina): no es hueco
            tip = _rect(w.horiz, a, a, w.c - h, w.c + h)
            gap = min(tip.distance(o) for o in near)
            if drawn is not None and gap > ALWAYS_CLOSE_M:
                hole = _rect(w.horiz, min(a, a + sign * gap), max(a, a + sign * gap), w.c - h, w.c + h)
                if drawn(hole) is False:
                    continue  # en el plano ahí no hay pared: abertura real
            pos = (round(a, 2), round(w.c, 2)) if w.horiz else (round(w.c, 2), round(a, 2))
            ends.append(pos + (round(gap, 2),))
    return ends


FACING_MAX_M = 3.0  # un tramo inventado a esto o menos frente a un vano no se cierra


def _faces_opening(piece, openings, wall_polys, max_dist=FACING_MAX_M):
    """
    ¿El tramo de perímetro que falta está frente a una puerta/ventana, sin
    ningún muro en medio? Entonces no es un muro tapado por un mueble sino
    el exterior (porche, terraza): cerrarlo dejaría la puerta sin salida.
    """
    from shapely.geometry import LineString
    from shapely.ops import nearest_points

    px0, py0, px1, py1 = piece.bounds
    piece_h = (px1 - px0) >= (py1 - py0)
    for o in openings:
        ox0, oy0, ox1, oy1 = o.bounds
        o_h = (ox1 - ox0) >= (oy1 - oy0)
        if o_h != piece_h:
            continue  # no está enfrentado (perpendicular)
        # se superponen a lo largo del eje
        if piece_h and (min(px1, ox1) - max(px0, ox0)) <= 0:
            continue
        if not piece_h and (min(py1, oy1) - max(py0, oy0)) <= 0:
            continue
        if piece.distance(o) > max_dist:
            continue
        a, b = nearest_points(o, piece)
        ray = LineString([a, b])
        if ray.length < 0.05:
            continue
        blocked = any(
            w.intersects(ray) and not w.buffer(0.05).contains(a) and w.distance(b) > 0.05
            for w in wall_polys
        )
        if not blocked:
            return True
    return False


PERIMETER_MIN_M = 0.40  # tramo de perímetro sin muro más corto que se completa


def complete_perimeter(walls, openings, passages=()):
    """
    Cierra el borde exterior de la casa: una casa siempre está cerrada por
    fuera, aunque en el dibujo un mueble tape la pared o falten tramos entre
    ventanas. Con el contorno de la casa (el mismo del piso) se levanta muro
    en todo tramo del borde que no tenga muro, puerta, ventana ni paso.

    Args:
        walls: [(Polygon, is_external, index)] ya corregidos.
        openings: [Polygon] puertas/ventanas (metros).
        passages: [Polygon] pasos sin puerta (no se cierran).

    Returns:
        (walls + tramos nuevos, metros de perímetro que estaban sin muro)
    """
    from shapely.ops import unary_union
    from .three import _footprint_polygon

    if not walls:
        return walls, 0.0
    polys = [w[0] for w in walls]
    footprint = _footprint_polygon(polys, list(openings) + list(passages))
    if footprint is None or footprint.is_empty:
        return walls, 0.0

    # espesor típico de los muros detectados
    thick = sorted(min(p.bounds[2] - p.bounds[0], p.bounds[3] - p.bounds[1]) for p in polys)
    t = min(0.30, max(0.12, thick[len(thick) // 2]))

    band = footprint.difference(footprint.buffer(-t, join_style=2))
    covered = unary_union(
        [p.buffer(t * 0.6, join_style=2) for p in polys]
        + [o.buffer(0.10, join_style=2) for o in openings]
        + [p.buffer(0.05, join_style=2) for p in passages]
    )
    missing = band.difference(covered)
    pieces = list(getattr(missing, 'geoms', [missing])) if not missing.is_empty else []

    added, missing_len = [], 0.0
    next_idx = max((w[2] for w in walls), default=0) + 5000
    for piece in pieces:
        if piece.is_empty or piece.geom_type != 'Polygon':
            continue
        x0, y0, x1, y1 = piece.bounds
        length = max(x1 - x0, y1 - y0)
        if length < PERIMETER_MIN_M or piece.area < t * PERIMETER_MIN_M * 0.5:
            continue
        if _faces_opening(piece, openings, polys):
            continue  # delante de una puerta/ventana: es exterior (porche, patio)
        if piece.area < 0.6 * box(*piece.bounds).area:
            continue  # tramo torcido/diagonal: no es un borde real de la casa
        missing_len += length
        # crecer dentro del borde hasta tocar los muros vecinos (sin rendijas)
        grown = piece.buffer(t * 0.7, join_style=2).intersection(band).buffer(0)
        if grown.geom_type != 'Polygon':
            grown = max(getattr(grown, 'geoms', [piece]), key=lambda g: g.area)
        added.append((grown, True, next_idx))
        next_idx += 1
    return list(walls) + added, round(missing_len, 2)


# ---------------------------------------------------------------------------
# Limpieza final de uniones: sin picos, rendijas, escalones ni restos sueltos
# ---------------------------------------------------------------------------
OVERSHOOT_M = 0.60  # pico que sobresale de un muro perpendicular (se recorta)
OVERSHOOT_MIN_M = 0.01  # desde 1 cm (un saliente chico también se ve)
SLIT_M = 0.25  # rendija entre punta y muro perpendicular (se cierra)
SLIT_SKETCH_M = 0.40
MIN_WALL_T_M = 0.08  # grosor mínimo de un muro en el 3D
STUB_M = 0.35  # tramo más corto que esto, suelto: se borra
ALIGN_SKETCH_M = 0.20


def _is_rect(poly):
    return poly.area >= 0.97 * box(*poly.bounds).area


def _end_info(w, end):
    """Punta de w: (posición en el eje, signo hacia afuera)."""
    return (w.a1, 1) if end == 'hi' else (w.a0, -1)


def _crosses(p, w, tol):
    """¿El muro perpendicular p llega al eje de w (con tolerancia)?"""
    return p.a0 - tol <= w.c <= p.a1 + tol


def _touching(region, walls, skip, openings):
    """¿Algo (otro muro o un vano) toca esa región?"""
    zone = region.buffer(0.03)
    # un vano cuenta solo si de verdad se mete en la región (no si la roza
    # en una esquina: así un pico al lado de una puerta también se recorta)
    if any(region.intersection(o).area > 0.002 for o in openings):
        return True
    return any(o is not skip and zone.intersects(o.poly()) for o in walls)


def _opening_inside(region, openings):
    """¿Hay un vano DENTRO de la rendija? (no alcanza con que esté cerca)."""
    inner = region.buffer(-0.005)  # el vano al que se llega (que solo toca el borde) no cuenta
    return any(inner.intersection(o).area > 0.001 for o in openings)


def _overshoots(w, walls, openings):
    """[(end, p, sobrante)] picos de w que pasan de largo un perpendicular."""
    found = []
    for end in ('lo', 'hi'):
        e, sgn = _end_info(w, end)
        best = None
        for p in walls:
            if p is w or p.horiz == w.horiz or not _crosses(p, w, p.t):
                continue
            face = p.c + sgn * p.t / 2.0  # cara de p del lado de la punta
            extra = (e - face) * sgn
            inner = (p.c - sgn * p.t / 2.0 - (w.a0 if sgn > 0 else w.a1)) * sgn
            if OVERSHOOT_MIN_M < extra <= OVERSHOOT_M and inner > 0:  # w viene de antes de p
                if best is None or extra < best[2]:
                    best = (end, p, extra, face)
        if best is None:
            continue
        end, p, extra, face = best
        a, b = sorted((face, e))
        h = w.t / 2.0
        region = _rect(w.horiz, a, b, w.c - h, w.c + h)
        others = [o for o in walls if o is not p]
        if not _touching(region, others, w, openings):
            found.append((end, p, face))
    return found


def _slits(w, walls, openings, limit):
    """[(end, p, gap)] puntas que quedan cortas antes de un perpendicular."""
    found = []
    for end in ('lo', 'hi'):
        e, sgn = _end_info(w, end)
        best = None
        for p in walls:
            if p is w or p.horiz == w.horiz or not _crosses(p, w, limit):
                continue
            near = p.c - sgn * p.t / 2.0  # cara de p que mira a la punta
            gap = (near - e) * sgn
            if 0.01 < gap <= limit and (best is None or gap < best[2]):
                best = (end, p, gap, near)
        if best is None:
            continue
        end, p, gap, near = best
        a, b = sorted((e, near))
        h = w.t / 2.0
        if not _opening_inside(_rect(w.horiz, a, b, w.c - h, w.c + h), openings):
            found.append((end, p, gap))
    return found


JAMB_GAP_M = 0.30  # pared que termina a esto o menos de un vano de su línea
JAMB_LINE_TOL_M = 0.15  # vano corrido de la línea de su muro hasta esto: misma línea


def _reach_jambs(items, openings, limit):
    """Estira puntas de muro hasta el vano (puerta/ventana) de su misma línea."""
    for o in openings:
        if not _is_rect(o) or o.area <= 0:
            continue
        ow = _Wall(o, False, -1)
        for w in items:
            if w.horiz != ow.horiz:
                continue
            # misma línea: el eje del vano cae dentro del grosor del muro
            if abs(ow.c - w.c) > max(w.t, ow.t) / 2.0 + JAMB_LINE_TOL_M:
                continue
            gap_hi = ow.a0 - w.a1  # vano después de la punta final
            gap_lo = w.a0 - ow.a1  # vano antes de la punta inicial
            if 0 < gap_hi <= limit:
                w.a1 = ow.a0
            elif 0 < gap_lo <= limit:
                w.a0 = ow.a1


JAMB_FILL_M = 0.40  # hueco entre un vano y la pared siguiente que se rellena siempre
JAMB_FILL_MAX_M = 0.70  # hasta esto, si hay algo de pared dibujada


def _ink_fraction(drawn, region, horiz):
    """Parte del largo de la región con trazo (gris/rayado incluido)."""
    mask = getattr(drawn, 'audit_mask', None) if drawn is not None else None
    px2m = getattr(drawn, 'px2m', None) if drawn is not None else None
    if mask is None or not px2m:
        return 0.0
    crop = _crop(mask, px2m, region.buffer(INK_PAD_M, join_style=2))
    if crop is None or crop.size == 0:
        return 0.0
    along = crop.any(axis=0) if horiz else crop.any(axis=1)
    return float(along.mean())


def _fill_jamb_gaps(items, openings, drawn):
    """
    Un vano (puerta/ventana) cuyo marco no toca ninguna pared por un lado:
    si hasta la pared siguiente (de su línea o perpendicular) hay <= 40 cm
    y en el plano ahí hay pared dibujada, se agrega ese tramo de muro.
    Así no queda un hueco de piso a techo al lado de la puerta.
    """
    added = []
    next_idx = max((w.idx for w in items), default=0) + 6000
    for o in openings:
        if not _is_rect(o) or o.area <= 0:
            continue
        ow = _Wall(o, False, -1)
        t = max(ow.t, MIN_WALL_T_M)
        h = t / 2.0
        for sgn in (1, -1):
            end = ow.a1 if sgn > 0 else ow.a0
            pt = Point(end, ow.c) if ow.horiz else Point(ow.c, end)
            if any(pt.buffer(0.03).intersects(w.poly()) for w in items + added):
                continue  # el marco ya toca una pared
            best = None
            for w in items:
                # distancia a lo largo del eje del vano hasta la pared w
                if w.horiz == ow.horiz:
                    # misma línea (el vano puede estar algo corrido de su muro)
                    if abs(w.c - ow.c) > (w.t + t) / 2.0 + JAMB_LINE_TOL_M:
                        continue
                    face = w.a0 if sgn > 0 else w.a1
                else:
                    if not (w.a0 - h <= ow.c <= w.a1 + h):
                        continue
                    face = w.c - sgn * w.t / 2.0
                gap = (face - end) * sgn
                if 0.01 < gap <= JAMB_FILL_MAX_M and (best is None or gap < best):
                    best = gap
            if best is None:
                continue
            a, b = sorted((end, end + sgn * best))
            region = _rect(ow.horiz, a, b, ow.c - h, ow.c + h)
            if any(region.buffer(-0.005).intersects(x) for x in openings if x is not o):
                continue
            # Una puerta/ventana siempre está metida en una pared: el hueco
            # entre su marco y la pared siguiente se cierra siempre hasta 40 cm;
            # hasta 70 cm, si el plano tiene algo de pared dibujada ahí.
            if best > JAMB_FILL_M and _ink_fraction(drawn, region, ow.horiz) < 0.40:
                continue
            nw = _Wall(region, False, next_idx)
            next_idx += 1
            added.append(nw)
    return added


CORNER_REACH_M = 1.3  # cada pata de una esquina abierta: hasta esto


def _complete_corners(items, openings, drawn):
    """
    Esquina en L que quedó abierta: un elemento horizontal y uno vertical
    (muro, puerta o ventana) cuyas líneas se cruzan en un punto P, y los dos
    terminan a <= 1 m de P sin llegar. Si en el plano hay pared dibujada en
    esas patas, se agregan los dos tramos hasta la esquina.
    """
    elems = list(items)
    for o in openings:
        if _is_rect(o) and o.area > 0:
            elems.append(_Wall(o, False, -1))
    if not elems:
        return []
    t_ref = _typical_t([w for w in items]) if items else MIN_WALL_T_M
    added = []
    next_idx = max((w.idx for w in items), default=0) + 9500
    for hz in [e for e in elems if e.horiz]:
        for vt in [e for e in elems if not e.horiz]:
            # P = (x de la vertical, y de la horizontal)
            px_, py_ = vt.c, hz.c
            # la horizontal debe quedar corta ANTES de P (a izquierda o derecha)
            if hz.a0 > px_:
                dh, h_end = hz.a0 - px_, hz.a0
            elif hz.a1 < px_:
                dh, h_end = px_ - hz.a1, hz.a1
            else:
                continue
            if vt.a0 > py_:
                dv, v_end = vt.a0 - py_, vt.a0
            elif vt.a1 < py_:
                dv, v_end = py_ - vt.a1, vt.a1
            else:
                continue
            if not (0.02 < dh <= CORNER_REACH_M and 0.02 < dv <= CORNER_REACH_M):
                continue
            th = max(hz.t if hz.idx != -1 else t_ref, MIN_WALL_T_M)
            tv = max(vt.t if vt.idx != -1 else t_ref, MIN_WALL_T_M)
            # patas: de cada punta hasta la esquina (cruzando el grosor del otro)
            ax0, ax1 = sorted((h_end, px_ + (tv / 2.0 if h_end > px_ else -tv / 2.0)))
            leg_h = _rect(True, ax0, ax1, hz.c - th / 2.0, hz.c + th / 2.0)
            ay0, ay1 = sorted((v_end, py_ + (th / 2.0 if v_end > py_ else -th / 2.0)))
            leg_v = _rect(False, ay0, ay1, vt.c - tv / 2.0, vt.c + tv / 2.0)
            # nada en el medio (otro muro o vano ya ocupa la esquina)
            busy = [e.poly() for e in elems if e is not hz and e is not vt] + [a.poly() for a in added]
            if any(leg_h.buffer(-0.01).intersects(b) or leg_v.buffer(-0.01).intersects(b) for b in busy):
                continue
            # en el plano tiene que haber pared en las dos patas
            if _ink_fraction(drawn, leg_h, True) < 0.5 or _ink_fraction(drawn, leg_v, False) < 0.5:
                continue
            for leg in (leg_h, leg_v):
                added.append(_Wall(leg, False, next_idx))
                next_idx += 1
    return added


def _outline(items):
    """Contorno del edificio (unión de muros con los huecos rellenos)."""
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    shape = unary_union([w.poly().buffer(0.15, join_style=2) for w in items])
    geoms = list(getattr(shape, 'geoms', [shape]))
    return unary_union([Polygon(g.exterior).buffer(-0.15, join_style=2) for g in geoms])


def _align_outer_faces(items):
    """Alinea la cara exterior de tramos colineales seguidos de una fachada."""
    if len(items) < 2:
        return
    try:
        outline = _outline(items)
    except Exception:
        return
    for a in items:
        for b in items:
            if a is b or a.horiz != b.horiz or abs(a.c - b.c) > 0.12:
                continue
            if abs(a.t - b.t) < 0.01:
                continue
            gap = max(a.a0, b.a0) - min(a.a1, b.a1)
            if gap > 0.10:
                continue  # no son seguidos
            ref, w = (a, b) if a.length >= b.length else (b, a)
            mid = (ref.a0 + ref.a1) / 2.0
            # lado de afuera: el que no está dentro del contorno
            sgn = None
            for s_ in (1, -1):
                c_out = ref.c + s_ * (ref.t / 2.0 + 0.10)
                pt = Point(mid, c_out) if ref.horiz else Point(c_out, mid)
                if not outline.contains(pt):
                    sgn = s_
                    break
            if sgn is None:
                continue  # muro interior: no hay cara exterior
            face = ref.c + sgn * ref.t / 2.0
            w.c = face - sgn * w.t / 2.0


def clean_joints(walls, openings, sketch=False, drawn=None):
    """Repite la limpieza hasta que no cambie nada (máx. 3 vueltas): unir un
    muro doble cambia su grosor y puede mover una cara unos cm."""
    def sig(ws):
        return sorted(tuple(round(v, 3) for v in p.bounds) for p, _, _ in ws)
    for _ in range(3):
        new = _clean_joints_once(walls, openings, sketch=sketch, drawn=drawn)
        if sig(new) == sig(walls):
            return new
        walls = new
    return walls


def _clean_joints_once(walls, openings, sketch=False, drawn=None):
    """
    Deja cada unión prolija. walls: [(Polygon, ext, idx)] en metros (los
    diagonales, que no son rectángulos, pasan sin tocar).

    1. Alinea tramos del mismo muro (más tolerancia en bocetos).
    2. Recorta picos que pasan de largo un muro perpendicular.
    3. Cierra rendijas hasta el muro perpendicular (centro en T, cara
       exterior en L: esquina cuadrada).
    4. Borra pedacitos sueltos.
    """
    # Casi rectángulos (tramos que inventa complete_perimeter, recortados
    # contra el contorno) también se limpian: se usan como su caja.
    def near_rect(p):
        return not _is_rect(p) and p.area >= 0.80 * box(*p.bounds).area

    rect = [(box(*p.bounds) if near_rect(p) else p, e, i) for p, e, i in walls
            if _is_rect(p) or near_rect(p)]
    other = [(p, e, i) for p, e, i in walls if not (_is_rect(p) or near_rect(p))]
    items = [_Wall(p, e, i) for p, e, i in rect]
    if not items:
        return walls
    # Un tramo inventado no puede ser más grueso que las paredes del plano.
    t_ref = _typical_t([w for w in items if w.idx < PERIMETER_IDX] or items)
    for w in items:
        if w.idx >= PERIMETER_IDX and w.t > 1.5 * t_ref:
            w.t = t_ref

    # 1. alinear
    tol = ALIGN_SKETCH_M if sketch else ALIGN_TOL_M
    for horiz in (True, False):
        group = sorted([w for w in items if w.horiz == horiz], key=lambda w: w.c)
        cluster = []
        for w in group + [None]:
            # mismo muro: ejes cercanos Y tramos que se tocan o casi
            if (w is not None and cluster and abs(w.c - cluster[-1].c) <= tol
                    and any(min(w.a1, m.a1) - max(w.a0, m.a0) > -0.3 for m in cluster)):
                cluster.append(w)
                continue
            if len(cluster) > 1:
                total = sum(m.length for m in cluster) or 1.0
                c = sum(m.c * m.length for m in cluster) / total
                for m in cluster:
                    m.c = c
            cluster = [w] if w is not None else []

    # 0. muros dobles que aparecieron en los cierres (perímetro, quiebres)
    #    y grosor mínimo: un muro de 3-5 cm es una lámina, no una pared
    items = _merge_parallel(items)
    for w in items:
        w.t = max(w.t, MIN_WALL_T_M)
        if sketch:  # en un boceto todas las paredes tienen el mismo grosor dibujado
            w.t = min(w.t, t_ref)

    # 1b. grosor parejo: tramos de la misma línea con grosores parecidos
    #     toman el del más largo (sin escalones en la cara del muro)
    for w in items:
        same = [o for o in items if o.horiz == w.horiz and abs(o.c - w.c) < 1e-6
                and min(o.a1, w.a1) - max(o.a0, w.a0) > -0.3]
        ref = max(same, key=lambda o: o.length)
        if ref is not w and max(ref.t, w.t) <= 1.4 * min(ref.t, w.t):
            w.t = ref.t

    # 1c. fachadas: tramos seguidos de la misma línea con grosores distintos
    #     se alinean por la CARA EXTERIOR (no por el eje): sin escalón afuera
    _align_outer_faces(items)

    # 2. picos (y esquina al ras: si el perpendicular termina en w, llega
    #    hasta la cara exterior de w)
    for w in items:
        for end, p, face in _overshoots(w, items, openings):
            if end == 'hi':
                w.a1 = face
            else:
                w.a0 = face
            h = w.t / 2.0
            if w.c > p.a1 - p.t / 2.0:
                p.a1 = max(p.a1, w.c + h)
            elif w.c < p.a0 + p.t / 2.0:
                p.a0 = min(p.a0, w.c - h)

    # 3. rendijas
    limit = SLIT_SKETCH_M if sketch else SLIT_M
    # Los vanos también son destino: un muro que llega entre dos puertas
    # (al pilar que queda entre ellas) tiene que tocarlas, no quedar corto.
    pseudo = []
    for o in openings:
        if _is_rect(o) and o.area > 0:
            pw = _Wall(o, False, -1)
            pw.t = max(pw.t, MIN_WALL_T_M)
            pseudo.append(pw)
    for _ in range(2):
        for w in items:
            for end, p, gap in _slits(w, items + pseudo, openings, limit):
                e, sgn = _end_info(w, end)
                h = w.t / 2.0
                a, b = sorted((e, e + sgn * gap))
                # boceto: a mano la línea no llega a tocar; la rendija se cierra igual
                if not sketch and not _may_fill(_rect(w.horiz, a, b, w.c - h, w.c + h), gap, drawn):
                    continue
                corner_l = not (p.a0 + p.t <= w.c <= p.a1 - p.t)  # p termina en w
                target = p.c + sgn * p.t / 2.0 if corner_l else p.c
                if end == 'hi':
                    w.a1 = max(w.a1, target)
                else:
                    w.a0 = min(w.a0, target)
                if corner_l and p.idx != -1:  # p también llega hasta la cara exterior de w
                    if w.c > p.a1:
                        p.a1 = max(p.a1, w.c + h)
                    elif w.c < p.a0:
                        p.a0 = min(p.a0, w.c - h)

    # 3b. hasta el marco del vano: si una pared termina a <= 30 cm de una
    #     puerta/ventana de su MISMA línea, se estira hasta el vano (si no,
    #     queda una rendija de piso a techo al lado de la puerta)
    _reach_jambs(items, openings, JAMB_GAP_M)
    # 3c. hueco entre el marco de un vano y la pared siguiente (sin tramo de
    #     muro en el medio): si en el plano está dibujado, se rellena
    items.extend(_fill_jamb_gaps(items, openings, drawn))
    # 3d. esquinas abiertas: dos líneas de pared perpendiculares (muros o
    #     ventanas/puertas) que no llegan a la esquina donde se cruzan
    items.extend(_complete_corners(items, openings, drawn))

    # 4. pedacitos sueltos
    keep = []
    for w in items:
        if w.length < STUB_M:
            zone = w.poly().buffer(0.05)
            touches = sum(1 for o in items if o is not w and zone.intersects(o.poly()))
            if touches <= 1 and not any(zone.intersects(o) for o in openings):
                continue
        keep.append(w)
    keep = _merge_parallel(keep)  # por si los cierres dejaron otro doble
    return [(w.poly(), w.ext, w.idx) for w in keep] + other


def joint_report(walls, openings, sketch=False):
    """Cuenta defectos de unión (para el informe de calidad y las pruebas)."""
    items = [_Wall(p, e, i) for p, e, i in walls if _is_rect(p)]
    limit = SLIT_SKETCH_M if sketch else SLIT_M
    free = picos = rendijas = escalones = 0
    for w in items:
        picos += len(_overshoots(w, items, openings))
        rendijas += len([s for s in _slits(w, items, openings, limit) if s[2] < 0.30])
        for end in ('lo', 'hi'):
            e, _ = _end_info(w, end)
            pt = (Point(e, w.c) if w.horiz else Point(w.c, e)).buffer(w.t / 2.0 + 0.05)
            if not (any(o is not w and pt.intersects(o.poly()) for o in items)
                    or any(pt.intersects(o) for o in openings)
                    or any(pt.intersects(p) for p, _, _ in walls if not _is_rect(p))):
                free += 1
    for i, a in enumerate(items):
        for b in items[i + 1:]:
            if a.horiz == b.horiz and 0.01 < abs(a.c - b.c) <= 0.25:
                if min(abs(a.a1 - b.a0), abs(b.a1 - a.a0)) <= 0.10:
                    escalones += 1
    dobles = laminas = 0
    for i, a in enumerate(items):
        for b in items[i + 1:]:
            if a.horiz != b.horiz:
                continue
            common = min(a.a1, b.a1) - max(a.a0, b.a0)
            gap = abs(a.c - b.c) - (a.t + b.t) / 2.0
            if common > 0.5 * min(a.length, b.length) and -0.01 < gap <= PARALLEL_GAP_M:
                dobles += 1
    for w in items:
        near_open = any(w.poly().buffer(0.05).intersects(o) for o in openings)
        if w.t < 0.06 or (w.length < 0.20 and near_open):
            laminas += 1
    chicos = 0
    for w in items:
        for end in ('lo', 'hi'):
            e, sgn = _end_info(w, end)
            for p in items:
                if p is w or p.horiz == w.horiz or not _crosses(p, w, p.t):
                    continue
                extra = (e - (p.c + sgn * p.t / 2.0)) * sgn
                if 0.01 < extra <= 0.03:
                    chicos += 1
    caras = 0
    try:
        outline = _outline(items)
        for i, a in enumerate(items):
            for b in items[i + 1:]:
                if a.horiz != b.horiz or abs(a.c - b.c) > 0.12:
                    continue
                if max(a.a0, b.a0) - min(a.a1, b.a1) > 0.10:
                    continue
                for s_ in (1, -1):
                    mid = (a.a0 + a.a1) / 2.0
                    c_out = a.c + s_ * (a.t / 2.0 + 0.10)
                    pt = Point(mid, c_out) if a.horiz else Point(c_out, mid)
                    if not outline.contains(pt):
                        d = abs((a.c + s_ * a.t / 2.0) - (b.c + s_ * b.t / 2.0))
                        if 0.01 < d <= 0.10:
                            caras += 1
                        break
    except Exception:
        pass
    return {'puntas_libres': free, 'picos': picos, 'rendijas': rendijas, 'escalones': escalones,
            'muros_dobles': dobles, 'laminas': laminas,
            'salientes_chicos': chicos, 'caras_desalineadas': caras}


FID_STEP_M = 0.25  # tramo de muro que se compara con la tinta
FID_INKED = 0.30  # parte del tramo con trazo para decir "está en el plano"
PERIMETER_IDX = 5000  # muros inventados por complete_perimeter: no se recortan


def _crop(mask, px2m, region):
    x0, y0, x1, y1 = region.bounds
    H, W = mask.shape
    c0, c1 = max(0, int(x0 / px2m)), min(W, int(round(x1 / px2m)) + 1)
    r0, r1 = max(0, int(y0 / px2m)), min(H, int(round(y1 / px2m)) + 1)
    if c1 <= c0 or r1 <= r0:
        return None
    return mask[r0:r1, c0:c1]


def _chunk_inked(mask, px2m, w, a, b, pad=0.0):
    h = w.t / 2.0 + pad  # pad: tolerancia si el muro quedó corrido unos px
    crop = _crop(mask, px2m, _rect(w.horiz, a, b, w.c - h, w.c + h))
    if crop is None or crop.size == 0:
        return False
    along = crop.any(axis=0) if w.horiz else crop.any(axis=1)
    return float(along.mean()) >= FID_INKED


def fidelity_check(walls, openings, drawn, sketch=False):
    """
    Compara el 3D con el plano (la tinta del dibujo) y lo corrige:

    - Sobrantes: las puntas de muro sin tinta debajo se recortan de a tramos
      (salvo que el tramo toque otro muro o un vano: es una esquina o un
      cierre hecho a propósito). Los muros de complete_perimeter no se tocan.
    - Faltantes: tramos largos de pared dibujada (grosor de pared) sin
      ningún muro encima, que unen dos muros existentes, se agregan.

    Returns: (walls, informe {precision, cobertura, recortado_m, agregado_m})
    """
    import numpy as np
    from scipy import ndimage

    mask = getattr(drawn, 'mask', None) if drawn is not None else None
    px2m = getattr(drawn, 'px2m', None) if drawn is not None else None
    if mask is None or not px2m:
        return walls, None
    rect = [(p, e, i) for p, e, i in walls if _is_rect(p)]
    other = [(p, e, i) for p, e, i in walls if not _is_rect(p)]
    items = [_Wall(p, e, i) for p, e, i in rect]
    if not items:
        return walls, None

    # --- sobrantes ---
    trimmed = 0.0
    for w in items:
        if w.idx >= PERIMETER_IDX:
            continue
        others = [o.poly() for o in items if o is not w] + [p for p, _, _ in other]
        for end in ('lo', 'hi'):
            while w.length > FID_STEP_M * 1.5:
                if end == 'lo':
                    a, b = w.a0, w.a0 + FID_STEP_M
                else:
                    a, b = w.a1 - FID_STEP_M, w.a1
                if _chunk_inked(mask, px2m, w, a, b):
                    break
                h = w.t / 2.0
                zone = _rect(w.horiz, a, b, w.c - h, w.c + h).buffer(0.03)
                if any(zone.intersects(o) for o in others):
                    break  # esquina o unión: se cerró a propósito
                if any(zone.buffer(0.10).intersects(o) for o in openings):
                    break  # al lado de un vano
                if end == 'lo':
                    w.a0 = b
                else:
                    w.a1 = a
                trimmed += FID_STEP_M

    # --- muros de más: casi sin tinta en todo su largo ---
    def ink_fraction(w):
        tot_, ink_ = 0.0, 0.0
        a = w.a0
        while a < w.a1 - 1e-6:
            b = min(w.a1, a + FID_STEP_M)
            tot_ += b - a
            if _chunk_inked(mask, px2m, w, a, b):
                ink_ += b - a
            a = b
        return ink_ / tot_ if tot_ else 0.0

    def ends_on_walls(w, pool):
        n = 0
        for e in (w.a0, w.a1):
            pt = (Point(e, w.c) if w.horiz else Point(w.c, e)).buffer(w.t / 2.0 + 0.05)
            if any(o is not w and pt.intersects(o.poly()) for o in pool):
                n += 1
        return n

    removed = 0
    keep = []
    for w in items:
        near_open = any(w.poly().buffer(0.05).intersects(o) for o in openings)
        if w.idx >= PERIMETER_IDX:
            # tramo inventado para cerrar el contorno: sirve solo si une dos
            # muros y no está pegado a una pared real paralela
            real = [o for o in items if o.idx < PERIMETER_IDX]
            twin = any(o.horiz == w.horiz and abs(o.c - w.c) <= 0.30
                       and min(o.a1, w.a1) - max(o.a0, w.a0) > 0.5 * w.length for o in real)
            if twin or (ends_on_walls(w, items) < 2 and not near_open):
                removed += 1
                continue
        elif not near_open and ink_fraction(w) < FID_INKED and ends_on_walls(w, items) < 2:
            removed += 1
            continue
        keep.append(w)
    items = keep

    # --- precisión: parte del muro con tinta debajo ---
    tot = inked = 0.0
    for w in items:
        if w.idx >= PERIMETER_IDX:
            continue
        a = w.a0
        while a < w.a1 - 1e-6:
            b = min(w.a1, a + FID_STEP_M)
            tot += b - a
            if _chunk_inked(mask, px2m, w, a, b):
                inked += b - a
            a = b

    # --- faltantes y cobertura ---
    H, W = mask.shape
    t_px = max(2, int(round(_typical_t(items) / px2m)))
    k = max(2, int(t_px * 0.6))
    if sketch:  # en un boceto la pared es una línea fina: no se filtra por grosor
        wall_ink = ndimage.binary_opening(mask, structure=np.ones((2, 2), dtype=bool))
    else:
        wall_ink = ndimage.binary_opening(mask, structure=np.ones((k, k), dtype=bool))
    covered = np.zeros_like(mask)
    grow = max(2, int(0.10 / px2m))

    def paint(bounds, g):
        x0, y0, x1, y1 = bounds
        covered[max(0, int(y0 / px2m) - g):min(H, int(y1 / px2m) + g),
                max(0, int(x0 / px2m) - g):min(W, int(x1 / px2m) + g)] = True

    for w in items:
        paint(w.poly().bounds, grow)
    for p, _, _ in other:
        paint(p.bounds, 0)  # aproximado para diagonales
    for o in openings:
        paint(o.bounds, grow)
    ink_total = float(wall_ink.sum())
    coverage = float((wall_ink & covered).sum()) / ink_total if ink_total else 1.0

    added = 0.0
    missing = wall_ink & ~covered
    min_len = max(4, int(0.50 / px2m))
    next_idx = max((w.idx for w in items), default=0) + 7000
    for horiz in (() if sketch else (True, False)):  # boceto: ya lo hace sketch.py
        size = (1, min_len) if horiz else (min_len, 1)
        runs = ndimage.binary_opening(missing, structure=np.ones(size, dtype=bool))
        labels, _ = ndimage.label(runs)
        for sl in ndimage.find_objects(labels):
            if sl is None:
                continue
            ys, xs = sl
            thick = (ys.stop - ys.start) if horiz else (xs.stop - xs.start)
            if not (0.5 * t_px <= thick <= 2.0 * t_px):
                continue  # mueble macizo o línea fina
            poly = box(xs.start * px2m, ys.start * px2m, xs.stop * px2m, ys.stop * px2m)
            nw = _Wall(poly, False, next_idx)
            ok = 0
            for e in (nw.a0, nw.a1):
                pt = (Point(e, nw.c) if horiz else Point(nw.c, e)).buffer(0.15)
                if any(pt.intersects(o.poly()) for o in items):
                    ok += 1
            if ok == 2:  # une dos muros: es una pared que faltaba
                items.append(nw)
                next_idx += 1
                added += nw.length

    report = {
        'precision': round(inked / tot, 3) if tot else None,
        'cobertura': round(coverage, 3),
        'recortado_m': round(trimmed, 2),
        'agregado_m': round(added, 2),
        'muros_sin_tinta': removed,
    }
    return [(w.poly(), w.ext, w.idx) for w in items if w.length > 0.05] + other, report


# ---------------------------------------------------------------------------
# Auditoría final: todo muro del 3D tiene que estar dibujado en el plano
# ---------------------------------------------------------------------------
AUDIT_GAP_M = 0.40  # hueco sin tinta tolerado (esquinas, uniones)
AUDIT_PERIM_MAX_M = 1.50  # tramo inventado por complete_perimeter: máximo
COPY_GAP_M = 0.35  # copia paralela: caras a esto o menos y sin tinta entre ellas
AUDIT_MIN_INK = 0.60  # para el informe: muro "dibujado" si tiene >= 60 % de tinta


AUDIT_PAD_M = 0.06  # el muro puede estar corrido unos cm de su línea dibujada


def _inked_flags(mask, px2m, w):
    """[(a, b, con_tinta)] tramos de FID_STEP_M a lo largo de w."""
    out = []
    a = w.a0
    while a < w.a1 - 1e-6:
        b = min(w.a1, a + FID_STEP_M)
        out.append((a, b, _chunk_inked(mask, px2m, w, a, b, pad=AUDIT_PAD_M)))
        a = b
    return out


def _ink_ratio_wall(mask, px2m, w):
    flags = _inked_flags(mask, px2m, w)
    tot = sum(b - a for a, b, _ in flags)
    return sum(b - a for a, b, f in flags if f) / tot if tot else 0.0


def _remove_parallel_copies(items, mask, px2m):
    """
    Dos muros paralelos muy cerca (caras a <= 35 cm), que se superponen más
    de la mitad y SIN tinta entre ellos: uno es copia del otro (la IA, Gemini
    y el detector vieron el mismo muro corrido). Se borra el de menos tinta.
    Así no queda un muro entero delante de una puerta.
    """
    removed = set()
    for i, a in enumerate(items):
        for b in items[i + 1:]:
            if id(a) in removed or id(b) in removed or a.horiz != b.horiz:
                continue
            lo, hi = max(a.a0, b.a0), min(a.a1, b.a1)
            if hi - lo < 0.5 * min(a.length, b.length):
                continue
            near_a, far_a = sorted((a.c, b.c))
            gap = (far_a - near_a) - (a.t + b.t) / 2.0
            if gap > COPY_GAP_M or abs(a.c - b.c) < 1e-6:
                continue
            if gap > 0.02:
                # ¿hay tinta en la franja entre los dos? (entonces son dos muros)
                c0 = near_a + (a.t if a.c == near_a else b.t) / 2.0
                c1 = far_a - (b.t if b.c == far_a else a.t) / 2.0
                between = _Wall(_rect(a.horiz, lo, hi, c0, c1), False, -1)
                if _ink_ratio_wall(mask, px2m, between) > 0.5:
                    continue
            ra, rb = _ink_ratio_wall(mask, px2m, a), _ink_ratio_wall(mask, px2m, b)
            loser = a if (ra, a.length) < (rb, b.length) else b
            removed.add(id(loser))
    return [w for w in items if id(w) not in removed], len(removed)


def ink_audit(walls, openings, drawn):
    """
    Regla final del 3D: "lo que no está dibujado, no va".

    - Muros copia paralelos (sin tinta entre ellos): se borra la copia.
    - Cada muro recto se recorre en tramos de 25 cm: un tramo sin tinta de
      más de 40 cm (que no toca un vano) parte el muro y se quita. Se
      toleran huecos cortos (esquinas, uniones) y la parte sobre un vano.
    - Tramos inventados por complete_perimeter: solo si son cortos
      (<= 1,5 m) y cierran entre dos muros.

    Returns: (walls, informe)
    """
    mask = getattr(drawn, 'audit_mask', None) if drawn is not None else None
    if mask is None and drawn is not None:
        mask = getattr(drawn, 'mask', None)
    px2m = getattr(drawn, 'px2m', None) if drawn is not None else None
    if mask is None or not px2m:
        return walls, None
    rect = [(p, e, i) for p, e, i in walls if _is_rect(p)]
    other = [(p, e, i) for p, e, i in walls if not _is_rect(p)]
    items = [_Wall(p, e, i) for p, e, i in rect]
    items, copies = _remove_parallel_copies(items, mask, px2m)

    def ends_on_walls(w, pool):
        n = 0
        for e in (w.a0, w.a1):
            pt = (Point(e, w.c) if w.horiz else Point(w.c, e)).buffer(w.t / 2.0 + 0.05)
            if any(o is not w and pt.intersects(o.poly()) for o in pool):
                n += 1
        return n

    out, removed, cut_m = [], 0, 0.0
    for w in items:
        # Los tramos del contorno (complete_perimeter) se revisan igual que
        # cualquier muro: si la pared está dibujada (aunque sea rayada) quedan.
        # Un tramo corto que cierra entre dos muros se admite sin tinta.
        if w.idx >= PERIMETER_IDX and w.length <= AUDIT_PERIM_MAX_M and ends_on_walls(w, items) == 2:
            out.append(w)
            continue
        h = w.t / 2.0
        flags = []
        for a, b, inked in _inked_flags(mask, px2m, w):
            zone = _rect(w.horiz, a, b, w.c - h, w.c + h).buffer(0.05)
            excused = any(zone.intersects(o) for o in openings)
            flags.append((a, b, inked or excused))
        # tramos sin tinta largos parten el muro
        pieces, cur, gap_start = [], None, None
        for a, b, ok in flags:
            if ok:
                if cur is None:
                    cur = [a, b]
                elif gap_start is not None and a - gap_start > AUDIT_GAP_M:
                    pieces.append(cur)
                    cur = [a, b]
                else:
                    cur[1] = b
                gap_start = None
            elif gap_start is None:
                gap_start = a
        if cur is not None:
            pieces.append(cur)
        # puntas sin tinta cortas (cierre de esquina hecho a propósito)
        if pieces:
            if pieces[0][0] - w.a0 <= AUDIT_GAP_M:
                pieces[0][0] = w.a0
            if w.a1 - pieces[-1][1] <= AUDIT_GAP_M:
                pieces[-1][1] = w.a1
        kept = sum(b - a for a, b in pieces)
        if not pieces:
            removed += 1
            cut_m += w.length
            continue
        cut_m += max(0.0, w.length - kept)
        for a, b in pieces:
            if b - a >= 0.10:
                out.append(_Wall(_rect(w.horiz, a, b, w.c - h, w.c + h), w.ext, w.idx))
    report = {
        'copias_borradas': copies,
        'muros_borrados': removed,
        'metros_quitados': round(cut_m, 2),
        'muros_sin_tinta_final': sum(
            1 for w in out if w.idx < PERIMETER_IDX and w.length > AUDIT_GAP_M
            and not any(w.poly().buffer(0.05).intersects(o) for o in openings)
            and _ink_ratio_wall(mask, px2m, w) < AUDIT_MIN_INK),
    }
    return [(w.poly(), w.ext, w.idx) for w in out] + other, report


# ---------------------------------------------------------------------------
# Fidelidad píxel a píxel: el plano manda
# ---------------------------------------------------------------------------
PX_PAD_M = 0.06  # tolerancia de posición (muro corrido unos cm de su línea)
PX_EXTRA_M = 0.20  # tramo de muro sin pared dibujada de más de esto: se quita
PX_END_M = 0.25  # punta de muro que cierra una unión: puede no tener tinta
PX_SLIT_M = 0.15  # rendija entre piezas que se cierra si hay pared dibujada
PX_MISSING_M = 0.50  # pared dibujada sin muro de al menos esto: se agrega
PX_REVIEW_F1 = 0.80  # coincidencia mínima sin aviso de "revisar este plano"
PX_TEXT_M = 0.40  # manchas más chicas que esto (textos, símbolos) no son pared


def _raster(polys, shape, px2m):
    """Dibuja polígonos (metros) en una máscara del tamaño del plano."""
    import numpy as np
    from PIL import Image, ImageDraw
    H, W = shape
    im = Image.new('1', (W, H), 0)
    d = ImageDraw.Draw(im)
    for p in polys:
        for g in getattr(p, 'geoms', [p]):
            if g.is_empty or g.geom_type != 'Polygon':
                continue
            pts = [(x / px2m, y / px2m) for x, y in g.exterior.coords]
            if len(pts) >= 3:
                d.polygon(pts, fill=1)
    return np.array(im, dtype=bool)


def pixel_fidelity(walls, openings, drawn, sketch=False):
    """
    Compara el 3D con el plano píxel a píxel y lo corrige:

    1. Sobrantes: tramos de muro de más de 20 cm sin pared dibujada debajo
       (a 6 cm o menos) se quitan; si no queda nada, el muro se borra.
       Las puntas que cierran una unión (<= 25 cm) y lo que toca un vano
       se toleran.
    2. Rendijas: ranuras de hasta 15 cm entre piezas de muro donde el plano
       SÍ tiene pared: se rellenan (sin rendijas verticales en el 3D).
    3. Faltantes: pared dibujada (grosor de pared, sin textos) de 50 cm o
       más sin muro encima, que une dos muros, se agrega.

    Returns: (walls, informe, imagen de control PIL o None)
    """
    import numpy as np
    from scipy import ndimage

    mask = getattr(drawn, 'audit_mask', None) if drawn is not None else None
    px2m = getattr(drawn, 'px2m', None) if drawn is not None else None
    if mask is None or not px2m:
        return walls, None, None
    H, W = mask.shape
    rect = [(p, e, i) for p, e, i in walls if _is_rect(p)]
    other = [(p, e, i) for p, e, i in walls if not _is_rect(p)]
    items = [_Wall(p, e, i) for p, e, i in rect]
    if not items:
        return walls, None, None

    pad = int(round(PX_PAD_M / px2m)) + 1
    mask_d = ndimage.binary_dilation(mask, iterations=pad)
    open_r = _raster([o.buffer(0.05) for o in openings], mask.shape, px2m)

    # pared dibujada "de verdad": sin líneas finas (cotas, grilla) ni textos
    t_px = max(2, int(round(_typical_t(items) / px2m)))
    # grosor de pared: líneas finas de muebles, cotas y grilla quedan fuera.
    # Antes se cierran los huecos chicos: una pared RAYADA (dos líneas con
    # rulos) cuenta como pared, igual que una maciza.
    k = 2 if sketch else max(3, int(round(t_px * 0.6)))
    kc = 1 if sketch else max(3, int(round(0.05 / px2m)) | 1)
    base = mask if kc <= 1 else ndimage.binary_closing(mask, structure=np.ones((kc, kc), dtype=bool))
    ink = ndimage.binary_opening(base, structure=np.ones((k, k), dtype=bool))
    labels, _ = ndimage.label(ink)
    min_blob = PX_TEXT_M / px2m
    keep_lab = np.zeros(labels.max() + 1, dtype=bool)
    for li, sl in enumerate(ndimage.find_objects(labels), start=1):
        if sl is not None and max(sl[0].stop - sl[0].start, sl[1].stop - sl[1].start) >= min_blob:
            keep_lab[li] = True
    ink = keep_lab[labels] & ~open_r
    # solo DENTRO de la casa: cotas, barandas de terraza y el marco del plano
    # quedan afuera del contorno de los muros
    all_w = _raster([w.poly() for w in items] + [p for p, _, _ in other], mask.shape, px2m)
    house = ndimage.binary_fill_holes(
        ndimage.binary_dilation(all_w, iterations=max(2, int(round(0.30 / px2m)))))
    ink &= house
    # una pared es un trazo RECTO de al menos 50 cm: las palabras y números
    # ("Habitación", "ALCOBA", cotas escritas) no tienen tramos tan largos
    run = max(4, int(round(PX_MISSING_M / px2m)))
    ink = (ndimage.binary_opening(ink, structure=np.ones((1, run), dtype=bool))
           | ndimage.binary_opening(ink, structure=np.ones((run, 1), dtype=bool)))

    def touches_other(w, a, b, pool):
        h = w.t / 2.0
        zone = _rect(w.horiz, a, b, w.c - h, w.c + h).buffer(0.04)
        return any(o is not w and zone.intersects(o.poly()) for o in pool)

    # --- 1. sobrantes ---
    out, cut_m, removed = [], 0.0, 0
    for w in items:
        if w.idx >= PERIMETER_IDX and w.length <= AUDIT_PERIM_MAX_M:
            out.append(w)  # cierre corto del contorno entre dos muros
            continue
        n = max(1, int(round(w.length / px2m)))
        alongs = np.linspace(w.a0, w.a1, n + 1)
        h = w.t / 2.0
        ok = np.zeros(n, dtype=bool)
        for j in range(n):
            a, b = alongs[j], alongs[j + 1]
            region = _rect(w.horiz, a, b, w.c - h, w.c + h)
            x0, y0, x1, y1 = region.bounds
            c0, c1 = max(0, int(x0 / px2m)), min(W, int(np.ceil(x1 / px2m)) + 1)
            r0, r1 = max(0, int(y0 / px2m)), min(H, int(np.ceil(y1 / px2m)) + 1)
            if c1 <= c0 or r1 <= r0:
                continue
            ok[j] = mask_d[r0:r1, c0:c1].any() or open_r[r0:r1, c0:c1].any()
        # puntas que cierran una unión
        end_px = int(round(PX_END_M / px2m))
        if touches_other(w, w.a0, w.a0 + 0.02, items):
            ok[:end_px] = True
        if touches_other(w, w.a1 - 0.02, w.a1, items):
            ok[max(0, n - end_px):] = True
        # tramos sin pared dibujada de más de 20 cm se quitan; los cortos
        # (uniones, imprecisión) se toleran
        min_bad = PX_EXTRA_M / px2m
        keep_mask = ok.copy()
        j = 0
        while j < n:
            if not ok[j]:
                k2 = j
                while k2 < n and not ok[k2]:
                    k2 += 1
                if k2 - j <= min_bad:
                    keep_mask[j:k2] = True
                j = k2
            else:
                j += 1
        pieces = []
        j = 0
        while j < n:
            if keep_mask[j]:
                k2 = j
                while k2 < n and keep_mask[k2]:
                    k2 += 1
                pieces.append((j, k2))
                j = k2
            else:
                j += 1
        if not pieces:
            removed += 1
            cut_m += w.length
            continue
        kept = 0.0
        for s_, e_ in pieces:
            a, b = alongs[s_], alongs[e_]
            if b - a >= 0.10:
                out.append(_Wall(_rect(w.horiz, a, b, w.c - h, w.c + h), w.ext, w.idx))
                kept += b - a
        cut_m += max(0.0, w.length - kept)
    items = out

    def wall_raster():
        polys = [w.poly() for w in items] + [p for p, _, _ in other]
        return _raster(polys, mask.shape, px2m) & ~open_r

    # --- 2. rendijas ---
    wr = wall_raster()
    s = max(3, int(round(PX_SLIT_M / px2m)))
    closed = ndimage.binary_closing(wr, structure=np.ones((s, s), dtype=bool))
    slit = closed & ~wr & mask_d & ~open_r
    slit = ndimage.binary_opening(slit, structure=np.ones((2, 2), dtype=bool))
    lab, nlab = ndimage.label(slit)
    patches = 0
    next_idx = max((w.idx for w in items), default=0) + 8000
    for sl in ndimage.find_objects(lab):
        if sl is None:
            continue
        ys, xs = sl
        poly = box(xs.start * px2m, ys.start * px2m, xs.stop * px2m, ys.stop * px2m)
        nw = _Wall(poly, False, next_idx)
        next_idx += 1
        nw.t = max(nw.t, MIN_WALL_T_M)
        items.append(nw)
        patches += 1

    # --- 3. faltantes ---
    wr = wall_raster()
    # a mano la línea se inclina: el muro puede quedar más lejos de su tinta
    near_m = 0.18 if sketch else 0.08
    near_w = ndimage.binary_dilation(wr, iterations=max(2, int(round(near_m / px2m))))
    missing = ink & ~near_w
    min_len = max(4, int(round(PX_MISSING_M / px2m)))
    added = 0.0
    # dos vueltas: en una esquina vacía, el segundo tramo se une al primero
    for horiz in (True, False, True, False):
        wr = wall_raster()
        near_w = ndimage.binary_dilation(wr, iterations=max(2, int(round(near_m / px2m))))
        missing = ink & ~near_w
        size = (1, min_len) if horiz else (min_len, 1)
        runs = ndimage.binary_opening(missing, structure=np.ones(size, dtype=bool))
        lab, _ = ndimage.label(runs)
        for sl in ndimage.find_objects(lab):
            if sl is None:
                continue
            ys, xs = sl
            thick = (ys.stop - ys.start) if horiz else (xs.stop - xs.start)
            lo_t, hi_t = (2, 3 * t_px) if sketch else (0.5 * t_px, 2.0 * t_px)
            if not (lo_t <= thick <= hi_t):
                continue
            poly = box(xs.start * px2m, ys.start * px2m, xs.stop * px2m, ys.stop * px2m)
            nw = _Wall(poly, False, next_idx)
            ends = 0
            for e in (nw.a0, nw.a1):
                pt = (Point(e, nw.c) if nw.horiz else Point(nw.c, e)).buffer(0.15)
                # la punta toca un muro o el marco de una puerta/ventana
                if any(pt.intersects(o.poly()) for o in items) or any(pt.intersects(o) for o in openings):
                    ends += 1
            # nunca una copia: si ya hay un muro paralelo a <= 35 cm que lo
            # cubre en buena parte, esa tinta ya está representada
            twin = any(o.horiz == nw.horiz and abs(o.c - nw.c) <= COPY_GAP_M + (o.t + nw.t) / 2.0
                       and min(o.a1, nw.a1) - max(o.a0, nw.a0) > 0.3 * nw.length for o in items)
            if ends == 2 and not twin:
                nw.t = max(nw.t, MIN_WALL_T_M)
                items.append(nw)
                next_idx += 1
                added += nw.length

    # --- medición final y control ---
    wr = wall_raster()
    near_w = ndimage.binary_dilation(wr, iterations=pad)
    extra = wr & ~mask_d
    falta = ink & ~near_w
    w_tot = float(wr.sum()) or 1.0
    i_tot = float(ink.sum()) or 1.0
    precision = 1.0 - float(extra.sum()) / w_tot
    recall = 1.0 - float(falta.sum()) / i_tot
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    report = {
        'coincidencia': round(f1, 3),
        'precision': round(precision, 3),
        'cobertura': round(recall, 3),
        'sobrante_m2': round(float(extra.sum()) * px2m * px2m, 2),
        'faltante_m2': round(float(falta.sum()) * px2m * px2m, 2),
        'recortado_m': round(cut_m, 2),
        'muros_borrados': removed,
        'rendijas_cerradas': patches,
        'agregado_m': round(added, 2),
    }
    # aviso al usuario: el 3D no coincide lo suficiente con el plano
    report['revisar'] = bool(f1 < PX_REVIEW_F1)

    control = None
    base = getattr(drawn, 'image', None)
    try:
        from PIL import Image
        if base is not None:
            arr = np.asarray(base.convert('L').convert('RGB'), dtype=np.float32)
            arr = 255 - (255 - arr) * 0.45  # plano de fondo aclarado
            ok_m = wr & mask_d
            arr[ok_m] = (40, 170, 70)  # coincide
            arr[falta] = (40, 90, 230)  # pared dibujada que falta
            arr[extra] = (230, 40, 40)  # muro que sobra
            control = Image.fromarray(arr.clip(0, 255).astype('uint8'))
    except Exception:
        control = None
    return [(w.poly(), w.ext, w.idx) for w in items if w.length > 0.05] + other, report, control


# ---------------------------------------------------------------------------
# Grosor real de cada muro, medido en el dibujo
# ---------------------------------------------------------------------------
FIT_MAX_T_M = 0.45  # grosor máximo que se acepta para un muro
FIT_SAMPLES = 12


def fit_wall_thickness(walls, drawn):
    """
    Cada muro toma el grosor y la posición de la franja que lo dibuja en el
    plano. Una pared exterior rayada (dos líneas con rulos) mide 25-30 cm:
    si el muro quedó fino sobre una de sus líneas, la fachada sale
    escalonada y las ventanas quedan corridas. Aquí se mide la franja
    (cerrando los huecos del rayado) en varios puntos y se usa la mediana.
    """
    import numpy as np
    from scipy import ndimage

    mask = getattr(drawn, 'audit_mask', None) if drawn is not None else None
    px2m = getattr(drawn, 'px2m', None) if drawn is not None else None
    if mask is None or not px2m:
        return walls, 0
    H, W = mask.shape
    k = max(3, int(round(0.05 / px2m)) | 1)
    solid = ndimage.binary_closing(mask, structure=np.ones((k, k), dtype=bool))
    reach = int(round(FIT_MAX_T_M / px2m))
    rect = [(p, e, i) for p, e, i in walls if _is_rect(p)]
    other = [(p, e, i) for p, e, i in walls if not _is_rect(p)]
    out, changed = [], 0
    for p, e, i in rect:
        w = _Wall(p, e, i)
        lows, highs = [], []
        for j in range(FIT_SAMPLES):
            a = w.a0 + (j + 0.5) / FIT_SAMPLES * w.length
            ap = int(round(a / px2m))
            cp = int(round(w.c / px2m))
            if w.horiz:
                if not (0 <= ap < W):
                    continue
                line = solid[max(0, cp - reach):min(H, cp + reach + 1), ap]
                off = max(0, cp - reach)
            else:
                if not (0 <= ap < H):
                    continue
                line = solid[ap, max(0, cp - reach):min(W, cp + reach + 1)]
                off = max(0, cp - reach)
            center = cp - off
            if not (0 <= center < line.size) or not line[center]:
                # el eje del muro no cae sobre la tinta: buscar la más cercana
                idx = np.flatnonzero(line)
                if idx.size == 0:
                    continue
                center = int(idx[np.argmin(np.abs(idx - center))])
                if abs(center - (cp - off)) * px2m > w.t / 2.0 + 0.06:
                    continue
            lo = hi = center
            while lo - 1 >= 0 and line[lo - 1]:
                lo -= 1
            while hi + 1 < line.size and line[hi + 1]:
                hi += 1
            lows.append((lo + off) * px2m)
            highs.append((hi + 1 + off) * px2m)
        if len(lows) >= FIT_SAMPLES // 2:
            c0, c1 = float(np.median(lows)), float(np.median(highs))
            t_new = c1 - c0
            # solo si la franja es razonable y distinta de lo que había
            if MIN_WALL_T_M <= t_new <= FIT_MAX_T_M and (abs(t_new - w.t) > 0.03
                                                          or abs((c0 + c1) / 2 - w.c) > 0.03):
                w.c, w.t = (c0 + c1) / 2.0, t_new
                changed += 1
        out.append(w)
    # Tramos seguidos de una misma pared (misma línea, casi pegados) toman la
    # franja de su tramo más largo: sin escalones en la fachada.
    for horiz in (True, False):
        group = sorted([w for w in out if w.horiz == horiz], key=lambda w: w.c)
        used = set()
        for w in group:
            if id(w) in used:
                continue
            cluster = [w]
            for o in group:
                if o is w or id(o) in used:
                    continue
                if abs(o.c - w.c) <= 0.20 and any(
                        max(o.a0, m.a0) - min(o.a1, m.a1) <= 0.60 for m in cluster):
                    cluster.append(o)
            if len(cluster) > 1:
                ref = max(cluster, key=lambda m: m.length)
                for m in cluster:
                    m.c, m.t = ref.c, ref.t
            for m in cluster:
                used.add(id(m))
    return [(w.poly(), w.ext, w.idx) for w in out] + other, changed
