# plans/cv_walls.py
"""
Segundo detector de muros por visión clásica (sin IA).

La IA (Mask R-CNN) se entrenó con planos de un estilo y en otros (renders a
color, paredes finas grises, fotos de hojas) se le escapan muros y puertas.
Este detector mira directamente la imagen:

1. Máscara de trazos: píxeles oscuros y poco saturados (las paredes; el piso
   de madera/baldosa es claro o saturado y queda fuera).
2. Tramos rectos: apertura morfológica con líneas horizontales y verticales
   largas → componentes → cajas.
3. Espesor típico de pared (moda pesada por área) para descartar muebles
   (muy gruesos) y líneas de cotas/grilla (muy finas).
4. Puertas: huecos de 0,6–1,3 m entre tramos colineales.

Devuelve cajas en PÍXELES con el mismo formato que la IA.
Usa scikit-image/scipy (sin OpenCV: en el servidor falta libGL).
"""
import numpy as np
from scipy import ndimage

DOOR_MIN_M = 0.60
DOOR_MAX_M = 1.30
DOOR_REF_M = 0.90  # ancho típico de puerta para estimar la escala


def stroke_mask(image, max_gray=150, max_sat=0.35):
    """
    Píxeles de trazo: oscuros y poco saturados (paredes, líneas).
    Un píxel MUY oscuro es trazo aunque tenga tinte (muros rellenos de azul
    marino, gris pizarra, café oscuro): su "saturación" es solo ruido del
    color de relleno. Un piso de color es claro y sigue quedando fuera.
    """
    rgb = np.asarray(image.convert('RGB'), dtype=np.float32) / 255.0
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    gray = rgb.mean(axis=2) * 255
    very_dark = mx < 0.30  # ningún canal pasa de ~76/255
    return (gray < max_gray) & ((sat < max_sat) | very_dark)


def _runs(mask, horizontal, min_len):
    """Tramos rectos de al menos min_len px en una dirección."""
    size = (1, min_len) if horizontal else (min_len, 1)
    return ndimage.binary_opening(mask, structure=np.ones(size, dtype=bool))


def _boxes(run_mask, horizontal):
    """Componentes de una máscara de tramos → [(x1, y1, x2, y2, espesor)]."""
    labels, n = ndimage.label(run_mask)
    out = []
    for sl in ndimage.find_objects(labels):
        if sl is None:
            continue
        ys, xs = sl
        x1, x2, y1, y2 = xs.start, xs.stop, ys.start, ys.stop
        thick = (y2 - y1) if horizontal else (x2 - x1)
        out.append((x1, y1, x2, y2, thick))
    return out


def _run_lengths(arr2d):
    """Largos de las corridas de True a lo largo del eje 0 (por columna)."""
    padded = np.zeros((arr2d.shape[0] + 2, arr2d.shape[1]), dtype=np.int8)
    padded[1:-1] = arr2d
    diff = np.diff(padded, axis=0)
    starts = np.argwhere(diff == 1)
    ends = np.argwhere(diff == -1)
    # mismo orden por columna gracias a argwhere (fila, columna)
    starts = starts[np.lexsort((starts[:, 0], starts[:, 1]))]
    ends = ends[np.lexsort((ends[:, 0], ends[:, 1]))]
    return ends[:, 0] - starts[:, 0]


def _stroke_thickness(mask, min_len):
    """
    Espesor típico de pared: largo más frecuente de las corridas
    transversales dentro de los tramos rectos largos (columna por columna en
    los horizontales, fila por fila en los verticales). No se confunde
    aunque varios trazos se toquen.
    """
    lengths = np.concatenate([
        _run_lengths(_runs(mask, True, min_len)),
        _run_lengths(_runs(mask, False, min_len).T),
    ])
    lengths = lengths[(lengths >= 3) & (lengths <= 60)]
    if lengths.size == 0:
        return None
    # Pesado por área (largo de la corrida): una pared gruesa rellena aporta
    # más tinta que muchas líneas finas de muebles, baldosas o cotas.
    counts = np.bincount(lengths, weights=lengths.astype(np.float64))
    # suavizado ±1 px: el antialias reparte el espesor en 2-3 valores
    smooth = np.convolve(counts, np.ones(3), mode='same')
    return int(np.argmax(smooth))


def _typical_thickness(boxes):
    """Espesor de pared más frecuente (pesado por largo × espesor)."""
    weights = {}
    for x1, y1, x2, y2, t in boxes:
        length = max(x2 - x1, y2 - y1)
        if t < 2 or length < 8 * t:
            continue  # líneas de 1 px (cotas, grilla) o manchas (muebles)
        weights[t] = weights.get(t, 0) + length * t  # por área: pesa la tinta real
    if not weights:
        return None
    return max(weights, key=weights.get)


def contrast_mask(image, min_dist=None):
    """
    Trazos de CUALQUIER color: píxeles que se alejan del color del papel.
    Para bocetos con marcador de color, lápiz claro o líneas azules/verdes.

    Sin min_dist el umbral se adapta al papel: algo por encima del ruido
    (grano, compresión), entre 28 y 80. Así un lápiz muy claro se ve y un
    papel granulado no se llena de puntos.
    """
    rgb = np.asarray(image.convert('RGB'), dtype=np.float32)
    # Papel LOCAL (no uno solo para toda la hoja): en una foto hay sombras
    # y luz despareja; se compara cada píxel con el papel de su zona.
    # Cierre en gris = borra las líneas finas; blur grande = fondo suave.
    S = max(rgb.shape[:2])
    k_close = max(5, int(0.012 * S)) | 1
    k_blur = max(15, int(0.04 * S)) | 1
    paper = np.stack([
        ndimage.uniform_filter(ndimage.grey_closing(rgb[..., c], size=(k_close, k_close)), size=k_blur)
        for c in range(3)
    ], axis=2)
    dist = np.linalg.norm(rgb - paper, axis=2)
    if min_dist is None:
        strong = dist > 80.0
        if strong.mean() >= 0.004:  # trazo bien visible: umbral normal
            return strong
        noise = float(np.median(dist))  # el papel es casi toda la imagen
        min_dist = min(80.0, max(28.0, 4.0 * noise + 15.0))
    return dist > min_dist


def _total_len(oriented):
    return sum(max(x2 - x1, y2 - y1) for _, x1, y1, x2, y2 in oriented)


def detect_walls(image, min_len_px=None):
    """
    Detecta muros con la máscara de trazos oscuros y, si casi no encuentra
    nada (p. ej. boceto con marcador de color), reintenta con la máscara de
    contraste contra el papel. Se queda con el resultado más completo.
    """
    best = _detect(image, stroke_mask(image), min_len_px)
    if len(best['walls']) < 6:
        alt = _detect(image, contrast_mask(image), min_len_px)
        if _total_len(alt['_oriented']) > 1.3 * _total_len(best['_oriented']):
            alt['mask'] = 'contraste'
            best = alt
    return best


def _detect(image, mask, min_len_px=None):
    """
    Detecta muros rectos en la imagen del plano.

    Returns:
        dict con:
          walls: [{x1,y1,x2,y2}] en píxeles,
          doors: [{x1,y1,x2,y2}] huecos con forma de puerta,
          thickness_px: espesor típico de pared (o None),
          extent_px: (x1, y1, x2, y2) caja que cubre todos los muros.
    """
    h, w = mask.shape
    min_len = min_len_px or max(20, int(0.025 * max(h, w)))
    # Paredes dibujadas con dos líneas: unir líneas cercanas antes.
    closed = ndimage.binary_closing(mask, structure=np.ones((3, 3), dtype=bool))

    t = _stroke_thickness(closed, min_len)
    if t is None:
        return {'walls': [], '_oriented': [], 'doors': [], 'thickness_px': None, 'extent_px': None}
    # Quitar todo lo más fino que una pared (contornos de muebles, cotas,
    # marcos): apertura con un cuadrado algo menor que el espesor.
    k = max(2, int(round(t * 0.7)))
    core = ndimage.binary_opening(closed, structure=np.ones((k, k), dtype=bool))
    horiz = _boxes(_runs(core, True, min_len), True)
    vert = _boxes(_runs(core, False, min_len), False)

    lo, hi = max(2, int(t * 0.5)), int(np.ceil(t * 2.2)) + 1
    walls = []
    for x1, y1, x2, y2, th in horiz:
        if lo <= th <= hi and (x2 - x1) >= 4 * th:
            walls.append(('h', x1, y1, x2, y2))
    for x1, y1, x2, y2, th in vert:
        if lo <= th <= hi and (y2 - y1) >= 4 * th:
            walls.append(('v', x1, y1, x2, y2))

    # Segunda pasada: muros interiores más finos que los exteriores (muy
    # común: exterior 20 cm, tabiques 7-10 cm). Sin esto la apertura de
    # arriba los borra y el 3D queda solo con el contorno.
    if walls:
        thick_ext = (min(w[1] for w in walls), min(w[2] for w in walls),
                     max(w[3] for w in walls), max(w[4] for w in walls))
        walls += _thin_walls(closed, core, t, min_len, thick_ext, walls)

    # Paredes RAYADAS (dos líneas finas con rulos o trazos cruzados): con la
    # máscara normal no se ven como pared. Cerrando los huecos del rayado la
    # franja queda sólida y se detecta como un muro grueso.
    walls += _hatched_walls(mask, t, min_len, walls)

    walls = _main_network(walls, t)
    walls, color_doors = split_doors(image, walls, t)

    extent = None
    if walls:
        extent = (
            min(b[1] for b in walls), min(b[2] for b in walls),
            max(b[3] for b in walls), max(b[4] for b in walls),
        )
    return {
        'walls': [{'x1': int(a), 'y1': int(b), 'x2': int(c), 'y2': int(d)} for _, a, b, c, d in walls],
        '_oriented': walls,
        'doors': [{'x1': int(a), 'y1': int(b), 'x2': int(c), 'y2': int(d)} for a, b, c, d in color_doors],
        'thickness_px': int(t),
        'extent_px': extent,
    }


