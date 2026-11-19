"""
Agente IA del editor: chat con Gemini + herramientas (function calling).

Bucle sin estado:
- El cliente manda `historial` (contenidos crudos de Gemini, incluidas las
  thoughtSignature que Gemini 3 exige devolver), un `mensaje` nuevo o los
  `resultados` de acciones del editor, y el `contexto` actual del modelo.
- Las herramientas de SERVIDOR (precios/costos) se resuelven aquí mismo.
- Si el modelo pide herramientas del EDITOR, se devuelven como `acciones`
  para que el frontend las ejecute y vuelva con sus resultados.
"""
import json

import requests
from django.conf import settings

from .agent_tools import DECLARACIONES, EDITOR, SERVIDOR, ejecutar_servidor
from .services_gemini import GEMINI_API_URL

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
    """Error al consultar a Gemini (se responde 502 al cliente)."""


def _texto_usuario(texto, contexto):
    resumen = {k: v for k, v in (contexto or {}).items() if k != "objetos"}
    bloque = "CONTEXTO DEL MODELO (JSON):\n" + json.dumps(resumen, ensure_ascii=False)
    return f"{bloque}\n\nMENSAJE DEL USUARIO:\n{texto}"


def _recortar(contents):
    """Limita el historial sin partir pares llamada/respuesta de herramientas."""
    if len(contents) <= MAX_CONTENIDOS:
        return contents
    recorte = contents[-MAX_CONTENIDOS:]
    # Empezar en un turno de usuario con texto (no en una functionResponse)
    while recorte and not (
        recorte[0].get("role") == "user"
        and any("text" in p for p in recorte[0].get("parts", []))
    ):
        recorte.pop(0)
    return recorte


def _llamar_gemini(contents):
    api_key = getattr(settings, "GEMINI_API_KEY", None)
    if not api_key:
        raise AgenteError("El agente no está configurado (falta GEMINI_API_KEY).")
    payload = {
        "systemInstruction": {"parts": [{"text": INSTRUCCION_SISTEMA}]},
        "contents": contents,
        "tools": [{"functionDeclarations": DECLARACIONES}],
        "generationConfig": {"temperature": 0.4, "maxOutputTokens": 4096},
    }
    try:
        resp = requests.post(GEMINI_API_URL, params={"key": api_key}, json=payload, timeout=120)
    except requests.RequestException as exc:
        raise AgenteError(f"No se pudo contactar al agente: {exc}") from exc
    if resp.status_code != 200:
        raise AgenteError(f"El agente no respondió ({resp.status_code}): {resp.text[:300]}")
    try:
        return resp.json()["candidates"][0]["content"]
    except (KeyError, IndexError, ValueError) as exc:
        raise AgenteError("Respuesta del agente vacía o inválida.") from exc


def _respuesta_fn(nombre, respuesta, call_id=None):
    fr = {"name": nombre, "response": respuesta if isinstance(respuesta, dict) else {"resultado": respuesta}}
    if call_id:
        fr["id"] = call_id
    return {"functionResponse": fr}


def responder_agente(historial, contexto, mensaje=None, resultados=None, pendientes=None):
    """
    Un paso del bucle del agente.

    Returns dict:
      {estado: 'respuesta', texto, historial}
      {estado: 'acciones', acciones:[{id,nombre,args}], pendientes:[...], historial}
    """
    contents = [c for c in (historial or []) if isinstance(c, dict) and c.get("parts")]

    if mensaje:
        texto = str(mensaje).strip()[:MAX_CHARS_MENSAJE]
        if not texto:
            raise AgenteError("Escribe un mensaje para el agente.")
        contents.append({"role": "user", "parts": [{"text": _texto_usuario(texto, contexto)}]})
    elif resultados is not None:
        # Respuestas a TODAS las llamadas del último turno: las del servidor que
        # ya se resolvieron (pendientes) + las del editor (resultados).
        partes = list(pendientes or []) + [
            _respuesta_fn(r.get("nombre"), r.get("respuesta") or {}, r.get("id"))
            for r in resultados
        ]
        if not partes:
            raise AgenteError("Faltan los resultados de las acciones.")
        contents.append({"role": "user", "parts": partes})
    else:
        raise AgenteError("Escribe un mensaje para el agente.")

    for _ in range(MAX_PASOS_SERVIDOR):
        contents = _recortar(contents)
        modelo = _llamar_gemini(contents)
        modelo.setdefault("role", "model")
        partes = modelo.get("parts") or []
        contents.append(modelo)

        llamadas = [p["functionCall"] for p in partes if "functionCall" in p]
        if not llamadas:
            texto = "".join(
                p.get("text", "") for p in partes if "text" in p and not p.get("thought")
            ).strip()
            return {
                "estado": "respuesta",
                "texto": texto or "Listo.",
                "historial": contents,
            }

        # Ejecutar las de servidor; las del editor van al cliente.
        resp_servidor = []
        acciones = []
        for fc in llamadas:
            nombre = fc.get("name")
            args = fc.get("args") or {}
            if nombre in SERVIDOR:
                resp_servidor.append(
                    _respuesta_fn(nombre, ejecutar_servidor(nombre, args, contexto), fc.get("id"))
                )
            elif nombre in EDITOR:
                acciones.append({"id": fc.get("id"), "nombre": nombre, "args": args})
            else:
                resp_servidor.append(
                    _respuesta_fn(nombre, {"error": f"Herramienta desconocida: {nombre}"}, fc.get("id"))
                )

        if acciones:
            return {
                "estado": "acciones",
                "acciones": acciones,
                "pendientes": resp_servidor,
                "historial": contents,
            }
        contents.append({"role": "user", "parts": resp_servidor})

    raise AgenteError("El agente dio demasiadas vueltas; intenta una pregunta más concreta.")
