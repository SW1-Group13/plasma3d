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


def process_and_save_glb(job, det, roof_type="plano"):
    """
    Generar GLB en memoria y guardar metadatos.

    Args:
        job: Instancia de Plan3DJob
        det: Diccionario con datos de detección
        roof_type: 'ninguno' | 'plano' | 'dos_aguas'

    Returns:
        job: Instancia actualizada de Plan3DJob
    """
    from .three import build_scene_mesh, export_glb

    # Generar el modelo 3D (GLB) con piso y techo
    mesh = build_scene_mesh(
        det, min_score=0.0, cut_openings=True, roof_type=roof_type
    )
    if mesh is not None:
        glb_buf = io.BytesIO()
        export_glb(mesh, glb_buf)
        filename = f'job_{job.id}.glb'
        job.glb_model.save(
            filename,
            ContentFile(glb_buf.getvalue()),
            save=False
        )

    # Guardar dimensiones
    job.width = det.get("Width", 0)
    job.height = det.get("Height", 0)

    # Guardar job
    job.save()
    return job


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
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

    if _plan_limit_reached(usuario_instance):
        return _plan_limit_response()

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
        return Response(
            {"detail": detail_msg},
            status=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE
        )

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

    # Generar el GLB
    process_and_save_glb(job, det, _roof_type_from(request))

    return Response(
        Plan3DJobSerializer(job).data,
        status=status.HTTP_201_CREATED
    )


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
    process_and_save_glb(job, det, _roof_type_from(request))

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
    Reemplazar un archivo GLB existente.

    Espera:
        - file_glb: archivo .glb (por ejemplo "job_2.glb")
        - usuario: id del usuario que realiza la acción

    Returns:
        Plan3DJob serializado con el nuevo archivo GLB
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
            {"detail": "No se envió archivo .glb"},
            status=status.HTTP_400_BAD_REQUEST
        )
    match = re.search(r'job_(\d+)\.glb$', new_glb.name)
    if not match:
        detail_msg = "Nombre de archivo no válido (debe ser job_<id>.glb)"
        return Response(
            {"detail": detail_msg},
            status=status.HTTP_400_BAD_REQUEST
        )

    job_id = int(match.group(1))

    try:
        job = Plan3DJob.objects.get(id=job_id)
    except Plan3DJob.DoesNotExist:
        return Response(
            {"detail": f"No existe Plan3DJob con id {job_id}"},
            status=status.HTTP_404_NOT_FOUND
        )

    # Reemplazar archivo GLB existente con nombre único (evitar cache)
    if job.glb_model:
        job.glb_model.delete(save=False)

    timestamp = int(time.time())
    new_name = f"job_{job.id}_{timestamp}.glb"
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
    old = job.glb_model.name if job.glb_model else None
    process_and_save_glb(job, det, roof_type)
    if old and job.glb_model.name != old:
        try:
            job.glb_model.storage.delete(old)  # no acumular versiones viejas
        except Exception:
            pass
    return Response(Plan3DJobSerializer(job).data, status=status.HTTP_200_OK)
