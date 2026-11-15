# plans/three.py
import numpy as np
import trimesh
import trimesh.repair as repair

from shapely.geometry import LineString, box, Polygon, MultiPolygon
from shapely.ops import unary_union, snap, polygonize


# Parámetros globales
WALL_HEIGHT_M = 3.0
WALL_THICKNESS_M = 0.15

# Vanos reales: puerta de 2.10 m y ventana de 0.90 a 2.10 m; por encima
# (dintel) y por debajo de la ventana (antepecho) hay muro.
DOOR_HEIGHT_M = 2.10

WINDOW_SILL_M = 0.90
WINDOW_HEAD_M = 2.10
WINDOW_HEIGHT_M = WINDOW_HEAD_M - WINDOW_SILL_M

FRAME_M = 0.05  # ancho del marco de puertas y ventanas
GLASS_M = 0.012  # espesor del vidrio
DOOR_LEAF_M = 0.04  # espesor de la hoja de la puerta
SNAP_GAP_M = 0.30  # huecos de hasta esto entre vano y muro se cierran

# Grosor de las barras de la cruz de ventana
WINDOW_BAR_THICK_M = 0.03

# Grosor de la tapa superior
TOP_CAP_THICK_M = 0.03

# Tolerancias (en metros)
JOINT_PAD_M = 0.02  # Alarga los tramos para que las juntas cierren
EPS_CUT = 0.003  # Margen al recortar vanos
TOL_SIMPLIFY = 0.002  # Para simplificar contornos
TOL_SNAP = 0.004  # Para "pegar" vértices cercanos
EXTERNAL_WALL_MARGIN = 0.08  # Margen para detectar muros externos


# Colores RGBA
COLOR_WALL = [180, 180, 180, 255]
COLOR_DOOR = [160, 110, 80, 255]
COLOR_WINDOW = [120, 160, 220, 255]
COLOR_FLOOR = [150, 150, 150, 255]
COLOR_ROOF = [170, 80, 60, 255]

# Piso (losa) y techo
SLAB_THICKNESS_M = 0.15
ROOF_THICKNESS_M = 0.12
ROOF_PITCH_DEG = 25.0
ROOF_OVERHANG_M = 0.30  # Alero
FOOTPRINT_CLOSE_M = 0.60  # Cierra uniones abiertas entre muros (piso/techo)
ROOF_TYPES = ("ninguno", "plano", "dos_aguas")


def _pixel_to_meter_from_det(det: dict, fallback=0.01):
    """
    Calcular escala de píxeles a metros.

    Usa averageDoor si existe (asumiendo 0.90 m de ancho de puerta).
    """
    # Escala decidida por plans/pipeline.py (ancho real, puertas, ...).
    mpp = det.get("metersPerPixel")
    if mpp:
        return float(mpp)
    avg = float(det.get("averageDoor") or 0.0)
    return (0.90 / avg) if avg > 4 else fallback


def _iter_rois(det):
    """
    Iterar sobre las regiones de interés (ROIs) en la detección.

    Yields:
        Tupla de (roi, name, score)
    """
    pts = det.get("points", [])
    cls = det.get("classes", [])
    scr = det.get("scores", []) or [1.0] * len(pts)
    for i, p in enumerate(pts):
        name = (cls[i] or {}).get("name", "")
        score = scr[i] if i < len(scr) else 1.0
        yield p, name, float(score)


def _roi_dims_center_m(p, px2m):
    """
    Calcular dimensiones y centro de un ROI en metros.

    Returns:
        Tupla de (dx, dy, cx, cy)
    """
    x1, y1, x2, y2 = p["x1"], p["y1"], p["x2"], p["y2"]
    dx = abs(x2 - x1) * px2m  # Ancho en X
    dy = abs(y2 - y1) * px2m  # Ancho en Y
    cx = (x1 + x2) * 0.5 * px2m
    cy = (y1 + y2) * 0.5 * px2m
    return dx, dy, cx, cy


def _wall_centerline_from_roi(p, px2m):
    """
    Crear línea central de un muro desde un ROI.

    Devuelve (LineString, orient, roi) por el eje mayor del ROI
    extendido JOINT_PAD_M.
    """
    dx, dy, cx, cy = _roi_dims_center_m(p, px2m)
    if dx >= dy:
        length = dx + 2 * JOINT_PAD_M
        ln = LineString([(cx - length/2.0, cy), (cx + length/2.0, cy)])
        return ln, 'h', p
    else:
        length = dy + 2 * JOINT_PAD_M
        ln = LineString([(cx, cy - length/2.0), (cx, cy + length/2.0)])
        return ln, 'v', p


def _is_external_wall(roi, px2m, img_width, img_height):
    """
    Detectar si un muro está en el perímetro externo del plano.

    Returns:
        bool: True si el muro está en el perímetro
    """
    dx, dy, cx, cy = _roi_dims_center_m(roi, px2m)
    
    # Convertir margen de metros a proporción de la imagen
    margin = EXTERNAL_WALL_MARGIN
    
    # Verificar si está cerca de los bordes (en coordenadas en metros)
    # Asumimos que la imagen también se escala a metros
    x1_m = roi['x1'] * px2m
    x2_m = roi['x2'] * px2m
    y1_m = roi['y1'] * px2m
    y2_m = roi['y2'] * px2m
    width_m = img_width * px2m
    height_m = img_height * px2m

    on_left = min(x1_m, x2_m) <= margin
    on_right = max(x1_m, x2_m) >= width_m - margin
    on_top = min(y1_m, y2_m) <= margin
    on_bottom = max(y1_m, y2_m) >= height_m - margin

    return on_left or on_right or on_top or on_bottom


