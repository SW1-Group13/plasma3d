from django.shortcuts import render
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .services_agente import MAX_CHARS_MENSAJE, AgenteError, responder_agente
from .services_gemini import analizar_modelo_glb


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
    Analizar archivos .glb con Gemini AI.

    Recibe un archivo .glb y retorna análisis de daños estructurales
    y sugerencias de materiales.

    Returns:
        Response con análisis o mensaje de error
    """
    if 'archivo' not in request.FILES:
        error_msg = (
            'No se ha enviado ningún archivo. '
            'Por favor envía un archivo con la clave "archivo"'
        )
        return Response(
            {'error': error_msg},
            status=status.HTTP_400_BAD_REQUEST
        )

    archivo_glb = request.FILES['archivo']

    # Validar que sea un archivo .glb
    if not archivo_glb.name.endswith('.glb'):
        return Response(
            {'error': 'El archivo debe ser de tipo .glb'},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Llamar al servicio de Gemini
    resultado = analizar_modelo_glb(archivo_glb)

    if resultado.get('success'):
        return Response(resultado, status=status.HTTP_200_OK)
    else:
        return Response(
            resultado,
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )

