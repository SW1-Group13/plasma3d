import json
import logging

from django.conf import settings
from django.db import DatabaseError
from django.http import StreamingHttpResponse
from rest_framework import status
from rest_framework.decorators import (
    api_view,
    parser_classes,
    permission_classes,
    renderer_classes,
)
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.renderers import BaseRenderer, JSONRenderer
from rest_framework.response import Response

from .models import AnalisisRiesgo
from .services_agente import (
    MAX_CHARS_MENSAJE,
    AgenteError,
    responder_agente,
    responder_agente_stream,
)
from .services_ai import available_providers
from .services_groq import GroqError, transcribir_audio
from .services_riesgo import analizar_archivo, analizar_plan


logger = logging.getLogger(__name__)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def agente_chat(request):
    """
    Un paso del Agente IA (con herramientas).

    Body:
      {historial: [...contenidos del agente], contexto: {...},
       mensaje?: str,                                   # nueva pregunta
       imagen?: str,                                    # data URL (data:image/...;base64,...)
       resultados?: [{id, nombre, respuesta}],          # acciones del editor ejecutadas
       pendientes?: [...]}                              # devueltos por el paso anterior
    Respuesta:
      {estado: 'respuesta', texto, historial, proveedor}
      {estado: 'acciones', acciones:[{id,nombre,args}], pendientes, historial, proveedor}
    """
    args, error = _agente_args(request.data)
    if error is not None:
        return error
    try:
        paso = responder_agente(**args)
    except AgenteError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
    return Response(paso)