def _classify_external(walls, openings=()):
    """
    Marca como externo cada muro que toca el contorno exterior del edificio
    (unión de muros y vanos, con los huecos interiores rellenos).
    """
    try:
        polys = [w[0] for w in walls] + list(openings)
        shape = unary_union([p.buffer(0.15, join_style=2) for p in polys])
        geoms = list(shape.geoms) if isinstance(shape, MultiPolygon) else [shape]
        rings = [Polygon(g.exterior).buffer(-0.15, join_style=2).exterior for g in geoms]
        out = []
        for poly, _, idx in walls:
            thick = min(poly.bounds[2] - poly.bounds[0], poly.bounds[3] - poly.bounds[1])
            tol = max(0.05, thick * 0.75)
            # Debe correr A LO LARGO del contorno (un tabique que solo lo
            # toca en una punta sigue siendo interno).
            ext = any(poly.intersection(r.buffer(tol)).area >= 0.5 * poly.area for r in rings)
            out.append((poly, ext, idx))
        return out
    except Exception:
        return walls


def _opening_polygon_from_roi(p, px2m):
    """
    Crear polígono de vano (puerta/ventana).

    Rectángulo que atraviesa todo el espesor del muro (+EPS_CUT).
    """
    dx, dy, cx, cy = _roi_dims_center_m(p, px2m)
    thickness = WALL_THICKNESS_M + 2 * EPS_CUT
    if dx >= dy:
        return box(cx - dx/2.0, cy - thickness/2.0,
                   cx + dx/2.0, cy + thickness/2.0)
    else:
        return box(cx - thickness/2.0, cy - dy/2.0,
                   cx + thickness/2.0, cy + dy/2.0)


def _extrude_polygon_union(poly_union):
    """
    Extruir polígono a mesh 3D.

    Repara el mesh para evitar caras duplicadas y z-fighting.
    """
    if poly_union.is_empty:
        return None
    polys = (
        [poly_union] if isinstance(poly_union, Polygon)
        else list(poly_union.geoms)
    )
    meshes = []
    for poly in polys:
        clean = poly.buffer(0)
        if clean.is_empty:
            continue
        m = trimesh.creation.extrude_polygon(clean, height=WALL_HEIGHT_M)
        _colorize(m, COLOR_WALL)
        # Reparación del mesh
        m.remove_duplicate_faces()
        m.remove_degenerate_faces()
        m.remove_unreferenced_vertices()
        repair.fix_normals(m)
        m.merge_vertices()
        meshes.append(m)
    return trimesh.util.concatenate(meshes) if meshes else None


def _colorize(mesh: trimesh.Trimesh, rgba):
    """Aplicar color RGBA a los vértices del mesh."""
    mesh.visual.vertex_colors = np.tile(rgba, (len(mesh.vertices), 1))
    return mesh


def _door_mesh_from_roi(p, px2m):
    """
    Crear mesh 3D de puerta desde ROI.

    Usa las dimensiones exactas detectadas y crea un box 3D.
    """
    x1_m = p['x1'] * px2m
    y1_m = p['y1'] * px2m
    x2_m = p['x2'] * px2m
    y2_m = p['y2'] * px2m

    # Calcular dimensiones del rectángulo
    width = abs(x2_m - x1_m)
    depth = abs(y2_m - y1_m)

    # Centro del rectángulo
    cx = (x1_m + x2_m) * 0.5
    cy = (y1_m + y2_m) * 0.5

    # Crear box con las dimensiones exactas del ROI
    ext = [width, depth, DOOR_HEIGHT_M]
    mesh = trimesh.creation.box(extents=ext)
    mesh.apply_translation([cx, cy, DOOR_HEIGHT_M * 0.5])

    return _colorize(mesh, COLOR_DOOR)


def _window_mesh_from_roi(p, px2m):
    """
    Crear mesh 3D de ventana con cruz delgada.

    Usa las dimensiones del ROI y crea una cruz delgada en la posición
    de la ventana, sin ocupar todo el grosor del muro.
    """
    x1_m = p['x1'] * px2m
    y1_m = p['y1'] * px2m
    x2_m = p['x2'] * px2m
    y2_m = p['y2'] * px2m

    # Dimensiones del ROI
    dx = abs(x2_m - x1_m)
    dy = abs(y2_m - y1_m)

    # Centro
    cx = (x1_m + x2_m) * 0.5
    cy = (y1_m + y2_m) * 0.5

    parts = []
    z_center = WINDOW_SILL_M + WINDOW_HEIGHT_M * 0.5

    # Determinar orientación del muro
    if dx >= dy:
        # Muro horizontal - la ventana es delgada en Y
        # 1) Bloque inferior
        if WINDOW_SILL_M > 0:
            ext_bottom = [dx, dy, WINDOW_SILL_M]
            b = trimesh.creation.box(extents=ext_bottom)
            b.apply_translation([cx, cy, WINDOW_SILL_M * 0.5])
            _colorize(b, COLOR_WALL)
            parts.append(b)
        
        # 2) Cruz de ventana (delgada)
        # Barra vertical
        ext_v = [WINDOW_BAR_THICK_M, dy, WINDOW_HEIGHT_M]
        vertical_bar = trimesh.creation.box(extents=ext_v)
        vertical_bar.apply_translation([cx, cy, z_center])
        _colorize(vertical_bar, COLOR_WINDOW)
        parts.append(vertical_bar)

        # Barra horizontal
        ext_h = [dx, dy, WINDOW_BAR_THICK_M]
        horizontal_bar = trimesh.creation.box(extents=ext_h)
        horizontal_bar.apply_translation([cx, cy, z_center])
        _colorize(horizontal_bar, COLOR_WINDOW)
        parts.append(horizontal_bar)
        
        # 3) Tapa superior
        top_thick = TOP_CAP_THICK_M
        top_zc = WINDOW_SILL_M + WINDOW_HEIGHT_M + top_thick * 0.5
        top_zc = min(top_zc, WALL_HEIGHT_M - top_thick * 0.5)
        ext_top = [dx, dy, top_thick]
        t = trimesh.creation.box(extents=ext_top)
        t.apply_translation([cx, cy, top_zc])
        _colorize(t, COLOR_WINDOW)
        parts.append(t)
    else:
        # Muro vertical - la ventana es delgada en X
        # 1) Bloque inferior
        if WINDOW_SILL_M > 0:
            ext_bottom = [dx, dy, WINDOW_SILL_M]
            b = trimesh.creation.box(extents=ext_bottom)
            b.apply_translation([cx, cy, WINDOW_SILL_M * 0.5])
            _colorize(b, COLOR_WALL)
            parts.append(b)
        
        # 2) Cruz de ventana (delgada)
        # Barra vertical
        ext_v = [dx, WINDOW_BAR_THICK_M, WINDOW_HEIGHT_M]
        vertical_bar = trimesh.creation.box(extents=ext_v)
        vertical_bar.apply_translation([cx, cy, z_center])
        _colorize(vertical_bar, COLOR_WINDOW)
        parts.append(vertical_bar)

        # Barra horizontal
        ext_h = [dx, dy, WINDOW_BAR_THICK_M]
        horizontal_bar = trimesh.creation.box(extents=ext_h)
        horizontal_bar.apply_translation([cx, cy, z_center])
        _colorize(horizontal_bar, COLOR_WINDOW)
        parts.append(horizontal_bar)

        # 3) Tapa superior
        top_thick = TOP_CAP_THICK_M
        top_zc = WINDOW_SILL_M + WINDOW_HEIGHT_M + top_thick * 0.5
        top_zc = min(top_zc, WALL_HEIGHT_M - top_thick * 0.5)
        ext_top = [dx, dy, top_thick]
        top_cap = trimesh.creation.box(extents=ext_top)
        top_cap.apply_translation([cx, cy, top_zc])
        _colorize(top_cap, COLOR_WINDOW)
        parts.append(top_cap)

    return trimesh.util.concatenate(parts)


