import logging

from django.db import DatabaseError
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import AnalisisRiesgo
from .services_agente import MAX_CHARS_MENSAJE, AgenteError, responder_agente
from .services_riesgo import analizar_archivo, analizar_plan


logger = logging.getLogger(__name__)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def agente_chat(request):
    """
    Un paso del Agente IA (con herramientas).

    Body:
      {historial: [...contenidos Gemini], contexto: {...},
       mensaje?: str,                                   # nueva pregunta
       resultados?: [{id, nombre, respuesta}],          # acciones del editor ejecutadas
       pendientes?: [...]}                              # devueltos por el paso anterior
    Respuesta:
      {estado: 'respuesta', texto, historial}
      {estado: 'acciones', acciones:[{id,nombre,args}], pendientes, historial}
    """
    data = request.data
    mensaje = data.get('mensaje')
    resultados = data.get('resultados')
    historial = data.get('historial') or []
    contexto = data.get('contexto') or {}

    if not isinstance(historial, list) or not isinstance(contexto, dict):
        return Response({'detail': 'Formato inválido.'}, status=status.HTTP_400_BAD_REQUEST)
    if mensaje is not None and len(str(mensaje)) > MAX_CHARS_MENSAJE:
        return Response(
            {'detail': f'El mensaje supera {MAX_CHARS_MENSAJE} caracteres.'},
            status=status.HTTP_400_BAD_REQUEST
        )
    if mensaje is None and not isinstance(resultados, list):
        return Response(
            {'detail': 'Envía un mensaje o los resultados de las acciones.'},
            status=status.HTTP_400_BAD_REQUEST
        )
    try:
        paso = responder_agente(
            historial, contexto,
            mensaje=mensaje,
            resultados=resultados,
            pendientes=data.get('pendientes'),
        )
    except AgenteError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
    return Response(paso)


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
