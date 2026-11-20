# plans/views.py
import io
import json
import os
import re
import tempfile
import time
from datetime import date

from django.conf import settings
from django.core.files.base import ContentFile
from rest_framework import status
from rest_framework.decorators import (
    api_view,
    parser_classes,
    permission_classes
)
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from mrcnn import views
from plans.models import Plan3DJob
from push_notifications.clients import send_model_ready
from users.models import Usuario
from .serializers import Plan3DJobSerializer


MAX_FREE_PLANS = 5


def _is_premium_active(usuario):
    """Indica si el usuario tiene un plan Premium vigente."""
    if usuario is None or usuario.rol != 'usuario_premium':
        return False
    exp = usuario.fecha_expiracion_plan
    return exp is None or exp >= date.today()


def _plan_limit_reached(usuario):
    """
    Limite de planos por plan: gratis hasta MAX_FREE_PLANS, premium ilimitado.
    """
    if usuario is None or _is_premium_active(usuario):
        return False
    return Plan3DJob.objects.filter(usuario=usuario).count() >= MAX_FREE_PLANS


def _plan_limit_response():
    return Response(
        {
            'detail': (
                'Has alcanzado el limite de {} planos del plan gratuito. '
                'Mejora a Premium para crear planos ilimitados.'
            ).format(MAX_FREE_PLANS)
        },
        status=status.HTTP_403_FORBIDDEN,
    )


def _roof_type_from(request):
    """Tipo de techo pedido: 'ninguno' | 'plano' | 'dos_aguas' (default plano)."""
    from .three import ROOF_TYPES
    roof_type = str(request.data.get("roof_type") or "plano").strip().lower()
    return roof_type if roof_type in ROOF_TYPES else "plano"


def _real_width_from(request):
    """Ancho total real del plano en metros (opcional, mejora la escala)."""
    raw = str(request.data.get("real_width_m") or "").replace(",", ".").strip()
    try:
        value = float(raw)
    except ValueError:
        return None
    return value if 1.0 <= value <= 500.0 else None


def _enrich(det, image, real_width_m):
    """IA + detector clásico + escala (plans/pipeline.py)."""
    from .pipeline import enrich_detections, raw_ml
    if real_width_m is None:
        real_width_m = det.get('realWidthM')
    merged = enrich_detections(raw_ml(det), image, real_width_m)
    if real_width_m:
        merged['realWidthM'] = real_width_m
    return merged


def _fill_gaps_from(request):
    """Huecos sin puerta: rellenar (default) o dejar paso ('paso'/'false'/'0')."""
    value = str(request.data.get("fill_gaps", "true")).strip().lower()
    return value not in ("0", "false", "no", "paso", "dejar_paso")


def _ink_checker(job, det):
    """Comprobador de la imagen del plano para que el 3D quede igual al plano."""
    if not job.plan_image:
        return None
    try:
        from PIL import Image
        from .three import _pixel_to_meter_from_det
        from .walls_fix import make_ink_checker
        with job.plan_image.open('rb') as fh:
            image = Image.open(fh)
            image.load()
        sketch = bool((det.get('quality') or {}).get('boceto'))
        return make_ink_checker(image, _pixel_to_meter_from_det(det, fallback=0.01), sketch=sketch)
    except Exception:
        return None


def process_and_save_glb(job, det, roof_type="plano", fill_gaps=True, drawn=None):
    """
    Generar GLB en memoria y guardar metadatos.

    Args:
        job: Instancia de Plan3DJob
        det: Diccionario con datos de detección
        roof_type: 'ninguno' | 'plano' | 'dos_aguas'
        fill_gaps: rellenar huecos entre muros sin puerta/ventana

    Returns:
        job: Instancia actualizada de Plan3DJob
    """
    from .three import build_scene_mesh, export_glb

    # Generar el modelo 3D (GLB) con piso y techo
    control = {}
    mesh = build_scene_mesh(
        det, min_score=0.0, cut_openings=True, roof_type=roof_type,
        fill_gaps=fill_gaps,
        drawn=drawn if drawn is not None else _ink_checker(job, det),
        control_out=control,
    )
    # Imagen de control (verde = coincide con el plano, rojo = sobra,
    # azul = falta) junto al GLB, para revisar el resultado.
    if control.get('image') is not None:
        try:
            buf = io.BytesIO()
            control['image'].save(buf, format='PNG')
            storage = job.glb_model.storage
            name = storage.save('{}/control/job_{}_control.png'.format(
                os.path.dirname(job.glb_model.name or 'outputs') or 'outputs', job.id),
                ContentFile(buf.getvalue()))
            det.setdefault('quality', {}).setdefault('fidelidad_px', {})['control_png'] = storage.url(name)
        except Exception as exc:
            print('[control] {}'.format(exc))
    if mesh is not None:
        glb_buf = io.BytesIO()
        export_glb(mesh, glb_buf)
        filename = f'job_{job.id}.glb'
        job.glb_model.save(
            filename,
            ContentFile(glb_buf.getvalue()),
            save=False
        )

    # Informe de calidad (plans/pipeline.py)
    if det.get("quality") is not None:
        job.calidad = det["quality"]

    # Guardar dimensiones
    job.width = det.get("Width", 0)
    job.height = det.get("Height", 0)

    # Guardar job
    job.save()
    if not job.glb_model:
        raise ValueError('no salió ninguna pieza 3D de las detecciones')
    return job