# ---------------------------------------------------------------------------
# Vanos (puertas/ventanas) encajados en su muro
# ---------------------------------------------------------------------------

def _snap_opening(obox, wall_boxes):
    """
    Encaja el vano detectado en su muro anfitrión.

    - Espesor y eje: los del muro paralelo más grueso que lo contiene/toca
      (así el corte atraviesa todo el muro y la ventana queda centrada).
    - Largo: si entre una punta del vano y un muro quedan <= SNAP_GAP_M, se
      estira hasta tocarlo (cierra los huecos laterales).

    Returns:
        (Polygon del vano en metros, horizontal: bool)
    """
    minx, miny, maxx, maxy = obox.bounds
    horiz = (maxx - minx) >= (maxy - miny)
    if horiz:
        a0, a1, c0, c1 = minx, maxx, miny, maxy
    else:
        a0, a1, c0, c1 = miny, maxy, minx, maxx

    def span(w):
        x0, y0, x1, y1 = w.bounds
        return (x0, x1, y0, y1) if horiz else (y0, y1, x0, x1)

    hosts = []
    for w in wall_boxes:
        if w.area < 0.97 * box(*w.bounds).area:
            continue  # muro diagonal: su caja no es el muro
        wa0, wa1, wc0, wc1 = span(w)
        if (wa1 - wa0) < (wc1 - wc0):
            continue  # perpendicular
        if wc1 < c0 - 0.05 or wc0 > c1 + 0.05:
            continue  # fuera de la franja del vano
        if max(wa0 - a1, a0 - wa1, 0.0) <= SNAP_GAP_M:
            hosts.append((wa0, wa1, wc0, wc1))
    if hosts:
        _, _, c0, c1 = max(hosts, key=lambda h: h[3] - h[2])

    left, right = None, None
    for w in wall_boxes:
        wa0, wa1, wc0, wc1 = span(w)
        if wc1 <= c0 + 0.01 or wc0 >= c1 - 0.01:
            continue
        if wa1 <= a0 + 1e-6 and a0 - wa1 <= SNAP_GAP_M:
            left = wa1 if left is None else max(left, wa1)
        if wa0 >= a1 - 1e-6 and wa0 - a1 <= SNAP_GAP_M:
            right = wa0 if right is None else min(right, wa0)
    if left is not None:
        a0 = left
    if right is not None:
        a1 = right

    poly = box(a0, c0, a1, c1) if horiz else box(c0, a0, c1, a1)
    return poly, horiz


PIER_GAP_M = 0.60  # entre dos vanos vecinos, hasta esto se rellena con muro


def _gap_piers(snapped):
    """
    Pilares de muro entre vanos vecinos del mismo muro (ventana doble, dos
    puertas juntas...): rellena de piso a techo el espacio que queda entre
    ellos si mide <= PIER_GAP_M.

    Args:
        snapped: [(kind, poly, horiz)]
    Returns:
        [Polygon] en metros
    """
    piers = []
    for i in range(len(snapped)):
        for j in range(i + 1, len(snapped)):
            _, p1, h1 = snapped[i]
            _, p2, h2 = snapped[j]
            if h1 != h2:
                continue
            ax0, ay0, ax1, ay1 = p1.bounds
            bx0, by0, bx1, by1 = p2.bounds
            if h1:  # eje en x, espesor en y
                a = (ax0, ax1, ay0, ay1)
                b = (bx0, bx1, by0, by1)
            else:
                a = (ay0, ay1, ax0, ax1)
                b = (by0, by1, bx0, bx1)
            # Misma franja (comparten el muro): sus espesores se solapan
            if min(a[3], b[3]) - max(a[2], b[2]) < 0.05:
                continue
            first, second = (a, b) if a[0] <= b[0] else (b, a)
            gap = second[0] - first[1]
            if 1e-3 < gap <= PIER_GAP_M:
                c0, c1 = min(a[2], b[2]), max(a[3], b[3])
                u0, u1 = first[1], second[0]
                piers.append(box(u0, c0, u1, c1) if h1 else box(c0, u0, c1, u1))
    return piers