HATCH_MIN_TRANSITIONS = 0.10  # idas y vueltas de tinta por px en una franja rayada
HATCH_MIN_FACE = 0.87  # línea de borde continua a lo largo de la franja
HATCH_MAX_FILL = 0.40  # el rayado ocupa poco de la franja


def _hatched_walls(mask, t, min_len, existing):
    """
    Muros rayados: se cierra la máscara con un cuadrado de ~1,5 espesores
    (los rulos/trazos del rayado se unen) y se buscan franjas rectas más
    gruesas que una pared normal (1,6-5 espesores). Las que ya están
    cubiertas por un muro detectado no se repiten.
    """
    k = max(5, int(round(t * 1.5)) | 1)
    solid = ndimage.binary_closing(mask, structure=np.ones((k, k), dtype=bool))
    # solo lo que el cierre AGREGÓ cerca de trazos: franjas gruesas
    lengths = np.concatenate([
        _run_lengths(_runs(solid, True, min_len)),
        _run_lengths(_runs(solid, False, min_len).T),
    ])
    lengths = lengths[(lengths >= int(1.6 * t)) & (lengths <= int(5 * t))]
    if lengths.size < 20:
        return []
    counts = np.bincount(lengths, weights=lengths.astype(np.float64))
    th = int(np.argmax(np.convolve(counts, np.ones(3), mode='same')))
    if th < 1.6 * t:
        return []
    core = ndimage.binary_opening(solid, structure=np.ones((int(th * 0.7),) * 2, dtype=bool))
    out = []
    for horiz in (True, False):
        for x1, y1, x2, y2, tk in _boxes(_runs(core, horiz, max(min_len, 4 * th)), horiz):
            if not (0.6 * th <= tk <= 1.6 * th):
                continue
            # ¿ya hay un muro detectado encima? (no repetir)
            area = (x2 - x1) * (y2 - y1)
            cov = 0
            for _, a, b, c, d in existing:
                ix, iy = min(x2, c) - max(x1, a), min(y2, d) - max(y1, b)
                if ix > 0 and iy > 0:
                    cov += ix * iy
            if cov > 0.5 * area:
                continue
            # el rayado tiene tinta repartida en la franja (no es una mancha
            # negra maciza ni un hueco vacío)
            fill = float(mask[y1:y2, x1:x2].mean()) if area else 0.0
            if not (0.15 <= fill <= 0.85):
                continue
            # Firma del rayado: a lo largo de la franja la tinta va y viene
            # muchas veces (rulos/trazos cada pocos px). Un mueble, una mesada,
            # un sofá o una baranda casi no cambian (medido: 0,18-0,21 contra
            # 0,02 o menos).
            sub = mask[y1:y2, x1:x2]
            rows = sub if horiz else sub.T
            n = rows.shape[1]
            if n < 2:
                continue
            trans = np.count_nonzero(np.diff(rows.astype(np.int8), axis=1) != 0, axis=1) / float(n)
            if float(np.median(trans)) < HATCH_MIN_TRANSITIONS:
                continue
            # Una pared rayada tiene al menos una línea de borde continua a lo
            # largo (88-99 %) y el rayado ocupa poco (26-29 %); el estampado
            # de una cama o un mueble no (medido: borde <= 85 %, tinta >= 31 %).
            if float(rows.mean(axis=1).max()) < HATCH_MIN_FACE or float(sub.mean()) > HATCH_MAX_FILL:
                continue
            out.append(('h' if horiz else 'v', x1, y1, x2, y2))
    return out