def _discard_job(job):
    """Borra un job que no llegó a tener 3D (nunca dejar un modelo vacío)."""
    for field in [job.plan_file, job.plan_image, job.detections_json, job.glb_model]:
        if not field:
            continue
        try:
            field.delete(save=False)
        except Exception:
            pass
    job.delete()


def _build_or_discard(job, det, roof_type, fill_gaps=True):
    """Genera el GLB; si falla, borra el job y devuelve la respuesta de error."""
    try:
        process_and_save_glb(job, det, roof_type, fill_gaps)
    except Exception as exc:
        import traceback
        traceback.print_exc()
        _discard_job(job)
        return Response(
            {'detail': 'No se pudo generar el modelo 3D de este plano: {}'.format(exc)},
            status=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    return None


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
@permission_classes([IsAuthenticated])
def create_plan3d_job(request):
    """
    Crear un job de Plan3D a partir de un archivo subido.

    Procesa el archivo, ejecuta inferencia y genera el GLB.
    """
    plan_file = request.FILES.get('plan_file')
    if not plan_file:
        return Response(
            {'detail': 'Se requiere el archivo "plan_file".'},
            status=status.HTTP_400_BAD_REQUEST
        )

    usuario_id = request.data.get("usuario")
    try:
        usuario_instance = Usuario.objects.get(pk=usuario_id)
    except (ValueError, Usuario.DoesNotExist):
        return Response(
            {'detail': 'Usuario no encontrado.'},
            status=status.HTTP_400_BAD_REQUEST
        )

    if usuario_instance.id != request.user.id:
        return Response(
            {'detail': 'No puedes generar modelos para otro usuario.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    if _plan_limit_reached(usuario_instance):
        return _plan_limit_response()

    job, det, failed = _detect_upload(request, plan_file, usuario_instance)
    if failed is not None:
        return failed

    # Generar el GLB
    failed = _build_or_discard(job, det, _roof_type_from(request), _fill_gaps_from(request))
    if failed is not None:
        return failed

    send_model_ready(user_id=job.usuario_id, model_id=job.id)

    return Response(
        Plan3DJobSerializer(job).data,
        status=status.HTTP_201_CREATED
    )


def _detect_upload(request, plan_file, usuario_instance):
    """
    Convierte el archivo subido, ejecuta la detección y guarda imagen + JSON.
    Devuelve (job, det, None) o (None, None, Response de error).
    """
    data = plan_file.read()

    # Convertir a imagen (imagen/PDF/DXF/DWG) usando un archivo temporal
    from .converters import image_from_any
    suffix = os.path.splitext(plan_file.name)[1]
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        tmp.write(data)
        tmp.close()
        img, err = image_from_any(tmp.name)
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass

    if img is None:
        detail_msg = f"No se pudo preparar la imagen para inferencia: {err}"
        return None, None, Response(
            {"detail": detail_msg},
            status=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE
        )

    # Foto de una hoja / escaneo torcido: enderezar antes de detectar.
    from .preprocess import prepare_plan_image
    img, prep_steps = prepare_plan_image(img)

    # Crear el job (con usuario) para conocer su carpeta en media
    job = Plan3DJob.objects.create(usuario=usuario_instance)
    job.plan_file.save(plan_file.name, ContentFile(data), save=False)

    # Guardar la imagen rasterizada
    png_buf = io.BytesIO()
    img.save(png_buf, format='PNG')
    image_filename = f'job_{job.id}_raster.png'
    job.plan_image.save(
        image_filename,
        ContentFile(png_buf.getvalue()),
        save=False
    )

    # Ejecutar inferencia
    from .inference import run_inference
    det = run_inference(img)
    det = _enrich(det, img, _real_width_from(request))
    if prep_steps and det.get('quality') is not None:
        det['quality']['preparacion'] = prep_steps

    # Guardar JSON de detecciones
    json_bytes = json.dumps(det, ensure_ascii=False).encode('utf-8')
    json_filename = f'job_{job.id}_detections.json'
    job.detections_json.save(
        json_filename,
        ContentFile(json_bytes),
        save=False
    )
    job.width = det.get("Width", 0)
    job.height = det.get("Height", 0)
    job.save()
    return job, det, None


# ---------------------------------------------------------------------------
# Revisión 2D: detectar -> corregir -> construir
# ---------------------------------------------------------------------------

REVIEW_CLASSES = ('wall', 'door', 'window')
MAX_REVIEW_ITEMS = 5000


def _own_job(request, pk):
    """Devuelve (job, None) si el job existe y es del usuario; si no (None, Response)."""
    try:
        job = Plan3DJob.objects.get(pk=pk)
    except Plan3DJob.DoesNotExist:
        return None, Response({'detail': 'Modelo no encontrado.'}, status=status.HTTP_404_NOT_FOUND)
    if job.usuario_id != getattr(request.user, 'pk', None):
        return None, Response({'detail': 'No puedes modificar este modelo.'},
                              status=status.HTTP_403_FORBIDDEN)
    return job, None


def _read_det(job):
    with job.detections_json.open('rb') as fh:
        return json.loads(fh.read().decode('utf-8'))


def _write_det(job, det):
    """Sobrescribe el JSON de detecciones del job (sin acumular copias)."""
    old = job.detections_json.name if job.detections_json else None
    if old:
        try:
            job.detections_json.storage.delete(old)
        except Exception:
            pass
    job.detections_json.save(
        'job_{}_detections.json'.format(job.id),
        ContentFile(json.dumps(det, ensure_ascii=False).encode('utf-8')),
        save=False,
    )


def _num(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise ValueError('coordenada no numérica')
    return float(v)


def _clean_reviewed(det_in, base):
    """
    Valida las detecciones corregidas por el usuario. Solo acepta muros,
    puertas y ventanas con cajas dentro de la imagen. Conserva el resto de
    metadatos (escala, calidad...) del JSON original.
    """
    pts = det_in.get('points')
    cls = det_in.get('classes')
    if not isinstance(pts, list) or not isinstance(cls, list) or len(pts) != len(cls):
        raise ValueError('"points" y "classes" deben ser listas del mismo largo')
    if len(pts) > MAX_REVIEW_ITEMS:
        raise ValueError('demasiados elementos')
    scores_in = det_in.get('scores')
    if not isinstance(scores_in, list) or len(scores_in) != len(pts):
        scores_in = [1.0] * len(pts)
    W = float(base.get('Width') or 0) or float('inf')
    H = float(base.get('Height') or 0) or float('inf')
    tol = 2.0
    out_p, out_c, out_s = [], [], []
    for p, c, sc in zip(pts, cls, scores_in):
        name = (c or {}).get('name') if isinstance(c, dict) else None
        if name not in REVIEW_CLASSES:
            raise ValueError('clase no permitida: {}'.format(name))
        if not isinstance(p, dict):
            raise ValueError('caja inválida')
        x1, y1, x2, y2 = (_num(p.get(k)) for k in ('x1', 'y1', 'x2', 'y2'))
        x1, x2 = sorted((x1, x2))
        y1, y2 = sorted((y1, y2))
        if x1 < -tol or y1 < -tol or x2 > W + tol or y2 > H + tol:
            raise ValueError('caja fuera del plano')
        if x2 - x1 < 1 or y2 - y1 < 1:
            continue  # caja degenerada: se ignora
        box = {'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2}
        line = p.get('line')
        if name == 'wall' and isinstance(line, list) and len(line) == 4:
            box['line'] = [_num(v) for v in line]
            box['thickness'] = _num(p.get('thickness') or 10)
        out_p.append(box)
        out_c.append({'name': name})
        out_s.append(float(sc) if isinstance(sc, (int, float)) else 1.0)
    det = dict(base)
    det['points'], det['classes'], det['scores'] = out_p, out_c, out_s
    det.setdefault('quality', {})
    if isinstance(det['quality'], dict):
        det['quality']['revisado'] = True
    return det


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
@permission_classes([IsAuthenticated])
def detect_plan(request):
    """
    Paso 1 de la revisión: sube el plano y detecta muros/puertas/ventanas
    SIN construir el 3D. El job queda en estado 'review'.
    """
    plan_file = request.FILES.get('plan_file')
    if not plan_file:
        return Response({'detail': 'Se requiere el archivo "plan_file".'},
                        status=status.HTTP_400_BAD_REQUEST)
    usuario_instance = request.user
    if _plan_limit_reached(usuario_instance):
        return _plan_limit_response()
    job, det, failed = _detect_upload(request, plan_file, usuario_instance)
    if failed is not None:
        return failed
    job.status = 'review'
    job.detections_original = det
    if det.get('quality') is not None:
        job.calidad = det['quality']
    job.save()
    data = Plan3DJobSerializer(job).data
    data['detections'] = det
    return Response(data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PUT'])
@permission_classes([IsAuthenticated])
def plan_detections(request, pk):
    """GET: detecciones actuales del job. PUT: guarda las corregidas."""
    job, failed = _own_job(request, pk)
    if failed is not None:
        return failed
    if not job.detections_json:
        return Response({'detail': 'Este modelo no tiene detecciones.'},
                        status=status.HTTP_400_BAD_REQUEST)
    try:
        base = _read_det(job)
    except Exception:
        return Response({'detail': 'No se pudieron leer las detecciones.'},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    if request.method == 'GET':
        data = Plan3DJobSerializer(job).data
        data['detections'] = base
        return Response(data)

    det_in = request.data.get('detections', request.data)
    if isinstance(det_in, str):
        try:
            det_in = json.loads(det_in)
        except ValueError:
            det_in = None
    if not isinstance(det_in, dict):
        return Response({'detail': 'Se requiere el objeto "detections".'},
                        status=status.HTTP_400_BAD_REQUEST)
    try:
        det = _clean_reviewed(det_in, base)
    except (ValueError, TypeError) as exc:
        return Response({'detail': 'Detecciones inválidas: {}'.format(exc)},
                        status=status.HTTP_400_BAD_REQUEST)
    if job.detections_original is None:
        job.detections_original = base
    _write_det(job, det)
    job.save()
    data = Plan3DJobSerializer(job).data
    data['detections'] = det
    return Response(data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def build_plan(request, pk):
    """Paso final de la revisión: construye el GLB con las detecciones guardadas."""
    job, failed = _own_job(request, pk)
    if failed is not None:
        return failed
    if not job.detections_json:
        return Response({'detail': 'Este modelo no tiene detecciones.'},
                        status=status.HTTP_400_BAD_REQUEST)
    try:
        det = _read_det(job)
    except Exception:
        return Response({'detail': 'No se pudieron leer las detecciones.'},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    old = job.glb_model.name if job.glb_model else None
    try:
        process_and_save_glb(job, det, _roof_type_from(request), _fill_gaps_from(request))
    except Exception as exc:
        import traceback
        traceback.print_exc()
        job.status = 'review'  # puede seguir corrigiendo y reintentar
        job.save(update_fields=['status'])
        return Response({'detail': 'No se pudo generar el modelo 3D: {}'.format(exc)},
                        status=status.HTTP_422_UNPROCESSABLE_ENTITY)
    if old and job.glb_model.name != old:
        try:
            job.glb_model.storage.delete(old)
        except Exception:
            pass
    job.status = 'built'
    job.save(update_fields=['status'])
    return Response(Plan3DJobSerializer(job).data, status=status.HTTP_200_OK)


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
def create_plan_json(request):
    """
    Crear un Plan3D a partir de un archivo JSON de detecciones.

    Espera un archivo .json en el campo 'plan_file' del request.
    """
    json_file = request.FILES.get('plan_file')
    if not json_file or not json_file.name.endswith('.json'):
        detail_msg = 'Se requiere un archivo .json en el campo "plan_file".'
        return Response(
            {'detail': detail_msg},
            status=status.HTTP_400_BAD_REQUEST
        )

    usuario_id = request.data.get("usuario")
    try:
        usuario_instance = Usuario.objects.get(pk=usuario_id)
    except (ValueError, Usuario.DoesNotExist):
        return Response(
            {'detail': 'Usuario no encontrado.'},
            status=status.HTTP_400_BAD_REQUEST
        )

    if _plan_limit_reached(usuario_instance):
        return _plan_limit_response()

    data = json_file.read()
    try:
        det = json.loads(data.decode('utf-8'))
    except Exception as e:
        return Response(
            {'detail': f'Error al leer el JSON: {str(e)}'},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Crear el job (con usuario) para conocer su carpeta en media
    job = Plan3DJob.objects.create(usuario=usuario_instance)

    # Guardar el archivo JSON en el campo detections_json
    json_filename = f'job_{job.id}_detections.json'
    job.detections_json.save(json_filename, ContentFile(data), save=False)
    job.width = det.get("Width", 0)
    job.height = det.get("Height", 0)
    job.save()

    # Generar el GLB
    failed = _build_or_discard(job, det, _roof_type_from(request), _fill_gaps_from(request))
    if failed is not None:
        return failed

    return Response(
        Plan3DJobSerializer(job).data,
        status=status.HTTP_201_CREATED
    )


@api_view(['POST'])
def create_empty_plan(request):
    """
    Crear un Plan3DJob vacio (sin GLB) para empezar a dibujar en el editor.
    """
    usuario_id = request.data.get("usuario")
    try:
        usuario_instance = Usuario.objects.get(pk=usuario_id)
    except (ValueError, Usuario.DoesNotExist):
        return Response(
            {'detail': 'Usuario no encontrado.'},
            status=status.HTTP_400_BAD_REQUEST
        )
    if _plan_limit_reached(usuario_instance):
        return _plan_limit_response()
    job = Plan3DJob.objects.create(usuario=usuario_instance)
    return Response(
        Plan3DJobSerializer(job).data,
        status=status.HTTP_201_CREATED
    )


@api_view(['POST'])
def generate_dynamic_glb(request):
    """
    Generar modelo GLB con colores personalizados desde JSON de detecciones.
    """
    try:
        det_json = request.data.get("det_json")
        colors = request.data.get("colors")
        usuario_id = request.data.get("usuario")

        # Convertir cadenas JSON si vienen como texto
        if isinstance(det_json, str):
            det_json = json.loads(det_json)
        if isinstance(colors, str):
            colors = json.loads(colors)

        # Crear un nuevo job temporal (sin archivo)
        job = Plan3DJob.objects.create(usuario_id=usuario_id)

        # Generar el GLB
        process_and_save_glb(job, det_json, _roof_type_from(request))

        message = "Modelo GLB generado exitosamente con colores personalizados."
        return Response(
            {
                "message": message,
                "job_id": job.id,
                "glb_path": job.glb_model.url if job.glb_model else None
            },
            status=status.HTTP_200_OK
        )
    except Exception as e:
        return Response(
            {"error": str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )



@api_view(['GET'])
@parser_classes([MultiPartParser, FormParser])
@permission_classes([IsAuthenticated])
def get_lista_modelos(request, format=None):
    """
    Obtener la lista de modelos 3D generados por el usuario autenticado.
    """
    jobs = Plan3DJob.objects.filter(usuario=request.user)
    serializer = Plan3DJobSerializer(jobs, many=True)
    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['DELETE'])
def delete_plan(request, pk):
    """
    Eliminar un Plan3DJob y sus archivos asociados.
    """
    try:
        job = Plan3DJob.objects.get(pk=pk)
    except Plan3DJob.DoesNotExist:
        return Response(
            {'detail': 'Modelo no encontrado.'},
            status=status.HTTP_404_NOT_FOUND
        )

    for field in [job.plan_file, job.plan_image, job.detections_json, job.glb_model]:
        if not field:
            continue
        try:
            field.delete(save=False)
        except Exception:
            pass

    job.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
def reemplazar_glb(request):
    """
    Reemplazar un archivo GLB/GLTF existente.

    Espera:
        - file_glb: archivo .glb o .gltf (por ejemplo "job_2.glb")
        - usuario: id del usuario que realiza la acción

    Returns:
        Plan3DJob serializado con el nuevo archivo
    """
    new_glb = request.FILES.get('file_glb')
    usuario_id = request.data.get('usuario')

    # Validar usuario
    try:
        usuario = Usuario.objects.get(id=usuario_id)
    except Usuario.DoesNotExist:
        return Response(
            {"detail": "Usuario no encontrado"},
            status=status.HTTP_404_NOT_FOUND
        )

    if not new_glb:
        return Response(
            {"detail": "No se envió archivo .glb/.gltf"},
            status=status.HTTP_400_BAD_REQUEST
        )
    match = re.search(r'job_(\d+)\.(glb|gltf)$', new_glb.name, re.IGNORECASE)
    if not match:
        detail_msg = "Nombre de archivo no válido (debe ser job_<id>.glb o job_<id>.gltf)"
        return Response(
            {"detail": detail_msg},
            status=status.HTTP_400_BAD_REQUEST
        )

    job_id = int(match.group(1))
    extension = match.group(2).lower()

    try:
        job = Plan3DJob.objects.get(id=job_id)
    except Plan3DJob.DoesNotExist:
        return Response(
            {"detail": f"No existe Plan3DJob con id {job_id}"},
            status=status.HTTP_404_NOT_FOUND
        )

    # Reemplazar archivo existente con nombre único (evitar cache)
    if job.glb_model:
        job.glb_model.delete(save=False)

    timestamp = int(time.time())
    new_name = f"job_{job.id}_{timestamp}.{extension}"
    job.glb_model.save(new_name, new_glb, save=False)

    job.usuario = usuario
    job.save(update_fields=['glb_model', 'usuario'])

    # Devolver modelo completo actualizado
    serializer = Plan3DJobSerializer(job)
    return Response(serializer.data, status=status.HTTP_200_OK)


def _roof_type_from_glb(job):
    """Tipo de techo del GLB actual (para conservarlo al regenerar)."""
    try:
        from pygltflib import GLTF2
        with job.glb_model.open('rb') as fh:
            gltf = GLTF2.load_from_bytes(fh.read())
        names = [n.name or '' for n in gltf.nodes]
    except Exception:
        return "plano"
    if any(n.startswith('wall_gable') for n in names):
        return "dos_aguas"
    if any(n.startswith('roof') for n in names):
        return "plano"
    return "ninguno"


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def regenerar_plan(request, pk):
    """
    Reconstruye el GLB de un plano desde sus detecciones guardadas, con la
    geometría actual (vanos con dintel/antepecho, vidrio, marcos, encaje al
    muro). OJO: reemplaza el modelo, se pierden las ediciones manuales.

    Body opcional: {roof_type: 'ninguno'|'plano'|'dos_aguas'} (si no, conserva el actual).
    """
    try:
        job = Plan3DJob.objects.get(pk=pk)
    except Plan3DJob.DoesNotExist:
        return Response({'detail': 'Modelo no encontrado.'}, status=status.HTTP_404_NOT_FOUND)
    if job.usuario_id and getattr(request.user, 'pk', None) != job.usuario_id:
        return Response({'detail': 'No puedes modificar este modelo.'}, status=status.HTTP_403_FORBIDDEN)
    if not job.detections_json:
        return Response(
            {'detail': 'Este modelo no viene de un plano subido (no tiene detecciones).'},
            status=status.HTTP_400_BAD_REQUEST
        )
    try:
        with job.detections_json.open('rb') as fh:
            det = json.loads(fh.read().decode('utf-8'))
    except Exception:
        return Response({'detail': 'No se pudieron leer las detecciones.'},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    roof_type = (
        _roof_type_from(request) if request.data.get("roof_type")
        else (_roof_type_from_glb(job) if job.glb_model else "plano")
    )
    # Si el usuario corrigió las detecciones en 2D, no volver a detectar
    # (se perderían sus correcciones): construir con lo revisado.
    reviewed = bool((det.get('quality') or {}).get('revisado'))
    if job.plan_image and not reviewed:
        try:
            from PIL import Image
            with job.plan_image.open('rb') as fh:
                image = Image.open(fh)
                image.load()
            det = _enrich(det, image, _real_width_from(request))
            old_det = job.detections_json.name
            job.detections_json.save(
                'job_{}_detections.json'.format(job.id),
                ContentFile(json.dumps(det, ensure_ascii=False).encode('utf-8')),
                save=False,
            )
            if old_det and old_det != job.detections_json.name:
                job.detections_json.storage.delete(old_det)
        except Exception as exc:
            print('[regenerar] no se pudo combinar con el detector: {}'.format(exc))
    old = job.glb_model.name if job.glb_model else None
    try:
        process_and_save_glb(job, det, roof_type, _fill_gaps_from(request))
    except Exception as exc:
        import traceback
        traceback.print_exc()
        return Response(
            {'detail': 'No se pudo regenerar el modelo 3D: {}'.format(exc)},
            status=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    if old and job.glb_model.name != old:
        try:
            job.glb_model.storage.delete(old)  # no acumular versiones viejas
        except Exception:
            pass
    return Response(Plan3DJobSerializer(job).data, status=status.HTTP_200_OK)