def _opening_frame(poly, horiz):
    """Centro (cx, cy), largo L (a lo largo del muro) y espesor e del vano."""
    minx, miny, maxx, maxy = poly.bounds
    cx, cy = (minx + maxx) / 2.0, (miny + maxy) / 2.0
    if horiz:
        return cx, cy, maxx - minx, maxy - miny
    return cx, cy, maxy - miny, maxx - minx


def _box_uv(cx, cy, horiz, u0, u1, v0, v1, z0, z1, color):
    """Caja en coordenadas del vano: u a lo largo del muro, v a través."""
    if horiz:
        ext = [u1 - u0, v1 - v0, z1 - z0]
        c = [cx + (u0 + u1) / 2.0, cy + (v0 + v1) / 2.0, (z0 + z1) / 2.0]
    else:
        ext = [v1 - v0, u1 - u0, z1 - z0]
        c = [cx + (v0 + v1) / 2.0, cy + (u0 + u1) / 2.0, (z0 + z1) / 2.0]
    m = trimesh.creation.box(extents=ext)
    m.apply_translation(c)
    return _colorize(m, color)


def _window_mesh(poly, horiz):
    """Ventana de 0.90 a 2.10 m: marco perimetral + vidrio + cruz."""
    cx, cy, L, e = _opening_frame(poly, horiz)
    z0, z1 = WINDOW_SILL_M, WINDOW_HEAD_M
    F = min(FRAME_M, L / 4.0)
    fd = min(e, 0.08)  # profundidad del marco
    zc = (z0 + z1) / 2.0
    C = COLOR_WINDOW
    parts = [
        _box_uv(cx, cy, horiz, -L / 2, -L / 2 + F, -fd / 2, fd / 2, z0, z1, C),
        _box_uv(cx, cy, horiz, L / 2 - F, L / 2, -fd / 2, fd / 2, z0, z1, C),
        _box_uv(cx, cy, horiz, -L / 2 + F, L / 2 - F, -fd / 2, fd / 2, z0, z0 + F, C),
        _box_uv(cx, cy, horiz, -L / 2 + F, L / 2 - F, -fd / 2, fd / 2, z1 - F, z1, C),
        # vidrio
        _box_uv(cx, cy, horiz, -L / 2 + F, L / 2 - F, -GLASS_M / 2, GLASS_M / 2,
                z0 + F, z1 - F, C),
        # parteluz (vertical) y travesaño (horizontal)
        _box_uv(cx, cy, horiz, -0.015, 0.015, -0.025, 0.025, z0 + F, z1 - F, C),
        _box_uv(cx, cy, horiz, -L / 2 + F, L / 2 - F, -0.025, 0.025,
                zc - 0.015, zc + 0.015, C),
    ]
    return trimesh.util.concatenate(parts)


def _door_mesh(poly, horiz):
    """Puerta de 2.10 m: marco (jambas + cabezal) y hoja delgada centrada."""
    cx, cy, L, e = _opening_frame(poly, horiz)
    H = DOOR_HEIGHT_M
    F = min(FRAME_M, L / 4.0)
    fd = min(e, 0.12)
    C = COLOR_DOOR
    parts = [
        _box_uv(cx, cy, horiz, -L / 2, -L / 2 + F, -fd / 2, fd / 2, 0.0, H, C),
        _box_uv(cx, cy, horiz, L / 2 - F, L / 2, -fd / 2, fd / 2, 0.0, H, C),
        _box_uv(cx, cy, horiz, -L / 2 + F, L / 2 - F, -fd / 2, fd / 2, H - F, H, C),
        _box_uv(cx, cy, horiz, -L / 2 + F, L / 2 - F, -DOOR_LEAF_M / 2, DOOR_LEAF_M / 2,
                0.0, H - F, C),
    ]
    return trimesh.util.concatenate(parts)


def _band(poly, z0, z1, color=COLOR_WALL):
    """Extruye `poly` entre z0 y z1 (antepecho / dintel)."""
    if poly.is_empty or z1 - z0 <= 1e-4:
        return None
    m = trimesh.creation.extrude_polygon(poly.buffer(0), height=z1 - z0)
    m.apply_translation([0, 0, z0])
    return _colorize(m, color)


OPENING_CUT_REACH_M = 0.35  # el vano corta muros paralelos hasta esto de su eje
LOOSE_PIECE_M = 0.05  # dintel/pilar a más de esto de su muro: pieza suelta


def _pier_gap(pier, snapped):
    """Largo del pilar a lo largo del muro (lo que separa a los dos vanos)."""
    if not snapped:
        x0, y0, x1, y1 = pier.bounds
        return min(x1 - x0, y1 - y0)
    horiz = min(snapped, key=lambda s_: s_[1].distance(pier))[2]
    x0, y0, x1, y1 = pier.bounds
    return (x1 - x0) if horiz else (y1 - y0)


def _place_piece(wall_boxes, piece, horiz):
    """
    Ubica una pieza de muro de un vano (dintel, antepecho, pilar) en SU muro:
    el muro PARALELO (misma orientación que el vano) cuya franja de grosor
    contiene la pieza. La pieza toma el eje y grosor de ese muro, así no
    sobresale como una lámina.

    Si ningún muro paralelo la contiene, la pieza queda como estaba (nunca
    se arma con un muro perpendicular ni se descarta: eso dejaba la puerta
    sin dintel o una placa atravesada).

    Returns: (índice del muro anfitrión, polígono de la pieza)
    """
    px0, py0, px1, py1 = piece.bounds
    pcx, pcy = (px0 + px1) / 2.0, (py0 + py1) / 2.0
    best, best_d = None, None
    for i, w in enumerate(wall_boxes):
        hx0, hy0, hx1, hy1 = w.bounds
        if w.area < 0.97 * box(hx0, hy0, hx1, hy1).area:
            continue  # diagonal
        w_h = (hx1 - hx0) >= (hy1 - hy0)
        if w_h != horiz:
            continue  # perpendicular: nunca
        if horiz:
            if not (hy0 - 0.05 <= pcy <= hy1 + 0.05):
                continue
            along = max(hx0 - px1, px0 - hx1, 0.0)
        else:
            if not (hx0 - 0.05 <= pcx <= hx1 + 0.05):
                continue
            along = max(hy0 - py1, py0 - hy1, 0.0)
        if along > 0.30:
            continue
        if best is None or along < best_d:
            best, best_d = i, along
    if best is None:
        host = min(range(len(wall_boxes)), key=lambda i: wall_boxes[i].distance(piece))
        return host, piece
    hx0, hy0, hx1, hy1 = wall_boxes[best].bounds
    shaped = box(px0, hy0, px1, hy1) if horiz else box(hx0, py0, hx1, py1)
    return best, shaped


