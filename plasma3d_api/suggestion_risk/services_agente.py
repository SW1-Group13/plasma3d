"""
Agente IA del editor: chat multimodal con Gemini/DeepSeek (OpenAI-compatible).

Bucle sin estado:
- El cliente manda `historial` (mensajes del agente), un `mensaje`/`imagen` o
  los `resultados` de acciones del editor, y el `contexto` actual del modelo.
- Las herramientas de SERVIDOR (precios/costos) se resuelven aquí mismo.
- Si el modelo pide herramientas del EDITOR, se devuelven como `acciones`
  para que el frontend las ejecute y vuelva con sus resultados.
- El audio se transcribe antes (Groq) y llega como texto normal.
"""
import json

from .agent_tools import EDITOR, SERVIDOR, ejecutar_servidor
from .services_ai import AIProviderError, chat_completion, choose_providers

MAX_CHARS_MENSAJE = 2000
MAX_PASOS_SERVIDOR = 6
MAX_CONTENIDOS = 40

INSTRUCCION_SISTEMA = """\
Eres el Agente IA de Plasma3D: arquitecto y constructor asesor dentro de un \
editor 3D de planos. Puedes CONVERSAR, CALCULAR COSTOS y ACTUAR en el plano \
usando herramientas.

Reglas generales:
- Responde SIEMPRE en español, claro y breve. Sin tablas; como mucho listas cortas con guiones.
- Medidas y datos del plano: usa SOLO el "CONTEXTO DEL MODELO". Da las medidas \
  en la unidad del contexto ("unidad": cm, m o in).
- Si el usuario adjunta una imagen, analízala y responde sobre ella; si no es un \
  plano, dilo amablemente. El audio llega ya transcrito como texto.

Costos:
- Para CUALQUIER costo, precio o total usa herramientas (costo_material, \
  comparar_materiales, presupuesto_actual, listar_precios). NUNCA inventes cifras.
- Da el total en dólares con 2 decimales y explica brevemente cantidad × precio.
- Si una herramienta avisa que se estimó con precio de referencia, dilo.

Dibujar y editar:
- Coordenadas en METROS: x → derecha, z → abajo en la vista Planta (norte = z menor), \
  centro del plano ≈ (0,0). Usa "limites" y "muros" del contexto para ubicar cosas \
  ("a la derecha" = x mayor que limites.max_x, "arriba/norte" = z menor que limites.min_z).
- Si el usuario no da medidas, usa valores típicos (muro 3 m, ambiente 3×4 m, \
  puerta 0.9 m, ventana 1.2 m) y di cuáles usaste.
- Para mover una pieza existente, usa mover_seleccion SOLO si "seleccion" indica \
  exactamente una pieza y el usuario indicó una distancia. Si falta la selección, \
  pídele que seleccione la pieza; si falta la distancia, pregúntala. Nunca elijas \
  otra pieza por nombre ni inventes una distancia para mover.
- Al mover, convierte cm a metros. Direcciones fijas de la vista Planta: derecha \
  = +x, izquierda = -x, arriba/norte = -z y abajo/sur = +z; no dependen de la \
  cámara y "arriba" no significa elevar verticalmente la pieza.
- Para un cuarto/ambiente usa dibujar_ambiente. Para nuevas construcciones fuera \
  del plano deja ~0.5 m o pégalas al muro existente si piden "anexo".
- Puertas y ventanas: colócalas SOBRE un muro (usa sus coordenadas en "muros").
- Para materiales usa nombres del catálogo; si no existe el pedido, ofrece el más \
  parecido (consulta listar_precios).
- Antes de borrar o de cambios de más de 10 piezas, confirma con el usuario.
- Tras actuar, resume en 1–2 líneas qué hiciste y con qué medidas; ofrece ver el costo.

Mejoras ("¿qué le puedo aumentar?"):
- Analiza el contexto (área de piso, nº de ventanas vs. m², techo, materiales) y \
  propone 3–5 mejoras concretas (ambiente extra, ventanas, porche/techo, materiales \
  mejores), cada una con costo estimado vía herramientas, y pregunta "¿Lo dibujo?".
"""


class AgenteError(Exception):
    """Error al consultar al agente (se responde 502 al cliente)."""


def _texto_usuario(texto, contexto):
    resumen = {k: v for k, v in (contexto or {}).items() if k != "objetos"}
    bloque = "CONTEXTO DEL MODELO (JSON):\n" + json.dumps(
        resumen, ensure_ascii=False
    )
    return "{}\n\nMENSAJE DEL USUARIO:\n{}".format(bloque, texto)


def _recortar(messages):
    """Limita el historial sin romper la secuencia de tool calls."""
    if len(messages) <= MAX_CONTENIDOS:
        return messages
    window = messages[-MAX_CONTENIDOS:]
    for index, message in enumerate(window):
        if message.get('role') == 'user':
            return window[index:]
    return window


def _contenido_texto(mensaje):
    content = mensaje.get('content')
    if isinstance(content, list):
        return ' '.join(
            part.get('text', '')
            for part in content
            if isinstance(part, dict)
        ).strip()
    return (content or '').strip()


def _tool_message(call_id, nombre, respuesta):
    if isinstance(respuesta, str):
        content = respuesta
    else:
        content = json.dumps(respuesta, ensure_ascii=False, default=str)
    if call_id:
        return {
            'role': 'tool',
            'tool_call_id': str(call_id),
            'content': content,
        }
    # Sin id no se puede asociar al tool_call: se entrega como texto.
    return {
        'role': 'user',
        'content': 'Resultado de {}: {}'.format(nombre, content),
    }


