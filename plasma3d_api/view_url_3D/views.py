
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from plans.models import Plan3DJob
from users.models import Usuario


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
def upload_glb(request):
    """
    Subir archivo GLB/GLTF y crear registro de Plan3DJob.

    El almacenamiento lo resuelve el campo FileField (STORAGE_BACKEND).

    Args:
        request: Request con archivo 3D y usuario_id

    Returns:
        Response con URL del archivo subido o mensaje de error
    """
    glb_file = request.FILES.get('file')
    if not glb_file:
        return Response(
            {'error': 'Archivo no enviado'},
            status=status.HTTP_400_BAD_REQUEST
        )

    nombre = (glb_file.name or '').lower()
    if not (nombre.endswith('.glb') or nombre.endswith('.gltf')):
        return Response(
            {'error': 'Solo se permiten archivos .glb o .gltf'},
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

    # Crear el job y luego guardar el archivo (para conocer su carpeta en media)
    job = Plan3DJob.objects.create(usuario=usuario_instance)
    job.glb_model.save(glb_file.name, glb_file, save=True)

    return Response({'url': job.glb_model.url}, status=status.HTTP_201_CREATED)