def _opening_fillers(kind, poly):
    """Muro que queda por encima/debajo del vano (mismo color que el muro)."""
    if kind == "window":
        bands = [_band(poly, 0.0, WINDOW_SILL_M), _band(poly, WINDOW_HEAD_M, WALL_HEIGHT_M)]
    else:
        bands = [_band(poly, DOOR_HEIGHT_M, WALL_HEIGHT_M)]
    return [b for b in bands if b is not None]


def _largest_polygon(geom):
    """Devolver el polígono de mayor área de una geometría shapely."""
    if geom is None or geom.is_empty:
        return None
    if isinstance(geom, Polygon):
        return geom
    polys = [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon)]
    return max(polys, key=lambda g: g.area) if polys else None


def _footprint_polygon(wall_polys, opening_polys):
    """
    Contorno exterior de la casa (forma exacta, sin huecos interiores).

    Une muros + vanos (para que puertas/ventanas no abran el contorno),
    cierra uniones pequeñas y rellena el interior. Si el contorno no queda
    cerrado, usa la envolvente convexa como respaldo.
    """
    union = unary_union(list(wall_polys) + list(opening_polys)).buffer(0)
    if union.is_empty:
        return None
    total_len = sum(max(p.bounds[2] - p.bounds[0], p.bounds[3] - p.bounds[1]) for p in wall_polys)
    # Cierre progresivo: la menor distancia que deja una sola forma que
    # contiene casi todos los muros. Así una casa en L queda en L (la
    # envolvente convexa agregaba un triángulo fuera de la casa).
    candidates = []
    # Nunca más allá de los muros reales: el cierre con esquinas en punta
    # (mitre) dejaba "pinchos" de varios metros en esquinas agudas que
    # llevaban el piso y muros inventados hasta la terraza.
    hull = union.convex_hull.buffer(0.05)
    for close in (FOOTPRINT_CLOSE_M, 1.2, 2.0, 3.0):
        closed = union.buffer(close, join_style=2, mitre_limit=1.5).buffer(-close, join_style=2, mitre_limit=1.5)
        main = _largest_polygon(closed.intersection(hull))
        if main is None:
            continue
        footprint = Polygon(main.exterior).simplify(0.05, preserve_topology=True).buffer(0)
        inside = sum(
            max(p.bounds[2] - p.bounds[0], p.bounds[3] - p.bounds[1])
            for p in wall_polys if footprint.buffer(0.05).contains(p.representative_point())
        )
        candidates.append((footprint, inside))
    if candidates:
        # Área "estable" (cierre máximo): el contorno elegido debe cubrir casi
        # toda la casa, no solo la parte que ya cerraba (muros cortados).
        stable = max(fp.area for fp, _ in candidates)
        for footprint, inside in candidates:
            if footprint.area >= 0.9 * stable and (not total_len or inside >= 0.85 * total_len):
                return footprint
    # Último recurso: la forma más grande cerrada (nunca la envolvente
    # convexa, que se sale de la casa).
    closed = union.buffer(3.0, join_style=2, mitre_limit=1.5).buffer(-3.0, join_style=2, mitre_limit=1.5)
    main = _largest_polygon(closed.intersection(union.convex_hull.buffer(0.05)))
    return Polygon(main.exterior).buffer(0) if main is not None else None


def _extrude_mapped(poly, z_of_xy, thickness_of_xy, color):
    """
    Extruir un polígono con altura unitaria y remapear Z por vértice:
        z_final = z_of_xy(x, y) + z_unit * thickness_of_xy(x, y)
    Con funciones lineales en (x, y) las caras quedan planas y el sólido
    sigue siendo cerrado.
    """
    meshes = []
    for p in ([poly] if isinstance(poly, Polygon) else list(poly.geoms)):
        clean = p.buffer(0)
        if clean.is_empty or clean.area < 1e-6:
            continue
        m = trimesh.creation.extrude_polygon(clean, height=1.0)
        v = m.vertices.copy()
        x, y, zu = v[:, 0], v[:, 1], v[:, 2]
        v[:, 2] = z_of_xy(x, y) + zu * thickness_of_xy(x, y)
        m.vertices = v
        m.remove_degenerate_faces()
        m.remove_unreferenced_vertices()
        repair.fix_normals(m)
        _colorize(m, color)
        meshes.append(m)
    return trimesh.util.concatenate(meshes) if meshes else None


def _floor_mesh(footprint):
    """Losa de piso con la forma exacta de la casa, bajo z=0."""
    return _extrude_mapped(
        footprint,
        lambda x, y: np.full_like(x, -SLAB_THICKNESS_M),
        lambda x, y: np.full_like(x, SLAB_THICKNESS_M),
        COLOR_FLOOR,
    )


def _ridge_frame(footprint):
    """
    Cumbrera del techo a dos aguas: eje largo del rectángulo mínimo
    rotado. Devuelve (centro, dirección, normal, semiancho).
    """
    rect = footprint.minimum_rotated_rectangle
    pts = np.array(rect.exterior.coords)[:4]
    e1, e2 = pts[1] - pts[0], pts[2] - pts[1]
    long_edge, short_edge = (e1, e2) if np.linalg.norm(e1) >= np.linalg.norm(e2) else (e2, e1)
    direction = long_edge / max(np.linalg.norm(long_edge), 1e-9)
    normal = np.array([-direction[1], direction[0]])
    center = pts.mean(axis=0)
    half_width = np.linalg.norm(short_edge) / 2.0
    return center, direction, normal, half_width


