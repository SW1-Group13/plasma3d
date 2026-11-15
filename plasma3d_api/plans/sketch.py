# plans/sketch.py
"""
Modo boceto: planos dibujados a mano (marcador de color, birome, lápiz).

En un boceto las paredes son una sola línea fina, algo torcida y temblorosa,
mezclada con letras, cotas y flechas del mismo color. Los detectores de
píxeles confunden letras con muros y pierden las líneas inclinadas.

Estrategia:
  1. Gemini dice QUÉ líneas son muros (entiende texto, flechas, cotas).
  2. Cada muro de Gemini se "imanta" a la tinta real: se recorre la línea
     por tramos siguiendo el trazo (tolera inclinación y temblor) y se
     queda solo donde hay tinta. Los cortes largos (puertas) se respetan.
"""
import numpy as np
from scipy import ndimage

from .cv_walls import contrast_mask, stroke_mask

CHUNK_FRAC = 0.025   # largo de cada tramo de seguimiento (fracción de la imagen)
SEARCH_FRAC = 0.035  # cuánto puede estar corrida la línea de Gemini
MIN_WALL_FRAC = 0.03  # muro más corto que se acepta


def is_sketch(cv):
    """Boceto: el detector tuvo que usar tinta de color o las líneas son finas."""
    t = cv.get('thickness_px') or 0
    # o el detector normal no encontró casi nada (lápiz muy claro)
    return cv.get('mask') == 'contraste' or (0 < t <= 5) or len(cv.get('walls') or []) < 4


def ink_mask(image):
    # contraste con el papel LOCAL (no gris global): sombras de foto fuera
    ink = contrast_mask(image)
    # quitar puntos sueltos (polvo del escaneo)
    ink = ndimage.binary_opening(ink, structure=np.ones((2, 2), dtype=bool))
    # Borde de la hoja / sombra del escáner: nunca es una pared.
    m = max(3, int(0.015 * max(ink.shape)))
    ink[:m, :] = False
    ink[-m:, :] = False
    ink[:, :m] = False
    ink[:, -m:] = False
    # Quitar trazos sueltos chicos: letras, números, puntos de los arcos de
    # puerta, rayas de líneas punteadas. Las paredes son trazos largos.
    S = max(ink.shape)
    labels, _ = ndimage.label(ink, structure=np.ones((3, 3), dtype=bool))
    keep = np.zeros(labels.max() + 1, dtype=bool)
    for i, sl in enumerate(ndimage.find_objects(labels), start=1):
        if sl is None:
            continue
        ys, xs = sl
        if max(ys.stop - ys.start, xs.stop - xs.start) >= 0.06 * S:
            keep[i] = True
    return keep[labels]


def _peaks(profile, min_val, min_sep):
    """Máximos locales de un perfil de tinta (posibles líneas de pared)."""
    sm = np.convolve(profile, np.ones(9) / 9.0, mode='same')
    order = np.argsort(sm)[::-1]
    taken = []
    for i in order:
        if sm[i] < min_val:
            break
        if all(abs(i - j) >= min_sep for j in taken):
            taken.append(int(i))
    return taken


def _dedupe(boxes, tol):
    """Une cajas de muro repetidas (misma línea, se superponen)."""
    out = []
    for b in sorted(boxes, key=lambda b: -max(b['x2'] - b['x1'], b['y2'] - b['y1'])):
        h = (b['x2'] - b['x1']) >= (b['y2'] - b['y1'])
        merged = False
        for o in out:
            oh = (o['x2'] - o['x1']) >= (o['y2'] - o['y1'])
            if oh != h:
                continue
            if h:
                same = abs((b['y1'] + b['y2']) - (o['y1'] + o['y2'])) / 2.0 <= tol
                ov = min(b['x2'], o['x2']) - max(b['x1'], o['x1'])
            else:
                same = abs((b['x1'] + b['x2']) - (o['x1'] + o['x2'])) / 2.0 <= tol
                ov = min(b['y2'], o['y2']) - max(b['y1'], o['y1'])
            if same and ov > -tol:
                for k in ('x1', 'y1'):
                    o[k] = min(o[k], b[k])
                for k in ('x2', 'y2'):
                    o[k] = max(o[k], b[k])
                merged = True
                break
        if not merged:
            out.append(dict(b))
    return out


