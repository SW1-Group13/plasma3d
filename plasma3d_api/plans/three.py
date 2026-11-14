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
FOOTPRINT_CLOSE_M = 0.30  # Cierra pequeñas uniones abiertas entre muros
ROOF_TYPES = ("ninguno", "plano", "dos_aguas")


def _pixel_to_meter_from_det(det: dict, fallback=0.01):
    """
    Calcular escala de píxeles a metros.

    Usa averageDoor si existe (asumiendo 0.90 m de ancho de puerta).
    """
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
    closed = union.buffer(FOOTPRINT_CLOSE_M, join_style=2).buffer(
        -FOOTPRINT_CLOSE_M, join_style=2
    )
    main = _largest_polygon(closed)
    hull = union.convex_hull
    if main is None:
        return hull if isinstance(hull, Polygon) else None

    footprint = Polygon(main.exterior).simplify(
        0.05, preserve_topology=True
    ).buffer(0)
    # Si el relleno es mucho menor que la envolvente, los muros no cierran
    # (plano abierto/incompleto): usar la envolvente convexa.
    if footprint.is_empty or footprint.area < 0.5 * hull.area:
        return hull if isinstance(hull, Polygon) else None
    return footprint


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
                     roof_type="plano"):
    """
    Construir escena 3D completa desde detecciones.

    Args:
        det_json: Diccionario con datos de detección
        min_score: Score mínimo para incluir detecciones
        cut_openings: Si se deben recortar vanos en muros

    Returns:
        trimesh.Scene o None
    """
    px2m = _pixel_to_meter_from_det(det_json, fallback=0.01)
    img_width = det_json.get("Width", 1000)
    img_height = det_json.get("Height", 1000)

    # Lista de tuplas (polygon, is_external, wall_index)
    walls = []
    opening_polys = []
    raw_openings = []  # (kind, caja detectada en metros)
    doors = []
    windows = []
    wall_index = 0

    for roi, name, sc in _iter_rois(det_json):
        if sc < min_score:
            continue
        if name == "wall":
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

    if not walls:
        return None

    # Vanos encajados en su muro: espesor real, centrados y sin huecos laterales
    wall_boxes = [w[0] for w in walls]
    fillers = {}  # índice de muro anfitrión -> [mallas de antepecho/dintel]
    cut_polys = []
    snapped = [(kind,) + _snap_opening(obox, wall_boxes) for kind, obox in raw_openings]

    # Pilares de muro entre vanos vecinos (ventana doble, puertas juntas)
    for pier in _gap_piers(snapped):
        host = min(range(len(wall_boxes)), key=lambda i: wall_boxes[i].distance(pier))
        fillers.setdefault(host, []).append(_band(pier, 0.0, WALL_HEIGHT_M))
        opening_polys.append(pier)  # para el contorno del piso

    for kind, poly, horiz in snapped:
        opening_polys.append(poly)
        if kind == "door":
            doors.append(_door_mesh(poly, horiz))
        else:
            windows.append(_window_mesh(poly, horiz))
        if cut_openings:
            # El corte sobresale un poco de las CARAS del muro (evita láminas),
            # pero no a lo largo: así el antepecho/dintel empalma sin rendija.
            bx0, by0, bx1, by1 = poly.bounds
            cut_polys.append(
                box(bx0, by0 - EPS_CUT, bx1, by1 + EPS_CUT) if horiz
                else box(bx0 - EPS_CUT, by0, bx1 + EPS_CUT, by1)
            )
            host = min(range(len(wall_boxes)), key=lambda i: wall_boxes[i].distance(poly))
            fillers.setdefault(host, []).extend(_opening_fillers(kind, poly))

    scene = trimesh.Scene()
    openings_union = unary_union(cut_polys).buffer(0) if cut_polys else None

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