"""Subida generica de media (usa el storage configurado en settings)."""
import os
import uuid

from django.core.files.storage import default_storage
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
def upload_image(request):
    """
    Subir un archivo (imagen de perfil, textura, etc.).

    Usa el storage configurado (STORAGE_BACKEND=local|cloudinary) y devuelve
    la URL resultante.
    """
    file = request.FILES.get('file')
    if not file:
        return Response(
            {'detail': 'Archivo no enviado.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    ext = os.path.splitext(file.name)[1].lower()
    name = 'uploads/{}{}'.format(uuid.uuid4().hex, ext)
    saved = default_storage.save(name, file)
    return Response({'url': default_storage.url(saved)}, status=status.HTTP_201_CREATED)
