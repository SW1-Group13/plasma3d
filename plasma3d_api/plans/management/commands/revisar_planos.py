"""
Revisa todos los planos guardados: cuántos huecos entre muros quedan
abiertos con la generación actual (y cuántos había sin corregir).

    python manage.py revisar_planos            # solo informe
    python manage.py revisar_planos --regenerar  # además regenera los GLB
    python manage.py revisar_planos --plano 6    # un solo plano, con detalle
"""
import json

from django.core.management.base import BaseCommand
from shapely.geometry import box

from plans.models import Plan3DJob
from plans.three import _gap_piers, _iter_rois, _pixel_to_meter_from_det, _snap_opening
from plans.walls_fix import complete_perimeter, fix_walls, make_ink_checker, open_ends


def _detections(job):
    with job.detections_json.open('rb') as fh:
        return json.loads(fh.read().decode('utf-8'))


def _boxes(det):
    px2m = _pixel_to_meter_from_det(det, fallback=0.01)
    walls, openings = [], []
    for i, (roi, name, _score) in enumerate(_iter_rois(det)):
        b = box(
            min(roi['x1'], roi['x2']) * px2m, min(roi['y1'], roi['y2']) * px2m,
            max(roi['x1'], roi['x2']) * px2m, max(roi['y1'], roi['y2']) * px2m,
        )
        if name == 'wall':
            walls.append((b, False, i))
        elif name in ('door', 'window'):
            openings.append(b)
    return walls, openings


def _image(job):
    if not job.plan_image:
        return None
    try:
        from PIL import Image
        with job.plan_image.open('rb') as fh:
            image = Image.open(fh)
            image.load()
        return image
    except Exception:
        return None


def _ink(job, det):
    """Comprobador de la imagen del plano (None si no hay imagen)."""
    image = _image(job)
    if image is None:
        return None
    return make_ink_checker(image, _pixel_to_meter_from_det(det, fallback=0.01))


def _enriched(job, det):
    """Detecciones como las genera la app: IA + detector clásico + escala."""
    image = _image(job)
    if image is None:
        return det
    from plans.pipeline import enrich_detections, raw_ml
    return enrich_detections(raw_ml(det), image, det.get('realWidthM'))


def huecos(walls, openings, drawn=None):
    """Huecos abiertos tal como quedan al generar (vanos ya encajados)."""
    wall_boxes = [w[0] for w in walls]
    snapped = [('x',) + _snap_opening(o, wall_boxes) for o in openings]
    polys = [s[1] for s in snapped] + _gap_piers(snapped)
    return open_ends(wall_boxes, polys, drawn=drawn)


class Command(BaseCommand):
    help = 'Revisa los huecos entre muros de todos los planos (y opcionalmente los regenera).'

    def add_arguments(self, parser):
        parser.add_argument('--regenerar', action='store_true', help='Regenera el GLB de cada plano.')
        parser.add_argument('--plano', type=int, help='Revisar solo este plano (con detalle).')

    def handle(self, *args, **opts):
        jobs = Plan3DJob.objects.exclude(detections_json='').exclude(detections_json=None).order_by('id')
        if opts.get('plano'):
            jobs = jobs.filter(id=opts['plano'])
        total_ok = 0
        for job in jobs:
            try:
                det = _enriched(job, _detections(job))
            except Exception as exc:
                self.stdout.write(f'Plano #{job.id}: no se pudieron leer las detecciones ({exc})')
                continue
            walls, openings = _boxes(det)
            drawn = _ink(job, det)
            antes = huecos(walls, openings, drawn)
            fixed, pasos = fix_walls(walls, openings, fill_gaps=True, drawn=drawn)
            _, perimetro_antes = complete_perimeter(fixed, openings, pasos)
            fixed, _ = complete_perimeter(fixed, openings, pasos)
            _, perimetro_despues = complete_perimeter(fixed, openings, pasos)
            despues = huecos(fixed, openings, drawn)
            estado = 'OK' if not despues and perimetro_despues < 0.4 else (
                f'{len(despues)} hueco(s), perímetro abierto {perimetro_despues} m'
            )
            q = det.get('quality') or {}
            total_ok += not despues
            self.stdout.write(
                f'Plano #{job.id}: muros {len(walls)}->{len(fixed)} | huecos sin corregir {len(antes)} '
                f'| con corrección {len(despues)} | aberturas del plano {len(pasos)} '
                f'| {"con" if drawn else "sin"} imagen -> {estado}'
            )
            self.stdout.write(f'    perímetro sin muro: {perimetro_antes} m (se completa al generar)')
            if q:
                self.stdout.write(
                    f'    puertas {q.get("puertas")} (IA {q.get("puertas_ia")}, detector {q.get("puertas_detector")}) '
                    f'| ventanas {q.get("ventanas")} | escala {q.get("escala")} ({q.get("ancho_m")} m de ancho)'
                )
                for aviso in q.get('avisos', []):
                    self.stdout.write(f'    aviso: {aviso}')
            if opts.get('plano') or despues:
                for x, y, gap in despues:
                    self.stdout.write(f'    hueco en ({x}, {y}) de {gap} m')
            if opts.get('regenerar'):
                from plans.views import process_and_save_glb, _roof_type_from_glb
                roof = _roof_type_from_glb(job) if job.glb_model else 'plano'
                process_and_save_glb(job, det, roof, True, drawn)
                self.stdout.write(f'    regenerado ({roof})')
        self.stdout.write(f'Planos sin huecos: {total_ok}/{jobs.count()}')