def _split_by_ridge(poly, center, direction):
    """Dividir un polígono en piezas a cada lado de la cumbrera."""
    from shapely.ops import split
    far = 1e4
    ridge = LineString([
        tuple(center - direction * far), tuple(center + direction * far)
    ])
    pieces = split(poly, ridge)
    return [g for g in getattr(pieces, "geoms", [pieces]) if isinstance(g, Polygon)]


def _roof_meshes(footprint, roof_type):
    """
    Construir el techo. Devuelve lista de (nombre_nodo, mesh).
    - plano: losa con alero sobre los muros.
    - dos_aguas: dos faldones inclinados siguiendo la forma exacta, más los
      hastiales (relleno de muro entre la altura de los muros y el techo).
    """
    if roof_type not in ("plano", "dos_aguas") or footprint is None:
        return []

    eave = footprint.buffer(ROOF_OVERHANG_M, join_style=2)

    if roof_type == "plano":
        mesh = _extrude_mapped(
            eave,
            lambda x, y: np.full_like(x, WALL_HEIGHT_M),
            lambda x, y: np.full_like(x, ROOF_THICKNESS_M),
            COLOR_ROOF,
        )
        return [("roof_0", mesh)] if mesh is not None else []

    center, direction, normal, half_width = _ridge_frame(footprint)
    slope = np.tan(np.radians(ROOF_PITCH_DEG))

    def roof_z(x, y):
        d = np.abs((x - center[0]) * normal[0] + (y - center[1]) * normal[1])
        return WALL_HEIGHT_M + slope * (half_width - d)

    result = []
    for i, piece in enumerate(_split_by_ridge(eave, center, direction)):
        mesh = _extrude_mapped(
            piece, roof_z,
            lambda x, y: np.full_like(x, ROOF_THICKNESS_M),
            COLOR_ROOF,
        )
        if mesh is not None:
            result.append((f"roof_{i}", mesh))

    # Hastiales: franja de muros perimetrales desde z=H hasta el techo
    band = footprint.difference(
        footprint.buffer(-WALL_THICKNESS_M, join_style=2)
    ).buffer(0)
    gables = []
    for piece in _split_by_ridge(band, center, direction):
        m = _extrude_mapped(
            piece,
            lambda x, y: np.full_like(x, WALL_HEIGHT_M),
            lambda x, y: np.maximum(roof_z(x, y) - WALL_HEIGHT_M, 0.0),
            COLOR_WALL,
        )
        if m is not None:
            gables.append(m)
    if gables:
        # Se nombra como muro: es mampostería, no cubierta
        result.append(("wall_gable_0", trimesh.util.concatenate(gables)))
    return result


