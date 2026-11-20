"""Deteccion de riesgos estructurales: Gemini IA con respaldo heuristico."""
import json
import os

from django.conf import settings

from .services_gemini import analizar_modelo_glb, extraer_info_glb


def _contar_desde_calidad(calidad):
    """Conteos que ya calcula el pipeline de deteccion (plans)."""
    if not isinstance(calidad, dict) or not calidad:
        return None
    return {
        'muros': int(calidad.get('muros') or 0),
        'puertas': int(calidad.get('puertas') or 0),
        'ventanas': int(calidad.get('ventanas') or 0),
    }


def _contar_desde_det(det):
    """Conteos a partir del JSON de detecciones (lista de clases)."""
    if not isinstance(det, dict) or not isinstance(det.get('classes'), list):
        return None
    clases = det['classes']
    nombres = [
        str((c or {}).get('name', '')).lower()
        for c in clases
        if isinstance(c, dict)
    ]
    return {
        'muros': nombres.count('wall'),
        'puertas': nombres.count('door'),
        'ventanas': nombres.count('window'),
    }


def _contar_desde_elementos(elementos):
    """Conteos a partir de los nodos de un GLB/GLTF."""
    nombres = [str((e or {}).get('nombre', '')).lower() for e in elementos]
    return {
        'muros': sum(1 for n in nombres if 'wall' in n or 'muro' in n),
        'puertas': sum(1 for n in nombres if 'door' in n or 'puerta' in n),
        'ventanas': sum(1 for n in nombres if 'window' in n or 'ventana' in n),
    }


def _nivel(puntaje):
    if puntaje >= 75:
        return 'crítico'
    if puntaje >= 45:
        return 'alto'
    if puntaje >= 20:
        return 'medio'
    return 'bajo'


def _resumen(conteos, avisos=None, tiene_modelo=True):
    """Motor de reglas: devuelve el mismo esquema que Gemini."""
    muros = int(conteos.get('muros') or 0)
    puertas = int(conteos.get('puertas') or 0)
    ventanas = int(conteos.get('ventanas') or 0)
    avisos = avisos or []

    puntaje = 0
    bien = []
    mal = []
    recomendaciones = []

    if muros <= 0:
        puntaje += 60
        mal.append({
            'tipo': 'muros',
            'cantidad': 0,
            'material_usado': 'sin detectar',
            'problema': 'No se detectaron muros en el modelo.',
            'nivel_riesgo': 'crítico',
        })
        recomendaciones.append({
            'para_elemento': 'muros',
            'cantidad_afectada': 1,
            'cambiar_de': 'sin muros',
            'cambiar_a': 'revisar el plano y volver a generar el 3D',
            'razon': 'Sin muros no hay estructura que evaluar.',
            'urgencia': 'alta',
        })
    else:
        bien.append({
            'tipo': 'muros',
            'cantidad': muros,
            'material_usado': 'definido en el modelo',
            'por_que_esta_bien': 'Se detectaron muros que delimitan la estructura.',
        })

    if puertas <= 0:
        puntaje += 25
        mal.append({
            'tipo': 'puertas',
            'cantidad': 0,
            'material_usado': 'sin detectar',
            'problema': 'No se detectaron puertas; la circulacion puede quedar bloqueada.',
            'nivel_riesgo': 'alto',
        })
        recomendaciones.append({
            'para_elemento': 'puertas',
            'cantidad_afectada': 1,
            'cambiar_de': 'sin puertas',
            'cambiar_a': 'agregar al menos una puerta por acceso',
            'razon': 'Sin puertas no se garantiza la evacuacion ni el uso normal.',
            'urgencia': 'alta',
        })
    else:
        bien.append({
            'tipo': 'puertas',
            'cantidad': puertas,
            'material_usado': 'definido en el modelo',
            'por_que_esta_bien': 'Hay puertas detectadas para la circulacion.',
        })

    if ventanas <= 0:
        puntaje += 15
        mal.append({
            'tipo': 'ventanas',
            'cantidad': 0,
            'material_usado': 'sin detectar',
            'problema': 'No se detectaron ventanas; puede faltar ventilacion e iluminacion.',
            'nivel_riesgo': 'medio',
        })
        recomendaciones.append({
            'para_elemento': 'ventanas',
            'cantidad_afectada': 1,
            'cambiar_de': 'sin ventanas',
            'cambiar_a': 'incorporar ventanas en fachadas',
            'razon': 'Mejora la ventilacion, la luz natural y el confort.',
            'urgencia': 'media',
        })
    else:
        bien.append({
            'tipo': 'ventanas',
            'cantidad': ventanas,
            'material_usado': 'definido en el modelo',
            'por_que_esta_bien': 'Hay ventanas detectadas para ventilacion e iluminacion.',
        })

    if muros > 0 and (puertas + ventanas) == 0:
        puntaje += 10

    for aviso in avisos:
        puntaje += 6
        mal.append({
            'tipo': 'general',
            'cantidad': 1,
            'material_usado': '—',
            'problema': str(aviso),
            'nivel_riesgo': 'medio',
        })

    if not tiene_modelo:
        puntaje += 25
        mal.append({
            'tipo': 'general',
            'cantidad': 1,
            'material_usado': '—',
            'problema': 'El proyecto no tiene un modelo 3D generado.',
            'nivel_riesgo': 'alto',
        })
        recomendaciones.append({
            'para_elemento': 'modelo',
            'cantidad_afectada': 1,
            'cambiar_de': 'sin modelo 3D',
            'cambiar_a': 'generar o importar un modelo GLB/GLTF',
            'razon': 'Sin geometria no se puede validar la estructura.',
            'urgencia': 'alta',
        })

    nivel = _nivel(puntaje)
    correctos = sum(item.get('cantidad', 0) for item in bien)
    incorrectos = sum(item.get('cantidad', 0) for item in mal)

    comentarios = []
    if nivel in ('alto', 'crítico'):
        comentarios.append(
            'Se recomienda revisar el diseno antes de construir.'
        )
    elif nivel == 'medio':
        comentarios.append(
            'Hay observaciones que conviene corregir en la siguiente revision.'
        )
    else:
        comentarios.append('No se detectaron riesgos criticos en el modelo.')

    return {
        'elementos_bien_hechos': bien,
        'elementos_mal_hechos': mal,
        'recomendaciones': recomendaciones,
        'resumen_general': {
            'nivel_riesgo_global': nivel,
            'elementos_correctos': correctos,
            'elementos_incorrectos': incorrectos,
            'comentario': ' '.join(comentarios),
        },
    }


