"""
Banco de pruebas del 2D -> 3D.

Uso (dentro del contenedor del API):
    python scripts/bench_plans.py [carpeta_o_imagenes...] [--out carpeta]

Por cada plano imprime el informe de calidad (muros, interiores, escala,
score) y guarda una imagen con lo detectado dibujado encima, para comparar
antes/después de cada cambio. PLAN_GEMINI=0 desactiva Gemini.
"""
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'plasma3d_api.settings')
import django  # noqa: E402

django.setup()

from PIL import Image, ImageDraw  # noqa: E402

from plans.pipeline import enrich_detections  # noqa: E402
from plans.preprocess import prepare_plan_image  # noqa: E402
from plans.three import build_scene_mesh  # noqa: E402

COLORS = {'wall': (230, 0, 0), 'door': (0, 160, 0), 'window': (0, 90, 230)}


def _openings_without_wall_above(scene):
    """
    Puertas/ventanas sin muro encima en todo su largo (dintel faltante o
    pieza armada mal). Se juntan en 2D las caras superiores (z=3 m) de los
    muros y se revisa que cubran cada vano.
    """
    import numpy as np
    from shapely.geometry import Point, Polygon
    from shapely.ops import unary_union

    tops = []
    for node in scene.graph.nodes_geometry:
        if not node.startswith('wall'):
            continue
        T, g = scene.graph[node]
        w = scene.geometry[g].copy()
        w.apply_transform(T)
        for f in w.faces:
            v = w.vertices[f]
            if v[:, 2].min() > 2.9:
                pg = Polygon(v[:, :2])
                if pg.area > 1e-8:
                    tops.append(pg)
    upper = unary_union(tops).buffer(0.01) if tops else None
    bad = 0
    for node in scene.graph.nodes_geometry:
        if not node.startswith(('door', 'window')):
            continue
        T, g = scene.graph[node]
        m = scene.geometry[g].copy()
        m.apply_transform(T)
        (x0, y0, _), (x1, y1, _) = m.bounds
        horiz = (x1 - x0) >= (y1 - y0)
        pts = ([(x, (y0 + y1) / 2) for x in np.linspace(x0 + 0.03, x1 - 0.03, 8)] if horiz
               else [((x0 + x1) / 2, y) for y in np.linspace(y0 + 0.03, y1 - 0.03, 8)])
        if upper is None or any(not upper.contains(Point(p)) for p in pts):
            bad += 1
    return bad


def run(path, out_dir):
    img = Image.open(path).convert('RGB')
    r = prepare_plan_image(img)
    img = r[0] if isinstance(r, tuple) else r
    W, H = img.size
    ml = {'points': [], 'classes': [], 'scores': [], 'Width': W, 'Height': H, 'averageDoor': 0}
    try:
        from plans.inference import run_inference  # IA real si está disponible
        ml = run_inference(img) or ml
    except Exception:
        pass
    det = enrich_detections(ml, img)
    from plans.three import _pixel_to_meter_from_det
    from plans.walls_fix import make_ink_checker
    px2m = _pixel_to_meter_from_det(det, fallback=0.01)
    control = {}
    scene = build_scene_mesh(det, drawn=make_ink_checker(img, px2m, sketch=bool(det['quality'].get('boceto'))),
                             control_out=control)
    q = det['quality']
    nodes = list(scene.graph.nodes_geometry) if scene is not None else []
    q['nodos_ext'] = sum('external' in n for n in nodes)
    q['vanos_sin_dintel'] = _openings_without_wall_above(scene) if scene is not None else None
    q['nodos_int'] = sum('internal' in n for n in nodes)
    over = img.copy()
    d = ImageDraw.Draw(over)
    for p, c in zip(det['points'], det['classes']):
        d.rectangle([p['x1'], p['y1'], p['x2'], p['y2']], outline=COLORS.get(c['name'], (0, 0, 0)), width=3)
    name = os.path.splitext(os.path.basename(path))[0]
    over.save(os.path.join(out_dir, name + '_det.png'))
    if control.get('image') is not None:
        control['image'].save(os.path.join(out_dir, name + '_control.png'))
    # planta del 3D: muros (rojo ext, azul int), puertas verde, ventanas celeste
    if scene is not None:
        top = Image.new('RGB', img.size, 'white')
        td = ImageDraw.Draw(top)
        for node in scene.graph.nodes_geometry:
            T, g = scene.graph[node]
            m = scene.geometry[g].copy()
            m.apply_transform(T)
            col = ((200, 0, 0) if 'external' in node else (0, 0, 200) if node.startswith('wall')
                   else (0, 170, 0) if node.startswith('door') else (0, 170, 220) if node.startswith('window') else None)
            if col is None:
                continue
            (x0, y0, _), (x1, y1, _) = m.bounds
            if node.startswith('wall'):
                for f in m.faces:  # caras superiores (forma real del muro)
                    v = m.vertices[f]
                    if v[:, 2].min() > 2.9:
                        td.polygon([(x / px2m, y / px2m) for x, y, _ in v], fill=col)
            else:
                td.rectangle([x0 / px2m, y0 / px2m, x1 / px2m, y1 / px2m], outline=col, width=3)
        top.save(os.path.join(out_dir, name + '_3d.png'))
    return q


def main():
    args = sys.argv[1:]
    out_dir = '/tmp/bench'
    if '--out' in args:
        i = args.index('--out')
        out_dir = args[i + 1]
        del args[i:i + 2]
    os.makedirs(out_dir, exist_ok=True)
    files = []
    for a in args or ['plans/tests/fixtures']:
        files += sorted(glob.glob(os.path.join(a, '*'))) if os.path.isdir(a) else [a]
    for f in files:
        try:
            q = run(f, out_dir)
            keep = ('fidelidad_px', 'vanos_sin_dintel', 'muro_delante_de_vano', 'auditoria', 'uniones', 'piezas_sueltas', 'muros', 'muros_diagonales', 'muros_ia', 'muros_ia_descartados', 'muros_detector', 'muros_interiores', 'muros_gemini', 'puertas', 'puertas_gemini', 'puertas_entrada', 'boceto', 'ventanas', 'ventanas_gemini', 'escala', 'ancho_m', 'score', 'nodos_ext', 'nodos_int')
            print(os.path.basename(f), json.dumps({k: q.get(k) for k in keep}, ensure_ascii=False))
        except Exception as exc:
            print(os.path.basename(f), 'ERROR', exc)


if __name__ == '__main__':
    main()