def build_scene_mesh(det_json: dict, min_score=0.0, cut_openings=True,
                     roof_type="plano", fill_gaps=True, drawn=None, control_out=None):
    """
    Construir escena 3D completa desde detecciones.

    Args:
        det_json: Diccionario con datos de detección
        min_score: Score mínimo para incluir detecciones
        cut_openings: Si se deben recortar vanos en muros
        fill_gaps: True rellena huecos entre muros sin puerta/ventana
            detectada; False los deja como paso (con dintel)
        drawn: comprobador de la imagen del plano (walls_fix.make_ink_checker):
            un hueco solo se rellena si ahí hay pared dibujada (igual al plano)

    Returns:
        trimesh.Scene o None
    """
    px2m = _pixel_to_meter_from_det(det_json, fallback=0.01)
    img_width = det_json.get("Width", 1000)
    img_height = det_json.get("Height", 1000)

    # Lista de tuplas (polygon, is_external, wall_index)
    walls = []
    diag_walls = []  # muros diagonales/curvos (polígonos girados)
    opening_polys = []
    raw_openings = []  # (kind, caja detectada en metros)
    doors = []
    windows = []
    wall_index = 0

    for roi, name, sc in _iter_rois(det_json):
        if sc < min_score:
            continue
        if name == "wall" and roi.get('line'):
            # Muro diagonal (o tramo de muro curvo): rectángulo girado a lo
            # largo de su eje. No pasa por fix_walls (que es solo H/V).
            lx1, ly1, lx2, ly2 = (float(v) * px2m for v in roi['line'])
            thick_px = float(roi.get('thickness') or 0)
            thick_m = max(0.08, thick_px * px2m) if thick_px else WALL_THICKNESS_M
            poly = LineString([(lx1, ly1), (lx2, ly2)]).buffer(thick_m / 2.0, cap_style=2, join_style=2)
            if not poly.is_empty:
                diag_walls.append((poly, False, 9000 + wall_index))
                wall_index += 1
        elif name == "wall":
            # Convertir ROI a rectángulo en metros
            x1_m = roi['x1'] * px2m
            y1_m = roi['y1'] * px2m
            x2_m = roi['x2'] * px2m
            y2_m = roi['y2'] * px2m

            # Crear rectángulo directamente desde las coordenadas
            wall_box = box(
                min(x1_m, x2_m), min(y1_m, y2_m),
                max(x1_m, x2_m), max(y1_m, y2_m)
            )

            # Clasificar si es muro externo o interno
            is_external = _is_external_wall(
                roi, px2m, img_width, img_height
            )
            walls.append((wall_box, is_external, wall_index))
            wall_index += 1

        elif name in ("door", "window"):
            raw_openings.append((name, box(
                min(roi['x1'], roi['x2']) * px2m, min(roi['y1'], roi['y2']) * px2m,
                max(roi['x1'], roi['x2']) * px2m, max(roi['y1'], roi['y2']) * px2m,
            )))

    if not walls and not diag_walls:
        return None

    # Muros continuos: une tramos, cierra esquinas y quita duplicados. Los
    # espacios con una puerta/ventana detectada nunca se rellenan.
    from .walls_fix import complete_perimeter, fix_walls
    if walls:
        walls, passages = fix_walls(
            walls, [o for _, o in raw_openings], fill_gaps=fill_gaps, drawn=drawn
        )
    else:
        passages = []
    # Grosor y posición reales de cada muro, medidos en el dibujo (paredes
    # exteriores rayadas: sin fachadas escalonadas ni ventanas corridas).
    if walls and not (det_json.get('quality') or {}).get('boceto') and             __import__('os').environ.get('PLAN_FIT_THICKNESS', '1') != '0':
        try:
            from .walls_fix import fit_wall_thickness
            walls, _n_fit = fit_wall_thickness(walls, drawn)
            det_json.setdefault('quality', {})['muros_ajustados'] = _n_fit
        except Exception as exc:  # nunca romper la generación por esto
            print('[fit_wall_thickness] {}'.format(exc))
    # Los diagonales entran después (el contorno los tiene en cuenta: así no
    # se "inventa" una esquina recta donde hay una ochava).
    walls = list(walls) + diag_walls
    # Borde exterior cerrado aunque un mueble tape la pared en el dibujo.
    walls, _ = complete_perimeter(walls, [o for _, o in raw_openings], passages)
    # Uniones prolijas: sin picos, rendijas, escalones ni restos sueltos.
    import os
    from .walls_fix import clean_joints, joint_report
    sketch = bool((det_json.get('quality') or {}).get('boceto'))
    open_polys = [o for _, o in raw_openings] + list(passages)
    if os.environ.get('PLAN_CLEAN_JOINTS', '1') != '0':
        try:
            walls = clean_joints(walls, open_polys, sketch=sketch, drawn=drawn)
        except Exception as exc:  # nunca romper la generación por esto
            print('[clean_joints] {}'.format(exc))
    # Fidelidad al plano: recorta lo que no está dibujado y agrega paredes
    # dibujadas que faltaban (necesita la imagen: drawn).
    if os.environ.get('PLAN_FIDELITY', '1') != '0':
        try:
            from .walls_fix import fidelity_check
            walls, fid = fidelity_check(walls, open_polys, drawn, sketch=sketch)
            if fid:
                det_json.setdefault('quality', {})['fidelidad'] = fid
            # segunda pasada: los muros agregados o recortados también quedan prolijos
            walls = clean_joints(walls, open_polys, sketch=sketch, drawn=drawn)
        except Exception as exc:  # nunca romper la generación por esto
            print('[fidelity_check] {}'.format(exc))
    # Regla final: lo que no está dibujado no va (copias paralelas, tramos
    # sin tinta, contornos inventados largos). Después, uniones prolijas.
    if os.environ.get('PLAN_INK_AUDIT', '1') != '0':
        try:
            from .walls_fix import ink_audit
            walls, aud = ink_audit(walls, open_polys, drawn)
            if aud:
                det_json.setdefault('quality', {})['auditoria'] = aud
                walls = clean_joints(walls, open_polys, sketch=sketch, drawn=drawn)
        except Exception as exc:  # nunca romper la generación por esto
            print('[ink_audit] {}'.format(exc))
    # El plano manda: comparación píxel a píxel (sobrantes, rendijas,
    # faltantes) + imagen de control.
    if os.environ.get('PLAN_PIXEL_FIDELITY', '1') != '0':
        try:
            from .walls_fix import pixel_fidelity
            walls, pxr, control = pixel_fidelity(walls, open_polys, drawn, sketch=sketch)
            if pxr:
                det_json.setdefault('quality', {})['fidelidad_px'] = pxr
            if control is not None and control_out is not None:
                control_out['image'] = control
        except Exception as exc:  # nunca romper la generación por esto
            print('[pixel_fidelity] {}'.format(exc))
    try:
        det_json.setdefault('quality', {})['uniones'] = joint_report(walls, open_polys, sketch=sketch)
    except Exception:
        pass
    # Exterior = toca el contorno del edificio (no el borde de la imagen:
    # con márgenes en el plano todos quedaban como "internos").
    walls = _classify_external(walls, [o for _, o in raw_openings])

    # Vanos encajados en su muro: espesor real, centrados y sin huecos laterales
    wall_boxes = [w[0] for w in walls]
    fillers = {}  # índice de muro anfitrión -> [mallas de antepecho/dintel]
    cut_polys = []
    snapped = [(kind,) + _snap_opening(obox, wall_boxes) for kind, obox in raw_openings]

    # Pilares de muro entre vanos vecinos (ventana doble, puertas juntas)
    loose = 0  # piezas que no encontraron un muro paralelo (quedan como estaban)

    def _orient_of(poly):
        # orientación del vano más cercano (un pilar corto no la dice solo)
        if not snapped:
            x0, y0, x1, y1 = poly.bounds
            return (x1 - x0) >= (y1 - y0)
        return min(snapped, key=lambda s_: s_[1].distance(poly))[2]

    for pier in _gap_piers(snapped):
        # Pilar angosto (<= 15 cm) entre dos vanos: siempre (si no, queda una
        # ranura de piso a techo). Más ancho: solo si el plano tiene pared ahí.
        narrow = _pier_gap(pier, snapped) <= 0.15
        if not narrow and drawn is not None and drawn(pier) is False:
            continue  # entre esos vanos el plano no tiene pared: no se inventa
        host, shaped = _place_piece(wall_boxes, pier, _orient_of(pier))
        if shaped is pier:
            loose += 1
        fillers.setdefault(host, []).append(_band(shaped, 0.0, WALL_HEIGHT_M))
        opening_polys.append(shaped)  # para el contorno del piso

    # Pasos sin puerta ("Dejar paso"): abiertos con muro encima (dintel)
    for passage in passages:
        px0_, py0_, px1_, py1_ = passage.bounds
        host, shaped = _place_piece(wall_boxes, passage, (px1_ - px0_) >= (py1_ - py0_))
        if shaped is passage:
            loose += 1
        band = _band(shaped, DOOR_HEIGHT_M, WALL_HEIGHT_M)
        if band is not None:
            fillers.setdefault(host, []).append(band)
        opening_polys.append(passage)

    for kind, poly, horiz in snapped:
        opening_polys.append(poly)
        if kind == "door":
            doors.append(_door_mesh(poly, horiz))
        else:
            windows.append(_window_mesh(poly, horiz))
        if cut_openings:
            # El corte sobresale un poco de las CARAS del muro (evita láminas),
            # pero no a lo largo: así el antepecho/dintel empalma sin rendija.
            # El corte atraviesa TODOS los muros paralelos pegados (±35 cm del
            # eje del vano): una copia corrida del muro nunca tapa la puerta.
            bx0, by0, bx1, by1 = poly.bounds
            cy, cx = (by0 + by1) / 2.0, (bx0 + bx1) / 2.0
            reach = max(OPENING_CUT_REACH_M, (by1 - by0 if horiz else bx1 - bx0) / 2.0 + EPS_CUT)
            cut_polys.append(
                box(bx0, cy - reach, bx1, cy + reach) if horiz
                else box(cx - reach, by0, cx + reach, by1)
            )
            host, shaped = _place_piece(wall_boxes, poly, horiz)
            if shaped is poly:
                loose += 1
            fillers.setdefault(host, []).extend(_opening_fillers(kind, shaped))

    det_json.setdefault('quality', {})['piezas_sueltas'] = loose

    scene = trimesh.Scene()
    openings_union = unary_union(cut_polys).buffer(0) if cut_polys else None

    # Control: ningún muro (ya recortado) puede quedar delante de un vano
    front = 0
    for kind, poly, horiz in snapped:
        bx0, by0, bx1, by1 = poly.bounds
        cy, cx = (by0 + by1) / 2.0, (bx0 + bx1) / 2.0
        band = (box(bx0 + 0.03, cy - OPENING_CUT_REACH_M, bx1 - 0.03, cy + OPENING_CUT_REACH_M) if horiz
                else box(cx - OPENING_CUT_REACH_M, by0 + 0.03, cx + OPENING_CUT_REACH_M, by1 - 0.03))
        for wall_poly, _, _ in walls:
            rest = wall_poly.difference(openings_union) if openings_union is not None else wall_poly
            if rest.intersection(band).area > 1e-3:
                front += 1
                break
    det_json.setdefault('quality', {})['muro_delante_de_vano'] = front

    # Crear mesh individual para cada muro
    for pos, (wall_poly, is_external, w_idx) in enumerate(walls):
        # Recorte en planta de los vanos; el antepecho/dintel se agrega abajo
        final_wall_poly = wall_poly
        if openings_union is not None:
            final_wall_poly = wall_poly.difference(openings_union).buffer(0)

        # Crear mesh individual
        wall_mesh = _extrude_polygon_union(final_wall_poly)
        extra = fillers.get(pos, [])
        if extra:
            wall_mesh = trimesh.util.concatenate(
                ([wall_mesh] if wall_mesh is not None else []) + extra
            )
        if wall_mesh is not None:
            # Nombre específico según tipo de muro
            wall_type = "external" if is_external else "internal"
            node_name = f"wall_{wall_type}_{w_idx}"
            # dos tramos con el mismo índice (un muro partido) no se pisan
            k = 1
            while node_name in scene.graph.nodes:
                node_name = f"wall_{wall_type}_{w_idx}_{k}"
                k += 1
            scene.add_geometry(wall_mesh, node_name=node_name)

    for i, mesh in enumerate(doors):
        scene.add_geometry(mesh, node_name=f"door_{i}")

    for i, mesh in enumerate(windows):
        scene.add_geometry(mesh, node_name=f"window_{i}")

    # Piso (losa) y techo con la forma exacta de la casa
    try:
        footprint = _footprint_polygon(
            [w[0] for w in walls], opening_polys
        )
        if footprint is not None:
            floor = _floor_mesh(footprint)
            if floor is not None:
                scene.add_geometry(floor, node_name="floor_0")
            for node_name, mesh in _roof_meshes(footprint, roof_type):
                scene.add_geometry(mesh, node_name=node_name)
    except Exception as exc:  # No romper la generación por piso/techo
        print(f"[three] No se pudo generar piso/techo: {exc}")

    return scene if len(scene.geometry) > 0 else None