def _thin_walls(light, core, t, min_len, extent, thick_walls):
    """
    Detecta una segunda familia de muros (tabiques) con espesor t2 < 0,65·t,
    que muchas veces están dibujados más claros que los exteriores.

    - Se ignoran trazos de 1-2 px (cotas, grilla, textos).
    - Solo cuentan los que están dentro del edificio (extent de los muros
      gruesos), y se descartan las líneas que continúan fuera de él: eso es
      la grilla del papel, no un muro.
    """
    if extent is None:
        return []
    grown = ndimage.binary_dilation(core, structure=np.ones((3, 3), dtype=bool), iterations=2)
    rest = light & ~grown
    ex1, ey1, ex2, ey2 = extent
    inside = np.zeros_like(rest)
    inside[ey1:ey2, ex1:ex2] = True
    rest_in = rest & inside

    lengths = np.concatenate([
        _run_lengths(_runs(rest_in, True, min_len)),
        _run_lengths(_runs(rest_in, False, min_len).T),
    ])
    t_max = int(t * 0.65)
    t_min = int(np.ceil(max(3, 0.2 * t)))  # contornos de 2-3 px no son tabiques
    lengths = lengths[(lengths >= t_min) & (lengths <= t_max)]
    if lengths.size < 20:
        return []
    counts = np.bincount(lengths)
    t2 = int(np.argmax(counts))
    if counts[t2] < 20:
        return []
    k2 = max(2, int(round(t2 * 0.6)))
    core2 = ndimage.binary_opening(rest_in, structure=np.ones((k2, k2), dtype=bool))
    lo, hi = max(2, int(t2 * 0.5)), int(np.ceil(t2 * 1.8)) + 1
    min_l = max(min_len, 8 * t2)

    H, W = rest.shape
    margin = max(4, t)
    out_len = max(min_len // 2, 10)

    def grid_like(o, x1, y1, x2, y2):
        # ¿la misma línea sigue fuera del edificio? → grilla
        if o == 'h':
            band = rest[y1:y2, :]
            outside = np.concatenate([band[:, :max(0, ex1 - margin)], band[:, min(W, ex2 + margin):]], axis=1)
            return outside.size and outside.any(axis=0).sum() >= out_len
        band = rest[:, x1:x2]
        outside = np.concatenate([band[:max(0, ey1 - margin)], band[min(H, ey2 + margin):]], axis=0)
        return outside.size and outside.any(axis=1).sum() >= out_len

    out = []
    for x1, y1, x2, y2, th in _boxes(_runs(core2, True, min_l), True):
        if lo <= th <= hi and not grid_like('h', x1, y1, x2, y2):
            out.append(('h', x1, y1, x2, y2))
    for x1, y1, x2, y2, th in _boxes(_runs(core2, False, min_l), False):
        if lo <= th <= hi and not grid_like('v', x1, y1, x2, y2):
            out.append(('v', x1, y1, x2, y2))
    out = _drop_hatching(out, t2)
    big = 0.25 * max(ex2 - ex1, ey2 - ey1)
    return _connected_only(out, thick_walls, pad=max(t, 3 * t2), long_len=big)


def _drop_hatching(segs, t2):
    """
    Rayados, escalones, mesadas: 3+ líneas paralelas finas muy juntas y
    superpuestas. Un tabique real no tiene "hermanos" a pocos px.
    """
    drop = set()
    gap = 8 * t2
    for i, a in enumerate(segs):
        sib = [i]
        for j, b in enumerate(segs):
            if i == j or a[0] != b[0]:
                continue
            if a[0] == 'h':
                d = abs((a[2] + a[4]) - (b[2] + b[4])) / 2.0
                ov = min(a[3], b[3]) - max(a[1], b[1])
                short = min(a[3] - a[1], b[3] - b[1])
            else:
                d = abs((a[1] + a[3]) - (b[1] + b[3])) / 2.0
                ov = min(a[4], b[4]) - max(a[2], b[2])
                short = min(a[4] - a[2], b[4] - b[2])
            if 0 < d <= gap and ov >= 0.5 * short:
                sib.append(j)
        if len(sib) >= 3:
            drop.update(sib)
    return [s for i, s in enumerate(segs) if i not in drop]


def _connected_only(thin, thick, pad, long_len):
    """
    Un tabique debe arrancar y terminar en otro muro (contornos de muebles
    quedan sueltos). Se admite una punta libre solo si es muy largo.
    Se poda iterativamente: lo que dependía de un descartado también cae.
    """
    def ends(s):
        o, x1, y1, x2, y2 = s
        if o == 'h':
            c = (y1 + y2) / 2.0
            return (x1, c), (x2, c)
        c = (x1 + x2) / 2.0
        return (c, y1), (c, y2)

    def touches(pt, box_):
        _, x1, y1, x2, y2 = box_
        return x1 - pad <= pt[0] <= x2 + pad and y1 - pad <= pt[1] <= y2 + pad

    keep = list(thin)
    while True:
        others = list(thick) + keep
        nxt = []
        for s in keep:
            a, b = ends(s)
            ca = any(o is not s and touches(a, o) for o in others)
            cb = any(o is not s and touches(b, o) for o in others)
            length = max(s[3] - s[1], s[4] - s[2])
            if (ca and cb) or ((ca or cb) and length >= long_len):
                nxt.append(s)
        if len(nxt) == len(keep):
            break
        keep = nxt
    return _anchored(keep, thick, pad)


def _anchored(thin, thick, pad):
    """
    Solo los grupos de tabiques que tocan alguna pared principal: un mueble
    (sofá, mesada, lavamanos) es un rectángulo cerrado que solo se toca a sí
    mismo y no llega a ninguna pared.
    """
    def near(a, b):
        return (a[1] - pad <= b[3] and b[1] - pad <= a[3]
                and a[2] - pad <= b[4] and b[2] - pad <= a[4])

    anchored = [any(near(s, w) for w in thick) for s in thin]
    changed = True
    while changed:
        changed = False
        for i, s in enumerate(thin):
            if not anchored[i] and any(anchored[j] and near(s, thin[j]) for j in range(len(thin)) if j != i):
                anchored[i] = True
                changed = True
    return [s for s, ok in zip(thin, anchored) if ok]


def _main_network(walls, t, keep_ratio=0.25):
    """
    Se queda con la red principal de muros conectados. Lo aislado (textos,
    contornos de camas o sillas) no está unido a las paredes y se descarta.
    Se conservan otras redes si su largo total es >= keep_ratio de la mayor
    (p. ej. un ala separada de la casa).
    """
    n = len(walls)
    if n == 0:
        return walls
    pad = max(3, int(t * 1.5))
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(n):
        _, ax1, ay1, ax2, ay2 = walls[i]
        for j in range(i + 1, n):
            _, bx1, by1, bx2, by2 = walls[j]
            if ax1 - pad <= bx2 and bx1 - pad <= ax2 and ay1 - pad <= by2 and by1 - pad <= ay2:
                parent[find(i)] = find(j)

    totals = {}
    for i, (_, x1, y1, x2, y2) in enumerate(walls):
        r = find(i)
        totals[r] = totals.get(r, 0) + max(x2 - x1, y2 - y1)
    best = max(totals.values())
    keep = {r for r, total in totals.items() if total >= keep_ratio * best}
    # Un tramo suelto pero largo es una pared (p. ej. cortada por ventanas).
    return [
        w for i, w in enumerate(walls)
        if find(i) in keep or max(w[3] - w[1], w[4] - w[2]) >= 22 * t
    ]


CHROMA_TOL = 40.0  # diferencia de tono (escala 0-765) para decir "otro color"


def _chroma_distance(colors, reference):
    """Distancia de tono (independiente del brillo) entre colores RGB."""
    colors = np.asarray(colors, dtype=np.float32)
    ref = np.asarray(reference, dtype=np.float32)
    c = colors / np.maximum(colors.sum(axis=-1, keepdims=True), 30.0)
    r = ref / max(float(ref.sum()), 30.0)
    return np.linalg.norm(c - r, axis=-1) * 765.0


def split_doors(image, oriented, thickness, color_tol=24.0):
    """
    Puertas dibujadas DENTRO de la línea del muro (hoja de otro color):
    se mide el color típico de las paredes del plano y, a lo largo de cada
    muro, los tramos de color distinto con largo de puerta (4–25 espesores)
    se cortan del muro y pasan a ser puertas.

    Returns:
        (walls [(orient, x1, y1, x2, y2)], doors [(x1, y1, x2, y2)]) en px.
    """
    if not oriented or not thickness:
        return oriented, []
    rgb = np.asarray(image.convert('RGB'), dtype=np.float32)
    samples = []
    for o, x1, y1, x2, y2 in oriented:
        strip = rgb[y1:y2, x1:x2].reshape(-1, 3)
        if strip.size:
            samples.append(strip)
    if not samples:
        return oriented, []
    wall_color = np.median(np.concatenate(samples), axis=0)

    lo, hi = 4 * thickness, 25 * thickness
    strokes = stroke_mask(image)
    H, W = strokes.shape
    band = int(round(thickness * 2))
    walls, doors = [], []
    for o, x1, y1, x2, y2 in oriented:
        # grosor del trazo oscuro a lo largo del muro (banda ancha alrededor)
        if o == 'h':
            sub = strokes[max(0, y1 - band):min(H, y2 + band), x1:x2]
            stroke_thick = sub.sum(axis=0)
        else:
            sub = strokes[y1:y2, max(0, x1 - band):min(W, x2 + band)]
            stroke_thick = sub.sum(axis=1)
        strip = rgb[y1:y2, x1:x2]
        if strip.size == 0:
            walls.append((o, x1, y1, x2, y2))
            continue
        # color mediano a lo largo del muro
        along = np.median(strip, axis=0) if o == 'h' else np.median(strip, axis=1)
        # Se compara el TONO (proporción r:g:b), que no cambia con la luz:
        # en una foto con sombra la pared sigue siendo "gris azulada" y la
        # hoja "marrón", aunque estén más oscuras o más claras.
        diff = _chroma_distance(along, wall_color) > CHROMA_TOL
        cuts = []
        i, n = 0, len(diff)
        while i < n:
            if diff[i]:
                j = i
                while j < n and diff[j]:
                    j += 1
                run = along[i:j]
                # Hoja de puerta: color parejo y oscuro (una ventana alterna
                # blanco y gris; un mueble pegado cambia de tono a saltos).
                uniform = float(run.std(axis=0).mean()) < 14.0
                dark = float(run.mean()) < 165.0
                # Grosor como el de una pared (no pared + mueble pegado).
                thin = float(np.median(stroke_thick[i:j])) <= 1.7 * thickness
                # Siempre queda muro a ambos lados de una puerta.
                inside = i >= thickness and (n - j) >= thickness
                if lo <= j - i <= hi and uniform and dark and thin and inside:
                    cuts.append((i, j))
                i = j
            else:
                i += 1
        if not cuts:
            walls.append((o, x1, y1, x2, y2))
            continue
        start = 0
        base = x1 if o == 'h' else y1
        for a, b in cuts:
            if a - start >= 2 * thickness:
                walls.append((o, base + start, y1, base + a, y2) if o == 'h' else (o, x1, base + start, x2, base + a))
            doors.append((base + a, y1, base + b, y2) if o == 'h' else (x1, base + a, x2, base + b))
            start = b
        end = (x2 - x1) if o == 'h' else (y2 - y1)
        if end - start >= 2 * thickness:
            walls.append((o, base + start, y1, x2, y2) if o == 'h' else (o, x1, base + start, x2, y2))
    return walls, doors


def find_door_gaps(oriented, px2m, windows_px=()):
    """
    Huecos con ancho de puerta (0,6–1,3 m) entre tramos colineales de muro.
    Se descartan los huecos donde hay una ventana detectada.

    Returns:
        [{x1,y1,x2,y2}] en píxeles.
    """
    if not px2m:
        return []
    doors = []
    for orient in ('h', 'v'):
        segs = [s for s in oriented if s[0] == orient]
        # agrupar por línea (centro transversal a ±espesor)
        segs.sort(key=lambda s: ((s[2] + s[4]) / 2 if orient == 'h' else (s[1] + s[3]) / 2))
        lines = []
        for s in segs:
            c = (s[2] + s[4]) / 2 if orient == 'h' else (s[1] + s[3]) / 2
            th = (s[4] - s[2]) if orient == 'h' else (s[3] - s[1])
            if lines and abs(lines[-1][0] - c) <= max(3, th):
                lines[-1][1].append(s)
            else:
                lines.append([c, [s]])
        for c, group in lines:
            group.sort(key=lambda s: s[1] if orient == 'h' else s[2])
            for a, b in zip(group, group[1:]):
                a_end = a[3] if orient == 'h' else a[4]
                b_start = b[1] if orient == 'h' else b[2]
                gap_m = (b_start - a_end) * px2m
                if not (DOOR_MIN_M <= gap_m <= DOOR_MAX_M):
                    continue
                if orient == 'h':
                    box_ = (a_end, min(a[2], b[2]), b_start, max(a[4], b[4]))
                else:
                    box_ = (min(a[1], b[1]), a_end, max(a[3], b[3]), b_start)
                if any(_overlap(box_, wbox) for wbox in windows_px):
                    continue
                doors.append({'x1': int(box_[0]), 'y1': int(box_[1]), 'x2': int(box_[2]), 'y2': int(box_[3])})
    return doors


def _overlap(a, b, margin=4):
    return not (a[2] + margin < b[0] or b[2] + margin < a[0] or a[3] + margin < b[1] or b[3] + margin < a[1])


def find_entry_markers(image, oriented, thickness, px2m):
    """
    Símbolos de ENTRADA: una marca sólida mucho más oscura que la pared
    (rectángulo/triángulo negro) pegada o cruzando un muro. Muchos programas
    marcan así el acceso en vez de dibujar el arco de la puerta.

    Devuelve vanos de puerta (DOOR_REF_M de ancho) centrados en la marca,
    encajados en el muro: [{x1,y1,x2,y2}] en píxeles.
    """
    if not oriented or not thickness or not px2m:
        return []
    rgb = np.asarray(image.convert('RGB'), dtype=np.float32)
    gray = rgb.mean(axis=2)
    samples = [gray[y1:y2, x1:x2].ravel() for _, x1, y1, x2, y2 in oriented if (y2 - y1) * (x2 - x1) > 0]
    if not samples:
        return []
    wall_gray = float(np.median(np.concatenate(samples)))
    if wall_gray < 70:  # paredes ya negras: una marca negra no se distingue
        return []
    dark = gray < min(70.0, wall_gray - 45.0)
    labels, n = ndimage.label(dark)
    half = DOOR_REF_M / px2m / 2.0
    pad = thickness
    out = []
    for sl in ndimage.find_objects(labels):
        if sl is None:
            continue
        ys, xs = sl
        h, w = ys.stop - ys.start, xs.stop - xs.start
        area = h * w
        # marca chica: ni texto largo ni un muro entero
        if area < (0.5 * thickness) ** 2 or max(h, w) > 4 * thickness:
            continue
        cx, cy = (xs.start + xs.stop) / 2.0, (ys.start + ys.stop) / 2.0
        for o, x1, y1, x2, y2 in oriented:
            if not (x1 - pad <= cx <= x2 + pad and y1 - pad <= cy <= y2 + pad):
                continue
            if o == 'h':
                if x1 + half * 0.5 <= cx <= x2 - half * 0.5:
                    out.append({'x1': int(cx - half), 'y1': y1, 'x2': int(cx + half), 'y2': y2})
            else:
                if y1 + half * 0.5 <= cy <= y2 - half * 0.5:
                    out.append({'x1': x1, 'y1': int(cy - half), 'x2': x2, 'y2': int(cy + half)})
            break
    return out


def wall_ink_coverage(image, box_):
    """Fracción del eje del vano con trazo de muro (1.0 = muro continuo).
    Cuenta también tabiques gris claro o de color."""
    mask = stroke_mask(image, max_gray=205) | contrast_mask(image, min_dist=60.0)
    x1, y1, x2, y2 = (int(round(box_[k])) for k in ('x1', 'y1', 'x2', 'y2'))
    sub = mask[max(0, y1):max(y1 + 1, y2), max(0, x1):max(x1 + 1, x2)]
    if sub.size == 0:
        return 0.0
    horiz = (x2 - x1) >= (y2 - y1)
    # hay trazo en alguna fila del espesor (el tabique puede ser más fino
    # que la caja del muro)
    along = sub.any(axis=0) if horiz else sub.any(axis=1)
    return float(along.mean())