def _nivel_de(analisis):
    resumen = (analisis or {}).get('resumen_general') or {}
    return resumen.get('nivel_riesgo_global', 'bajo')


def analizar_plan(plan):
    """Analiza el GLB guardado o usa los datos del plano si aun no hay GLB."""
    if plan.glb_model:
        nombre = os.path.basename(plan.glb_model.name)
        try:
            with plan.glb_model.open('rb') as archivo:
                resultado = analizar_archivo(archivo)
        except Exception:
            return {
                'success': False,
                'code': 'file_unavailable',
                'error': 'No se pudo abrir el modelo 3D guardado. Vuelve a guardarlo e inténtalo de nuevo.',
                'plan_id': plan.id,
                'nombre_archivo': nombre,
            }
        return {
            **resultado,
            'plan_id': plan.id,
            'nombre_archivo': nombre,
        }

    calidad = getattr(plan, 'calidad', None)
    conteos = _contar_desde_calidad(calidad)
    avisos = (calidad.get('avisos') or []) if isinstance(calidad, dict) else []
    if conteos is None and plan.detections_json:
        try:
            with plan.detections_json.open('rb') as archivo:
                detecciones = json.loads(archivo.read().decode('utf-8'))
            conteos = _contar_desde_det(detecciones)
        except Exception:
            conteos = None

    if conteos is None:
        return {
            'success': False,
            'code': 'missing_model_data',
            'error': 'Este modelo no tiene un GLB ni datos de detección suficientes para analizar.',
            'plan_id': plan.id,
        }

    analisis = _resumen(conteos, avisos, False)
    return {
        'success': True,
        'analisis': analisis,
        'nivel_riesgo': _nivel_de(analisis),
        'fuente': 'heuristica',
        'plan_id': plan.id,
        'nombre_archivo': os.path.basename(plan.plan_file.name),
    }


def analizar_archivo(archivo):
    """Analiza un GLB/GLTF subido: Gemini si hay clave, si no reglas."""
    if getattr(settings, 'GEMINI_API_KEY', None):
        respuesta = analizar_modelo_glb(archivo)
        if (
            respuesta.get('success')
            and isinstance(respuesta.get('analisis'), dict)
        ):
            respuesta['fuente'] = 'gemini'
            respuesta['nivel_riesgo'] = _nivel_de(respuesta['analisis'])
            return respuesta

    try:
        archivo.seek(0)
        info = extraer_info_glb(archivo)
        conteos = _contar_desde_elementos(
            info.get('elementos_estructurales') or []
        )
        analisis = _resumen(conteos, [], True)
        return {
            'success': True,
            'analisis': analisis,
            'nivel_riesgo': _nivel_de(analisis),
            'fuente': 'heuristica',
            'nombre_archivo': getattr(archivo, 'name', 'modelo'),
            'texturas_enviadas': len(info.get('texturas') or []),
        }
    except Exception as exc:
        return {
            'success': False,
            'error': 'No se pudo analizar el modelo: {}'.format(exc),
        }