def _iter_trimeshes(geom):
    """Iterar las mallas (Trimesh) de una escena o de una sola malla."""
    if isinstance(geom, trimesh.Scene):
        return list(geom.geometry.values())
    return [geom]


def _orient_floorplan(geom):
    """
    Pasar el plano (X=imagen_x, Y=imagen_y, Z=altura) a un modelo Y-up que
    coincide EXACTAMENTE con el plano de entrada (sin quedar espejado).

    La imagen usa Y hacia abajo (sistema levógiro), por lo que la conversion
    correcta es una reflexion que intercambia los ejes Y y Z:

        (x, y, z)  ->  (X=x, Y=z [altura], Z=y [imagen_y])

    Al ser una reflexion (det = -1) el winding de las caras se invierte, por
    eso se recomputan las normales hacia afuera.
    """
    swap_yz = np.array([
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ])
    for mesh in _iter_trimeshes(geom):
        mesh.apply_transform(swap_yz)
        repair.fix_normals(mesh)


def export_glb(geom, out: str, make_y_up: bool = True):
    """
    Exportar geometría a formato GLB.

    Args:
        geom: Geometría trimesh a exportar
        out: Ruta de salida o file object
        make_y_up: Si True, orienta el plano a Y-up coincidiendo con el plano
                   de entrada (Z-up -> Y-up sin espejar).
    """
    if make_y_up:
        _orient_floorplan(geom)

    if hasattr(out, "write"):
        geom.export(out, file_type='glb')
    else:
        geom.export(out)