def _agente_args(data):
    """Valida el cuerpo del agente. Devuelve (kwargs, None) o (None, Response)."""
    mensaje = data.get('mensaje')
    imagen = data.get('imagen')
    resultados = data.get('resultados')
    historial = data.get('historial') or []
    contexto = data.get('contexto') or {}

    if not isinstance(historial, list) or not isinstance(contexto, dict):
        return None, Response({'detail': 'Formato inválido.'}, status=status.HTTP_400_BAD_REQUEST)
    if mensaje is not None and len(str(mensaje)) > MAX_CHARS_MENSAJE:
        return None, Response(
            {'detail': f'El mensaje supera {MAX_CHARS_MENSAJE} caracteres.'},
            status=status.HTTP_400_BAD_REQUEST
        )
    if imagen is not None:
        if not isinstance(imagen, str) or not imagen.startswith('data:image/'):
            return None, Response(
                {'detail': 'La imagen debe ser un data URL (data:image/...).'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(imagen) > 8 * 1024 * 1024:
            return None, Response(
                {'detail': 'La imagen es demasiado grande (máx. 8 MB).'},
                status=status.HTTP_400_BAD_REQUEST,
            )
    if mensaje is None and not isinstance(resultados, list) and not imagen:
        return None, Response(
            {'detail': 'Envía un mensaje, una imagen o los resultados de las acciones.'},
            status=status.HTTP_400_BAD_REQUEST
        )
    # Proveedor elegido en el chat ('gemini' | 'deepseek'); 'modelo' por compatibilidad.
    proveedor = str(data.get('proveedor') or data.get('modelo') or '').strip().lower() or None
    return {
        'historial': historial,
        'contexto': contexto,
        'mensaje': mensaje,
        'resultados': resultados,
        'pendientes': data.get('pendientes'),
        'imagen': imagen,
        'proveedor': proveedor,
    }, None


class EventStreamRenderer(BaseRenderer):
    """
    Permite que DRF acepte 'Accept: text/event-stream' (si no, responde 406).
    Las respuestas de error (dict) se envían como JSON.
    """
    media_type = 'text/event-stream'
    format = 'event-stream'
    charset = 'utf-8'

    def render(self, data, accepted_media_type=None, renderer_context=None):
        if data is None:
            return b''
        if isinstance(data, (bytes, str)):
            return data if isinstance(data, bytes) else data.encode('utf-8')
        return json.dumps(data, ensure_ascii=False, default=str).encode('utf-8')


def _sse(evento, datos):
    return 'event: {}\ndata: {}\n\n'.format(
        evento, json.dumps(datos, ensure_ascii=False, default=str)
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@renderer_classes([JSONRenderer, EventStreamRenderer])
def agente_chat_stream(request):
    """
    Igual que agente_chat pero en streaming (text/event-stream):
      event: token     data: {t}                 texto parcial
      event: acciones  data: {estado:'acciones', ...}
      event: fin       data: {estado:'respuesta', ...}
      event: error     data: {detail}
    """
    args, error = _agente_args(request.data)
    if error is not None:
        return error

    def eventos():
        # Comentario inicial: abre la conexión de inmediato en proxies.
        yield ': ok\n\n'
        for evento, datos in responder_agente_stream(**args):
            yield _sse(evento, datos)

    response = StreamingHttpResponse(eventos(), content_type='text/event-stream; charset=utf-8')
    response['Cache-Control'] = 'no-cache'
    response['X-Accel-Buffering'] = 'no'  # nginx: no acumular el stream
    return response


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def ai_config(request):
    """Configuracion real de IA: proveedores disponibles, imágenes y audio."""
    proveedor = (getattr(settings, 'AI_PROVIDER', 'gemini') or 'gemini').strip().lower()
    providers = available_providers()
    ids = [p['id'] for p in providers]
    if proveedor not in ids and ids:
        proveedor = ids[0]
    return Response(
        {
            'provider': proveedor,
            'providers': providers,
            'vision': any(p['vision'] for p in providers),
            'audio': bool(getattr(settings, 'GROQ_API_KEY', '')),
        }
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def transcribir_audio_view(request):
    """Transcribe un audio (voz) a texto usando Groq/Whisper."""
    archivo = request.FILES.get('audio') or request.FILES.get('file')
    if not archivo:
        return Response(
            {'detail': 'Envía un archivo de audio en el campo "audio".'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if archivo.size > 25 * 1024 * 1024:
        return Response(
            {'detail': 'El audio es demasiado grande (máx. 25 MB).'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        texto = transcribir_audio(archivo)
    except GroqError as exc:
        mensaje = str(exc)
        http_status = (
            status.HTTP_503_SERVICE_UNAVAILABLE
            if 'configurada' in mensaje
            else status.HTTP_502_BAD_GATEWAY
        )
        return Response({'detail': mensaje}, status=http_status)
    return Response({'texto': texto})


@api_view(['POST'])
def analizar_glb(request):
    """
    Analiza un modelo .glb o .gltf subido y devuelve un informe de riesgo.

    Usa Gemini si GEMINI_API_KEY está configurada; si no, aplica el motor
    de reglas (muros/puertas/ventanas) para que el análisis siempre responda.
    """
    if 'archivo' not in request.FILES:
        return Response(
            {
                'error': (
                    'No se ha enviado ningún archivo. '
                    'Envía un archivo con la clave "archivo".'
                )
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    archivo = request.FILES['archivo']
    nombre = (archivo.name or '').lower()
    if not (nombre.endswith('.glb') or nombre.endswith('.gltf')):
        return Response(
            {'error': 'El archivo debe ser .glb o .gltf'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    resultado = analizar_archivo(archivo)
    if resultado.get('success'):
        return Response(resultado, status=status.HTTP_200_OK)
    return Response(resultado, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def analizar_plan_view(request, pk):
    """Analiza el modelo guardado de un Plan3DJob y guarda el resultado."""
    from plans.models import Plan3DJob

    try:
        plan = Plan3DJob.objects.get(pk=pk)
    except Plan3DJob.DoesNotExist:
        return Response(
            {'detail': 'Modelo no encontrado.'},
            status=status.HTTP_404_NOT_FOUND,
        )

    user = request.user
    es_admin = getattr(user, 'rol', None) == 'administrador'
    if plan.usuario_id and plan.usuario_id != getattr(user, 'id', None) and not es_admin:
        return Response(
            {'detail': 'No puedes analizar este modelo.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    data = analizar_plan(plan)
    if not data.get('success'):
        http_status = (
            status.HTTP_409_CONFLICT
            if data.get('code') == 'missing_model_data'
            else status.HTTP_500_INTERNAL_SERVER_ERROR
        )
        return Response(data, status=http_status)

    try:
        AnalisisRiesgo.objects.create(
            usuario=user if getattr(user, 'id', None) else None,
            plan=plan,
            resultado=data['analisis'],
            nivel_riesgo=data.get('nivel_riesgo', 'bajo'),
            fuente=data.get('fuente', 'heuristica'),
        )
    except DatabaseError:
        logger.exception('No se pudo guardar el análisis de riesgo del plan %s', pk)
        return Response(
            {**data, 'historial_guardado': False},
            status=status.HTTP_200_OK,
        )
    return Response(
        {**data, 'historial_guardado': True},
        status=status.HTTP_200_OK,
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def listar_analisis_plan(request, pk):
    """Historial de análisis de riesgo de un modelo."""
    from plans.models import Plan3DJob

    try:
        plan = Plan3DJob.objects.get(pk=pk)
    except Plan3DJob.DoesNotExist:
        return Response(
            {'detail': 'Modelo no encontrado.'},
            status=status.HTTP_404_NOT_FOUND,
        )

    user = request.user
    es_admin = getattr(user, 'rol', None) == 'administrador'
    if plan.usuario_id and plan.usuario_id != getattr(user, 'id', None) and not es_admin:
        return Response(
            {'detail': 'No puedes ver este análisis.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    analisis = AnalisisRiesgo.objects.filter(plan=plan)[:20]
    return Response(
        [
            {
                'id': a.id,
                'nivel_riesgo': a.nivel_riesgo,
                'fuente': a.fuente,
                'created_at': a.created_at,
                'resultado': a.resultado,
            }
            for a in analisis
        ]
    )