def _sanitize_history(messages):
    """Evita reenviar/guardar la imagen (data URL) en cada turno."""
    sanitized = []
    for message in messages:
        message = dict(message)
        # DeepSeek rechaza "tool_calls": [] (debe tener >= 1 elemento).
        if not message.get('tool_calls'):
            message.pop('tool_calls', None)
        content = message.get('content')
        if isinstance(content, list):
            new_content = []
            for part in content:
                if isinstance(part, dict) and part.get('type') == 'image_url':
                    new_content.append(
                        {'type': 'text', 'text': '[imagen adjunta]'}
                    )
                else:
                    new_content.append(part)
            if all(
                isinstance(part, dict) and part.get('type') == 'text'
                for part in new_content
            ):
                sanitized.append({
                    **message,
                    'content': '\n'.join(
                        part.get('text', '') for part in new_content
                    ),
                })
            else:
                sanitized.append({**message, 'content': new_content})
        else:
            sanitized.append(message)
    return sanitized


def responder_agente(
    historial,
    contexto,
    mensaje=None,
    resultados=None,
    pendientes=None,
    imagen=None,
):
    """
    Un paso del bucle del agente.

    Returns dict:
      {estado: 'respuesta', texto, historial}
      {estado: 'acciones', acciones:[{id,nombre,args}], pendientes:[...], historial}
    """
    messages = []
    for item in (historial or []):
        if not isinstance(item, dict) or not item.get('role'):
            continue
        message = dict(item)
        # Limpiar historiales antiguos que guardaron "tool_calls": [].
        if not message.get('tool_calls'):
            message.pop('tool_calls', None)
        messages.append(message)
    has_image = bool(imagen)

    if mensaje or imagen:
        texto = str(mensaje or '').strip()[:MAX_CHARS_MENSAJE]
        if not texto and not imagen:
            raise AgenteError('Escribe un mensaje para el agente.')
        if imagen:
            content = [
                {
                    'type': 'text',
                    'text': _texto_usuario(
                        texto or 'Analiza la imagen adjunta.', contexto
                    ),
                },
                {'type': 'image_url', 'image_url': {'url': imagen}},
            ]
        else:
            content = _texto_usuario(texto, contexto)
        messages.append({'role': 'user', 'content': content})
    elif resultados is not None:
        tool_messages = [
            m for m in (pendientes or [])
            if isinstance(m, dict) and m.get('role') == 'tool'
        ]
        tool_messages += [
            _tool_message(
                r.get('id'), r.get('nombre'), r.get('respuesta') or {}
            )
            for r in resultados
        ]
        if not tool_messages:
            raise AgenteError('Faltan los resultados de las acciones.')
        messages.extend(tool_messages)
    else:
        raise AgenteError('Escribe un mensaje para el agente.')

    providers = choose_providers(has_image=has_image)
    if not providers:
        raise AgenteError(
            'No hay proveedor de IA configurado. Define GEMINI_API_KEY o '
            'DEEPSEEK_API_KEY en el entorno.'
        )

    if has_image:
        # Respetar estrictamente AI_PROVIDER: con imagenes no se cambia a
        # otro proveedor (evita que aparezca Gemini si el elegido es DeepSeek).
        providers = providers[:1]

    provider = None
    first_call = True

    for _ in range(MAX_PASOS_SERVIDOR):
        messages = _recortar(messages)
        if first_call:
            asistente = None
            errores = []
            for candidate in providers:
                try:
                    asistente = chat_completion(
                        [{'role': 'system', 'content': INSTRUCCION_SISTEMA}]
                        + messages,
                        candidate,
                        timeout=45 if has_image else 60,
                    )
                    provider = candidate
                    break
                except AIProviderError as exc:
                    errores.append(str(exc))
            if asistente is None or provider is None:
                raise AgenteError(
                    ' | '.join(errores)
                    or 'No hay proveedor de IA disponible.'
                )
            first_call = False
        else:
            try:
                asistente = chat_completion(
                    [{'role': 'system', 'content': INSTRUCCION_SISTEMA}]
                    + messages,
                    provider,
                )
            except AIProviderError as exc:
                raise AgenteError(str(exc)) from exc

        messages.append(asistente)
        tool_calls = asistente.get('tool_calls') or []

        if not tool_calls:
            texto = _contenido_texto(asistente)
            return {
                'estado': 'respuesta',
                'texto': texto or 'Listo.',
                'historial': _sanitize_history(messages),
            }

        resp_servidor = []
        acciones = []
        for call in tool_calls:
            function = call.get('function') or {}
            nombre = function.get('name')
            call_id = call.get('id')
            try:
                args = json.loads(function.get('arguments') or '{}')
                if not isinstance(args, dict):
                    args = {}
            except (TypeError, ValueError):
                args = {}

            if nombre in SERVIDOR:
                resp_servidor.append(
                    _tool_message(
                        call_id, nombre,
                        ejecutar_servidor(nombre, args, contexto),
                    )
                )
            elif nombre in EDITOR:
                acciones.append({
                    'id': call_id,
                    'nombre': nombre,
                    'args': args,
                })
            else:
                resp_servidor.append(
                    _tool_message(
                        call_id, nombre,
                        {'error': 'Herramienta desconocida: {}'.format(nombre)},
                    )
                )

        if acciones:
            return {
                'estado': 'acciones',
                'acciones': acciones,
                'pendientes': resp_servidor,
                'historial': _sanitize_history(messages),
            }

        messages.extend(resp_servidor)

    raise AgenteError(
        'El agente dio demasiadas vueltas; intenta una pregunta más concreta.'
    )