def sketch_walls(image, gem_walls=()):
    """
    Muros de un boceto SIN depender de Gemini: candidatos = líneas con mucha
    tinta (filas/columnas) + los muros que diga Gemini; cada candidato se
    ajusta a la tinta real con snap_walls y al final se unen repetidos.
    """
    ink = ink_mask(image)
    H, W = ink.shape
    S = max(H, W)
    sep = max(6, int(0.012 * S))  # paredes cercanas (p. ej. a 20 cm) no se tapan entre sí
    cands = []
    for y in _peaks(ink.sum(axis=1).astype(float), 0.08 * W, sep):
        cands.append({'x1': 0, 'y1': y, 'x2': W - 1, 'y2': y, 'search': sep // 2})
    for x in _peaks(ink.sum(axis=0).astype(float), 0.08 * H, sep):
        cands.append({'x1': x, 'y1': 0, 'x2': x, 'y2': H - 1, 'search': sep // 2})
    cands += list(gem_walls or [])
    walls = snap_walls(image, cands, ink=ink)
    walls = _dedupe(walls, tol=max(6, int(0.012 * S)))
    walls = _connected(walls, pad=int(0.025 * S), long_len=0.15 * S)
    return close_corners(walls, reach=int(0.03 * S))


def close_corners(walls, reach):
    """
    Esquinas y uniones en T que a mano no llegaron a tocarse: si la punta de
    una pared queda a <= reach de la línea de una perpendicular, se estira
    hasta ella; y si la perpendicular tampoco llega (esquina en L), se
    estira también. reach es menor que una puerta: los vanos no se tapan.
    """
    walls = [dict(w) for w in walls]

    def is_h(b):
        return (b['x2'] - b['x1']) >= (b['y2'] - b['y1'])

    for w in walls:
        h = is_h(w)
        c = (w['y1'] + w['y2']) / 2.0 if h else (w['x1'] + w['x2']) / 2.0
        for end in ('lo', 'hi'):
            e = (w['x1'] if end == 'lo' else w['x2']) if h else (w['y1'] if end == 'lo' else w['y2'])
            best = None
            for o in walls:
                if o is w or is_h(o) == h:
                    continue
                line = (o['x1'] + o['x2']) / 2.0 if h else (o['y1'] + o['y2']) / 2.0
                half = ((o['x2'] - o['x1']) if h else (o['y2'] - o['y1'])) / 2.0
                o_lo, o_hi = (o['y1'], o['y2']) if h else (o['x1'], o['x2'])
                # la perpendicular pasa (o casi) por el eje de esta pared
                if not (o_lo - reach <= c <= o_hi + reach):
                    continue
                d = (line - e) if end == 'hi' else (e - line)
                if -half <= d <= reach and (best is None or abs(d) < abs(best[0])):
                    best = (d, line, half, o, o_lo, o_hi)
            if best is None:
                continue
            d, line, half, o, o_lo, o_hi = best
            target = line + half if end == 'hi' else line - half
            if h:
                if end == 'hi':
                    w['x2'] = max(w['x2'], int(round(target)))
                else:
                    w['x1'] = min(w['x1'], int(round(target)))
            else:
                if end == 'hi':
                    w['y2'] = max(w['y2'], int(round(target)))
                else:
                    w['y1'] = min(w['y1'], int(round(target)))
            # esquina en L: la perpendicular también se estira hasta este eje
            th = ((w['y2'] - w['y1']) if h else (w['x2'] - w['x1'])) / 2.0
            if c < o_lo:
                if h:
                    o['y1'] = int(round(c - th))
                else:
                    o['x1'] = int(round(c - th))
            elif c > o_hi:
                if h:
                    o['y2'] = int(round(c + th))
                else:
                    o['x2'] = int(round(c + th))
    return walls


def _connected(walls, pad, long_len):
    """
    En un boceto toda pared toca otra en al menos una punta. Lo suelto
    (renglones de texto, guiones, flechas) se descarta, salvo que sea largo.
    Se poda en varias vueltas: lo que colgaba de un descartado también cae.
    """
    def ends(b):
        if (b['x2'] - b['x1']) >= (b['y2'] - b['y1']):
            c = (b['y1'] + b['y2']) / 2.0
            return (b['x1'], c), (b['x2'], c)
        c = (b['x1'] + b['x2']) / 2.0
        return (c, b['y1']), (c, b['y2'])

    def touches(pt, o):
        return o['x1'] - pad <= pt[0] <= o['x2'] + pad and o['y1'] - pad <= pt[1] <= o['y2'] + pad

    def crosses(w, o):
        """w corto atraviesa o por su mitad (flecha, cota): no termina en ella."""
        wh = (w['x2'] - w['x1']) >= (w['y2'] - w['y1'])
        oh = (o['x2'] - o['x1']) >= (o['y2'] - o['y1'])
        if wh == oh:
            return False
        # también vale cruzar la línea de la pared en un hueco (p. ej. la
        # flecha de ENTRADA atraviesa el vano de la puerta)
        ext_ = 2 * pad
        if wh:
            line, lo_, hi_ = (o['x1'] + o['x2']) / 2.0, w['x1'], w['x2']
            inside = o['y1'] - ext_ <= (w['y1'] + w['y2']) / 2.0 <= o['y2'] + ext_
        else:
            line, lo_, hi_ = (o['y1'] + o['y2']) / 2.0, w['y1'], w['y2']
            inside = o['x1'] - ext_ <= (w['x1'] + w['x2']) / 2.0 <= o['x2'] + ext_
        margin = 0.25 * (hi_ - lo_)
        return inside and lo_ + margin < line < hi_ - margin

    walls = [w for w in walls
             if max(w['x2'] - w['x1'], w['y2'] - w['y1']) >= long_len * 0.6
             or not any(o is not w and crosses(w, o) for o in walls)]
    keep = list(walls)
    while True:
        nxt = []
        for w in keep:
            length = max(w['x2'] - w['x1'], w['y2'] - w['y1'])
            if length >= long_len or any(
                    o is not w and touches(p, o) for p in ends(w) for o in keep):
                nxt.append(w)
        if len(nxt) == len(keep):
            return nxt
        keep = nxt


def _coverage(ink, horiz, a, b, c):
    H, W = ink.shape
    if horiz:
        if not 1 <= c < H - 1:
            return 0.0
        band = ink[c - 1:c + 2, max(0, a):min(W, b)]
        return float(band.any(axis=0).mean()) if band.size else 0.0
    if not 1 <= c < W - 1:
        return 0.0
    band = ink[max(0, a):min(H, b), c - 1:c + 2]
    return float(band.any(axis=1).mean()) if band.size else 0.0


def _track(ink, horiz, a0, a1, c0, chunk, search, follow):
    """
    Recorre el eje (a0..a1) por tramos; en cada tramo busca la posición
    transversal con más tinta cerca de la anterior (sigue líneas torcidas).
    Devuelve [(a_ini, a_fin, c, con_tinta)].
    """
    # 1) posición global: la que tiene más tinta a lo largo de TODO el muro
    #    (una palabra cerca de una punta no le gana a la línea entera).
    best_g, best_gcov = int(c0), -1.0
    for c in range(int(c0 - search), int(c0 + search) + 1):
        cov = _coverage(ink, horiz, a0, a1, c)
        if cov > best_gcov:
            best_g, best_gcov = c, cov
    # 2) seguimiento por tramos alrededor de esa línea (inclinación/temblor),
    #    en los dos sentidos: una punta torcida se alcanza desde el otro lado.
    spans = []
    a = a0
    while a < a1:
        spans.append((a, min(a1, a + chunk)))
        a += chunk

    def run(order):
        res = {}
        c_prev = None
        for i in order:
            a, b = spans[i]
            center = best_g if c_prev is None else c_prev
            if abs(center - best_g) > search:  # no alejarse de la línea global
                center = best_g
            best_c, best_cov = None, -1.0
            for c in range(int(center - follow), int(center + follow) + 1):
                cov = _coverage(ink, horiz, a, b, c)
                # a igual cobertura, la más cercana al centro esperado
                if cov > best_cov + 1e-6 or (abs(cov - best_cov) <= 1e-6
                                             and abs(c - center) < abs(best_c - center)):
                    best_c, best_cov = c, cov
            inked = best_cov >= 0.6
            if inked:
                c_prev = best_c
            res[i] = (best_c, inked)
        return res

    fwd = run(range(len(spans)))
    bwd = run(range(len(spans) - 1, -1, -1))
    out = []
    for i, (a, b) in enumerate(spans):
        cf, inf = fwd[i]
        cb, inb = bwd[i]
        if inf or inb:
            out.append((a, b, cf if inf else cb, True))
        else:
            out.append((a, b, best_g, False))
    return out


def snap_walls(image, gem_walls, gap_px=None, ink=None):
    """
    Muros de Gemini ajustados a la tinta del boceto.

    Args:
        image: PIL.Image.
        gem_walls: [{x1,y1,x2,y2}] en píxeles (de gemini_plan.read_plan).
        gap_px: corte mínimo (px) que se respeta como hueco/puerta.

    Returns:
        [{x1,y1,x2,y2}] cajas de muro en píxeles.
    """
    if ink is None:
        ink = ink_mask(image)
    H, W = ink.shape
    S = max(H, W)
    chunk = max(8, int(CHUNK_FRAC * S))
    search = max(6, int(SEARCH_FRAC * S))
    follow = max(3, chunk // 4)  # pendiente máx. ~25 % entre tramos
    t = max(6, int(0.010 * S))  # espesor visual del muro en px
    min_len = int(MIN_WALL_FRAC * S)
    gap = gap_px or int(0.035 * S)
    ext = search // 2  # Gemini a veces corta el muro antes de la esquina

    out = []
    for w in gem_walls:
        x1, y1, x2, y2 = w['x1'], w['y1'], w['x2'], w['y2']
        dx, dy = abs(x2 - x1), abs(y2 - y1)
        if dy <= 0.2 * dx:
            horiz, c0 = True, (y1 + y2) / 2.0
            a0, a1 = max(0, int(min(x1, x2)) - ext), min(W, int(max(x1, x2)) + ext)
        elif dx <= 0.2 * dy:
            horiz, c0 = False, (x1 + x2) / 2.0
            a0, a1 = max(0, int(min(y1, y2)) - ext), min(H, int(max(y1, y2)) + ext)
        else:
            continue
        # candidato salido de la tinta: ya se sabe dónde está, buscar cerca
        steps = _track(ink, horiz, a0, a1, c0, chunk, w.get('search') or search, follow)
        # agrupar tramos con tinta; cortes cortos (temblor) se unen
        runs, cur, miss = [], None, 0
        for a, b, c, inked in steps:
            if inked:
                if cur is None:
                    cur = [a, b, [c], 0]
                else:
                    cur[1] = b
                    cur[2].append(c)
                cur[3] += b - a  # largo con tinta (siguiendo el trazo)
                miss = 0
            elif cur is not None:
                miss += b - a
                if miss > gap:
                    runs.append(cur)
                    cur, miss = None, 0
        if cur is not None:
            runs.append(cur)
        for a, b, cs, inked_len in runs:
            if b - a < min_len:
                continue
            c = float(np.median(cs))
            # Línea punteada/cortada (división de ambiente, no muro): mucho
            # menos tinta continua que una pared. Se mide siguiendo el trazo,
            # así una pared larga e inclinada no se descarta.
            if inked_len < 0.75 * (b - a):
                continue
            if b - a < 0.12 * S and _side_clutter(ink, horiz, a, b, c, t) > 0.05:
                continue  # renglón de texto, no pared
            h = t / 2.0
            if horiz:
                out.append({'x1': int(a), 'y1': int(c - h), 'x2': int(b), 'y2': int(c + h)})
            else:
                out.append({'x1': int(c - h), 'y1': int(a), 'x2': int(c + h), 'y2': int(b)})
    return out


def _side_clutter(ink, horiz, a, b, c, t):
    """
    Tinta a los costados del eje (franjas de ±3·t, sin la línea misma).
    Una pared tiene los costados casi vacíos; un renglón de texto no.
    """
    H, W = ink.shape
    c = int(round(c))
    near, far = int(t * 0.8) + 2, int(t * 3)
    if horiz:
        a, b = max(0, a), min(W, b)
        top = ink[max(0, c - far):max(0, c - near), a:b]
        bot = ink[min(H, c + near):min(H, c + far), a:b]
    else:
        a, b = max(0, a), min(H, b)
        top = ink[a:b, max(0, c - far):max(0, c - near)]
        bot = ink[a:b, min(W, c + near):min(W, c + far)]
    total = top.size + bot.size
    return float(top.sum() + bot.sum()) / total if total else 0.0


def end_gap_doors(walls, px2m, openings, lo_m=0.45, hi_m=1.30):
    """
    Puerta junto a una esquina: la pared termina y, a ancho de puerta, está
    la pared perpendicular contra la que debería chocar (típico del boceto:
    la hoja abre pegada a la pared). Devuelve [{x1,y1,x2,y2}] en px.
    """
    if not px2m:
        return []
    lo, hi = lo_m / px2m, hi_m / px2m

    def horiz(b):
        return (b['x2'] - b['x1']) >= (b['y2'] - b['y1'])

    def near_any(pt, pad, skip):
        return any(o is not skip and o['x1'] - pad <= pt[0] <= o['x2'] + pad
                   and o['y1'] - pad <= pt[1] <= o['y2'] + pad for o in walls)

    def overlaps(box_):
        # solo si se superponen de verdad (tocarse en un borde no cuenta)
        return any(not (box_['x2'] <= o[0] or o[2] <= box_['x1'] or box_['y2'] <= o[1] or o[3] <= box_['y1'])
                   for o in openings)

    out = []
    for w in walls:
        h = horiz(w)
        t = (w['y2'] - w['y1']) if h else (w['x2'] - w['x1'])
        c = (w['y1'] + w['y2']) / 2.0 if h else (w['x1'] + w['x2']) / 2.0
        ends = ((w['x1'], -1), (w['x2'], 1)) if h else ((w['y1'], -1), (w['y2'], 1))
        for e, sgn in ends:
            pt = (e, c) if h else (c, e)
            if near_any(pt, t, w):
                continue  # ya está unida a otra pared
            best = None
            for o in walls:
                if o is w or horiz(o) == h:
                    continue
                # ¿la perpendicular cruza el eje de esta pared?
                if h and not (o['y1'] - t <= c <= o['y2'] + t):
                    continue
                if not h and not (o['x1'] - t <= c <= o['x2'] + t):
                    continue
                face = (o['x1'] if sgn > 0 else o['x2']) if h else (o['y1'] if sgn > 0 else o['y2'])
                dist = (face - e) * sgn
                if lo <= dist <= hi and (best is None or dist < best[0]):
                    best = (dist, face)
            if best is None:
                continue
            a, b = sorted((e, best[1]))
            box_ = ({'x1': int(a), 'y1': w['y1'], 'x2': int(b), 'y2': w['y2']} if h
                    else {'x1': w['x1'], 'y1': int(a), 'x2': w['x2'], 'y2': int(b)})
            if not overlaps(box_):
                out.append(box_)
                openings = list(openings) + [(box_['x1'], box_['y1'], box_['x2'], box_['y2'])]
    return out


def keep_long_extra(cv_walls, snapped, S):
    """
    Muros del detector que Gemini no vio: solo los largos (>= 10 % de la
    imagen) y que no estén ya cubiertos. Las letras y flechas son cortas.
    """
    out = []
    pad = 0.02 * S
    for w in cv_walls:
        length = max(w['x2'] - w['x1'], w['y2'] - w['y1'])
        if length < 0.10 * S:
            continue
        cx, cy = (w['x1'] + w['x2']) / 2.0, (w['y1'] + w['y2']) / 2.0
        if any(s['x1'] - pad <= cx <= s['x2'] + pad and s['y1'] - pad <= cy <= s['y2'] + pad for s in snapped):
            continue
        out.append(w)
    return out
