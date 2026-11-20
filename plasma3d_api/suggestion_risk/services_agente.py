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
import queue
import threading

import re
import uuid

from .agent_tools import DECLARACIONES, EDITOR, SERVIDOR, ejecutar_servidor
from .services_ai import (
    AIProviderError,
    chat_completion,
    chat_completion_stream,
    choose_providers,
)
from .support_guides import (
    find_guide,
    is_support_question,
    local_support_answer,
    support_system_prompt,
)

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
- Para cantidades y totales (cuántos muros, puertas, m²...) usa los números del \
  "RESUMEN DEL PLANO". No listes nombres internos de piezas (wall_external_..., \
  door_...) salvo que el usuario lo pida.
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
- Para cambiar medidas usa redimensionar_seleccion y para girar usa \
  rotar_seleccion, con las MISMAS reglas que mover: solo si "seleccion" indica \
  exactamente una pieza y el usuario dio la medida o el ángulo (convierte cm a m). \
  "Hazlo de 4 m" = largo 4 desde el centro; "alárgalo hacia la derecha" = \
  crecer_hacia "derecha". "Gíralo 90°" sin sentido = 90 (antihorario); \
  "en sentido horario" = negativo.
- CREAR SIN PREGUNTAR: si el usuario pide crear/poner/agregar una pared, muro, \
  puerta, ventana o cuarto SIN dar coordenadas ("créame una pared", "ponle una \
  ventana", "agrega 2 puertas a la izquierda"), NO preguntes ubicación, medidas \
  ni material: llama a crear_rapido (pared = muro, cuarto/habitación = ambiente; \
  "de 5 m" = largo 5; "a la izquierda/arriba..." = lado) y luego di en 1 frase \
  dónde quedó y que puede moverla o cambiarle el material. Usa dibujar_muro, \
  agregar_puerta, agregar_ventana o dibujar_ambiente solo si el usuario dio una \
  ubicación concreta o pidió algo relativo a muros específicos del plano.
- Para un cuarto/ambiente con ubicación concreta usa dibujar_ambiente. Para nuevas construcciones fuera \
  del plano deja ~0.5 m o pégalas al muro existente si piden "anexo".
- Puertas y ventanas: colócalas SOBRE un muro (usa sus coordenadas en "muros").
- Para materiales usa nombres del catálogo; si no existe el pedido, ofrece el más \
  parecido (consulta listar_precios).
- Antes de borrar o de cambios de más de 10 piezas, confirma con el usuario \
  (el editor muestra una vista previa con Aplicar/Cancelar).
- Tras actuar, resume en 1–2 líneas qué hiciste y con qué medidas; ofrece ver el costo.

Pedidos grandes (planificar antes de actuar):
- Si el pedido implica MÁS DE 5 piezas o varios ambientes (ej. "diseña una casa \
  de 2 dormitorios", "agrega un ala con 3 cuartos"), NO dibujes pieza por pieza: \
  llama UNA vez a proponer_plan con todos los pasos (cada uno con sus acciones y \
  coordenadas reales, ambientes contiguos que compartan muros, puertas sobre los \
  muros entre ambientes y ventanas en muros exteriores). Si puedes, calcula antes \
  el costo con las herramientas y ponlo en costo_estimado.
- Si el resultado dice que el usuario lo rechazó o pidió cambios, ajusta y \
  vuelve a proponer; si lo ejecutó, resume lo construido en 1–2 líneas.

Autorrevisión:
- Los resultados de dibujo pueden traer "revision": problemas detectados en lo que \
  acabas de dibujar (puerta/ventana fuera de muro, muros cruzados, muro suelto, \
  aberturas superpuestas). Si trae problemas, corrígelos tú mismo (ajustar_al_muro \
  para aberturas; para muros, selecciónalos y usa mover/redimensionar) y avisa en \
  1 línea, ej. "La puerta quedó a 20 cm del muro, la ajusté." Haz como máximo 2 \
  rondas de corrección; si sigue mal, explícale al usuario qué revisar.

Comparar con el plano original:
- Para "¿falta algo?", "¿se parece a mi plano?" o "¿qué cambié?" usa \
  comparar_con_plano: recibirás 2 imágenes (1: plano original, 2: plano actual en \
  planta: muros gris oscuro, puertas con arco, ventanas azules, lo nuevo en verde \
  o violeta). Compara por ambiente y lista lo que FALTA o SOBRA (muros, puertas, \
  ventanas) de forma concreta, y ofrece agregarlo ("¿Lo agrego?"). Ignora \
  muebles, cotas y textos del plano original. Si no hay plano original, dilo.

Mejoras ("¿qué le puedo aumentar?"):
- Analiza el contexto (área de piso, nº de ventanas vs. m², techo, materiales) y \
  propone 3–5 mejoras concretas (ambiente extra, ventanas, porche/techo, materiales \
  mejores), cada una con costo estimado vía herramientas, y pregunta "¿Lo dibujo?".
"""


# Prompt corto para modelos locales chicos (Ollama): mismas reglas clave,
# menos texto y ejemplos concretos (a los modelos chicos les ayuda mucho).
INSTRUCCION_LOCAL = """\
Eres el Agente IA de Plasma3D, asistente de un editor 3D de planos de casas. \
Respondes SIEMPRE en español, en 1 a 4 frases cortas y claras.

Reglas:
1. Cantidades y medidas: copia los números del "RESUMEN DEL PLANO". No cuentes \
tú mismo y NO listes nombres internos (wall_external_..., door_...).
2. Precios y costos: si el mensaje trae "COSTOS ACTUALES", copia esos números \
(total y por categoría). Para otro material o comparar, usa costo_material o \
comparar_materiales. Nunca inventes cifras ni escribas marcadores como <...>. \
Total en dólares con 2 decimales.
3. Mover (mover_seleccion), cambiar medidas (redimensionar_seleccion) o girar \
(rotar_seleccion): solo si "Seleccionado" NO es "nada" y el usuario dio la \
medida/ángulo. Si falta, pídelo. cm → m (50 cm = 0.5).
   - "hazlo de N m", "que mida N m", "más largo/corto": SOLO largo=N. No envíes \
alto ni grosor si el usuario no los nombró.
   - "de N m de alto" / "más alto": SOLO alto=N. "más grueso" / "de N cm de grosor": SOLO grosor.
4. Crear: "créame una pared / puerta / ventana / cuarto" → llama a crear_rapido \
(tipo muro, puerta, ventana o ambiente). NO preguntes ubicación, medidas ni \
material: el editor lo coloca solo. Solo con coordenadas exactas del usuario usa \
dibujar_muro, agregar_puerta o agregar_ventana.
5. "¿Qué le puedo aumentar/mejorar?": mira el RESUMEN y propone 2 o 3 ideas \
concretas (ej.: si "Techo dibujado: no" → agregar techo; pocas ventanas para los \
m² → más ventanas; un ambiente extra de 3×4 m) y pregunta "¿Lo dibujo?".
6. SOLO para diseñar una casa ENTERA, comparar con el plano original o analizar \
imágenes, di: "Eso lo hace mejor el modelo Gemini; cámbialo en el selector \
Modelo de arriba."
7. Tras actuar, di en 1 frase qué hiciste. Responde como en una conversación \
normal: nunca escribas flechas, corchetes ni la palabra "luego".

Ejemplos de estilo (los números reales salen del RESUMEN o de COSTOS ACTUALES):
- Pregunta: ¿cuántos muros tiene mi plano? Respuesta: Tu plano tiene 9 muros, con 41.20 m de largo en total.
- Pregunta: ¿cuánto cuesta todo? Respuesta: El modelo cuesta $1,234.50 en total: muros $800.00, puertas $134.50 y piso $300.00.
- Pregunta: ¿cuánto costaría piedra natural en los muros? Respuesta: Con piedra natural los muros costarían $2,100.00 (75 m² × $28.00).
- Pregunta: hazlo de 4 m (con un muro seleccionado). Acción: redimensionar_seleccion con largo 4. Respuesta: Listo, el muro ahora mide 4.00 m de largo.
- Pregunta: créame una pared. Acción: crear_rapido con tipo muro. Respuesta: Listo, creé una pared de 3 m afuera del modelo, a la derecha. Puedes moverla o cambiarle el material.
"""

# Herramientas que NO se envían a modelos locales (pesadas o requieren visión).
HERRAMIENTAS_SOLO_NUBE = ('proponer_plan', 'comparar_con_plano', 'mostrar_medidas', 'cambiar_vista')


def _perfil(provider):
    """Cómo se le habla a cada proveedor. Gemini/DeepSeek: completo; Ollama: liviano."""
    if (provider or {}).get('name') == 'ollama':
        return {
            'local': True,
            'instruccion': INSTRUCCION_LOCAL,
            'temperatura': 0.2,
            'sin_herramientas': HERRAMIENTAS_SOLO_NUBE,
            'max_contenidos': 14,
        }
    return {
        'local': False,
        'instruccion': INSTRUCCION_SISTEMA,
        'temperatura': 0.4,
        'sin_herramientas': (),
        'max_contenidos': MAX_CONTENIDOS,
    }


_PARAMS = {
    d['name']: (
        set((d.get('parameters') or {}).get('properties') or {}),
        list((d.get('parameters') or {}).get('required') or []),
        (d.get('parameters') or {}).get('properties') or {},
    )
    for d in DECLARACIONES
}
# Herramientas que un modelo local puede "escribir" en vez de llamar.
_RESCATABLES = (EDITOR | SERVIDOR) - set(HERRAMIENTAS_SOLO_NUBE) - {'proponer_plan'}


def _rescatar_tool_call(texto):
    """
    Los modelos chicos a veces ESCRIBEN la herramienta ("rotar_seleccion con
    grados 90" o un JSON) en vez de llamarla. Si el texto nombra una
    herramienta y trae todos sus datos obligatorios, se convierte en la
    llamada real. Si falta algo, no se inventa nada.
    """
    if not texto:
        return None
    t = texto.strip()
    # 1) JSON tipo {"name": "...", "arguments": {...}}
    m = re.search(r'\{.*\}', t, re.S)
    if m:
        try:
            data = json.loads(m.group(0))
            nombre = data.get('name') or data.get('nombre')
            args = data.get('arguments') or data.get('args') or data.get('parameters') or {}
            if isinstance(args, str):
                args = json.loads(args)
            if nombre in _RESCATABLES and isinstance(args, dict):
                return _tool_call(nombre, args)
        except (ValueError, AttributeError):
            pass
    # 2) Nombre de herramienta en el texto + "parametro valor"
    bajo = t.lower()
    nombre = next((n for n in sorted(_RESCATABLES, key=len, reverse=True) if n in bajo), None)
    if not nombre:
        return None
    permitidos, requeridos, props = _PARAMS.get(nombre, (set(), [], {}))
    args = {}
    for param in permitidos:
        tipo = str((props.get(param) or {}).get('type', '')).upper()
        enum = (props.get(param) or {}).get('enum')
        patron = r'\b{}\b["\']?\s*(?:=|:|(?:de|con|en)\b)?\s*["\']?'.format(re.escape(param))
        if tipo == 'NUMBER':
            v = re.search(patron + r'(-?\d+(?:[.,]\d+)?)', bajo)
            if v:
                args[param] = float(v.group(1).replace(',', '.'))
        elif enum:
            v = re.search(patron + r'([a-z_]+)', bajo)
            if v and v.group(1) in enum:
                args[param] = v.group(1)
    if any(r not in args for r in requeridos):
        return None
    return _tool_call(nombre, args)


_VERBOS_CREAR = (
    r'(?:cr[eé]a(?:me|le|r)?|pon(?:me|le|er)?|agr[eé]ga(?:me|le|r)?|a[ñn]ade(?:me|le)?|a[ñn]adir|'
    r'dib[uú]ja(?:me|le)?|dibujar|haz(?:me|le)?|hacer|genera(?:me|r)?|coloca(?:me|le|r)?|mete(?:le)?|'
    r'quiero|necesito)'
)
_OBJETOS = {
    'muro': r'(?:pared(?:es)?|muros?)',
    'puerta': r'(?:puertas?)',
    'ventana': r'(?:ventanas?|ventanales?)',
    'ambiente': r'(?:cuartos?|habitaci[oó]n(?:es)?|ambientes?|dormitorios?|piezas? nuevas?)',
}
_NUMEROS = {'un': 1, 'una': 1, 'uno': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
            'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10}
# Si aparece algo de esto, el pedido no es "simple": decide la IA.
_NO_ATAJO = (
    'cuest', 'costo', 'precio', 'presupuesto', 'material', 'piedra', 'madera', 'vidrio', 'ladrillo',
    'concreto', 'cemento', 'color', 'x=', 'z=', 'coordenada', 'entre', 'junto a', 'al lado del',
    'cocina', 'baño', 'bano', 'sala', 'comedor', 'casa', '?', ' y ', 'después', 'luego', 'borra',
    'elimina', 'mueve', 'gira',
)


def _atajo_crear(texto):
    """
    "créame una pared", "pon 2 ventanas a la izquierda", "agrega una puerta de 1 m"...
    Pedidos simples de crear se resuelven sin llamar a la IA (instantáneo y
    sin errores, sobre todo con modelos locales). Devuelve los args de
    crear_rapido o None si el pedido no es claramente simple.
    """
    t = ' {} '.format((texto or '').lower().strip().rstrip('.!'))
    if len(t) > 90 or any(p in t for p in _NO_ATAJO):
        return None
    if not re.search(r'\b' + _VERBOS_CREAR + r'\b', t):
        return None
    encontrados = [tipo for tipo, patron in _OBJETOS.items() if re.search(r'\b' + patron + r'\b', t)]
    if len(encontrados) != 1:
        return None
    tipo = encontrados[0]
    args = {'tipo': tipo}
    # Cantidad: "2 ventanas", "dos puertas"; plural sin número → 2.
    m = re.search(r'\b(\d{1,2}|' + '|'.join(_NUMEROS) + r')\s+(?:\w+\s+)?' + _OBJETOS[tipo] + r'\b', t)
    if m:
        valor = m.group(1)
        args['cantidad'] = int(valor) if valor.isdigit() else _NUMEROS[valor]
    else:
        palabra = re.search(r'\b' + _OBJETOS[tipo] + r'\b', t)
        if palabra and palabra.group(0).split()[0].endswith('s'):
            args['cantidad'] = 2  # plural sin número: "créame ventanas"
    if args.get('cantidad', 1) > 10 or args.get('cantidad', 1) < 1:
        return None
    # Medida: "de 5 m", "de 120 cm", "de 3 metros"; ambiente "de 3x4".
    m = re.search(r'\bde\s+(\d+(?:[.,]\d+)?)\s*(?:x|×|por)\s*(\d+(?:[.,]\d+)?)', t)
    if m and tipo == 'ambiente':
        args['largo'] = float(m.group(1).replace(',', '.'))
        args['fondo'] = float(m.group(2).replace(',', '.'))
    else:
        m = re.search(r'\bde\s+(\d+(?:[.,]\d+)?)\s*(m|mts?|metros?|cm|cent[ií]metros?)\b', t)
        if m:
            valor = float(m.group(1).replace(',', '.'))
            args['largo'] = valor / 100 if m.group(2).startswith(('cm', 'cent')) else valor
    # Lado.
    for palabras, lado in ((('derecha', 'este'), 'derecha'), (('izquierda', 'oeste'), 'izquierda'),
                           (('arriba', 'norte'), 'arriba'), (('abajo', 'sur'), 'abajo')):
        if any(re.search(r'\b{}\b'.format(p), t) for p in palabras):
            args['lado'] = lado
            break
    return args


def _tool_call(nombre, args):
    return {
        'id': 'call_rescate_{}'.format(uuid.uuid4().hex[:8]),
        'type': 'function',
        'function': {'name': nombre, 'arguments': json.dumps(args, ensure_ascii=False)},
    }


class AgenteError(Exception):
    """Error al consultar al agente (se responde 502 al cliente)."""


_NOMBRE_TIPO = {
    'wall': ('Muros', 'muro'), 'door': ('Puertas', 'puerta'), 'window': ('Ventanas', 'ventana'),
    'floor': ('Pisos', 'piso'), 'roof': ('Techos', 'techo'),
}


def _num(valor):
    try:
        return float(valor)
    except (TypeError, ValueError):
        return None


def _resumen_texto(contexto):
    """
    Hechos ya calculados del plano, en texto simple. Los modelos (sobre todo
    los chicos) los leen mucho mejor que el JSON completo.
    """
    contexto = contexto or {}
    piezas = contexto.get('piezas') or {}
    lineas = ['RESUMEN DEL PLANO (datos exactos, úsalos tal cual):']
    for tipo in ('wall', 'door', 'window', 'floor', 'roof'):
        p = piezas.get(tipo) or {}
        cantidad = int(p.get('cantidad') or 0)
        plural = _NOMBRE_TIPO[tipo][0]
        extra = []
        largo = _num(p.get('largo_total_m'))
        area = _num(p.get('area_m2'))
        if tipo == 'wall' and largo:
            extra.append('largo total {:.2f} m'.format(largo))
        if area:
            extra.append('{:.2f} m²'.format(area))
        lineas.append('- {}: {}{}'.format(plural, cantidad, ' ({})'.format(', '.join(extra)) if extra else ''))
    if contexto.get('techo'):
        lineas.append('- Techo dibujado: {}'.format(contexto['techo']))
    lim = contexto.get('limites') or {}
    if lim and not lim.get('vacio'):
        ancho = (_num(lim.get('max_x')) or 0) - (_num(lim.get('min_x')) or 0)
        fondo = (_num(lim.get('max_z')) or 0) - (_num(lim.get('min_z')) or 0)
        lineas.append('- Tamaño total del plano: {:.2f} m × {:.2f} m (x de {} a {}, z de {} a {})'.format(
            ancho, fondo, lim.get('min_x'), lim.get('max_x'), lim.get('min_z'), lim.get('max_z')))
    sel = contexto.get('seleccion')
    if isinstance(sel, dict) and sel:
        tipo = _NOMBRE_TIPO.get(sel.get('tipo'), (None, sel.get('tipo') or 'pieza'))[1]
        medidas = []
        for clave, nombre in (('largo_m', 'largo'), ('alto_m', 'alto'), ('espesor_m', 'grosor')):
            valor = _num(sel.get(clave))
            if valor:
                medidas.append('{} {:.2f} m'.format(nombre, valor))
        cuantas = int(sel.get('piezas_seleccionadas') or 1)
        lineas.append('- Seleccionado: {} ({}{}){}{}'.format(
            sel.get('nombre'), tipo,
            ', ' + ', '.join(medidas) if medidas else '',
            ', material ' + str(sel['material']) if sel.get('material') else '',
            ' — y {} pieza(s) más'.format(cuantas - 1) if cuantas > 1 else '',
        ))
    else:
        lineas.append('- Seleccionado: nada')
    if contexto.get('unidad'):
        lineas.append('- Unidad preferida del usuario: {}'.format(contexto['unidad']))
    return '\n'.join(lineas)


# Palabras que indican que hace falta ubicar piezas (coordenadas completas).
_PALABRAS_UBICACION = (
    'dibuj', 'agreg', 'añad', 'anad', 'coloc', 'pon', 'mueve', 'mover', 'muev', 'derech',
    'izquier', 'norte', 'sur', 'este', 'oeste', 'arriba', 'abajo', 'cuarto', 'ambiente',
    'habitac', 'anexo', 'ventana', 'puerta', 'muro', 'pared', 'piso', 'techo', 'donde', 'dónde',
)


def _contexto_compacto(contexto, texto):
    """
    Contexto liviano para modelos locales: sin catálogo (está listar_precios)
    y, si el mensaje no habla de ubicar piezas, solo las 15 piezas más
    cercanas a la selección (o al centro) de cada tipo.
    """
    contexto = dict(contexto or {})
    contexto.pop('materiales_catalogo', None)
    contexto.pop('tipos', None)
    contexto.pop('seleccion_nombres', None)
    t = (texto or '').lower()
    if any(p in t for p in _PALABRAS_UBICACION):
        return contexto
    sel = contexto.get('seleccion') if isinstance(contexto.get('seleccion'), dict) else None
    pos = (sel or {}).get('posicion_mundo_m') or {}
    cx, cz = _num(pos.get('x')) or 0.0, _num(pos.get('z')) or 0.0

    def cerca(item):
        x = ((_num(item.get('x1')) or 0) + (_num(item.get('x2')) or 0)) / 2
        z = ((_num(item.get('z1')) or 0) + (_num(item.get('z2')) or 0)) / 2
        return (x - cx) ** 2 + (z - cz) ** 2

    for clave in ('muros', 'puertas', 'ventanas'):
        lista = contexto.get(clave)
        if isinstance(lista, list) and len(lista) > 15:
            contexto[clave] = sorted(
                (i for i in lista if isinstance(i, dict)), key=cerca
            )[:15]
            contexto[clave + '_nota'] = 'solo las 15 más cercanas de {}'.format(len(lista))
    return contexto


_PALABRAS_COSTO = ('cuest', 'costo', 'coste', 'precio', 'presupuesto', 'cuánto', 'cuanto', 'dinero', 'gast', '$')


def _costos_texto(contexto, texto):
    """
    Para modelos locales: si la pregunta es de costos, se calcula aquí el
    presupuesto real (misma lógica que el botón Presupuesto) y va en texto.
    Los modelos chicos no siempre llaman bien a la herramienta.
    """
    t = (texto or '').lower()
    if not any(p in t for p in _PALABRAS_COSTO) or not (contexto or {}).get('objetos'):
        return ''
    try:
        r = ejecutar_servidor('presupuesto_actual', {}, contexto)
    except Exception:
        return ''
    if not isinstance(r, dict) or r.get('total') is None:
        return ''
    lineas = ['COSTOS ACTUALES (calculados con los precios cargados, úsalos tal cual):',
              '- Total del modelo: ${:,.2f}'.format(float(r['total']))]
    for categoria, valor in (r.get('por_categoria') or {}).items():
        lineas.append('- {}: ${:,.2f}'.format(categoria.capitalize(), float(valor)))
    for fila in (r.get('detalle') or [])[:8]:
        lineas.append('  · {} ({}): {} {} × ${} = ${:,.2f}{}'.format(
            fila.get('material'), fila.get('categoria'), fila.get('cantidad'), fila.get('unidad'),
            fila.get('precio_unitario'), float(fila.get('subtotal') or 0),
            ' (precio estimado)' if fila.get('estimado') else ''))
    if r.get('avisos'):
        lineas.append('- Sin precio cargado: {}'.format(', '.join(map(str, r['avisos']))))

    # "¿cuánto costaría piedra natural en los muros?": material del catálogo
    # nombrado en el mensaje → costo con ese material en la categoría pedida.
    categorias = [cat for palabras, cat in (
        (('muro', 'pared'), 'wall'), (('piso', 'suelo'), 'floor'), (('techo', 'teja'), 'roof'),
        (('puerta',), 'door'), (('ventana',), 'window'),
    ) if any(p in t for p in palabras)] or ['wall']
    nombrados = [m for m in (contexto.get('materiales_catalogo') or [])
                 if isinstance(m, str) and m.lower() in t]
    for material in nombrados[:3]:
        for categoria in categorias[:2]:
            try:
                c = ejecutar_servidor('costo_material', {'categoria': categoria, 'material': material}, contexto)
            except Exception:
                continue
            if isinstance(c, dict) and c.get('total') is not None:
                lineas.append('- Con {} en {}: {} {} × ${} = ${:,.2f}{}'.format(
                    c.get('material', material), c.get('categoria', categoria), c.get('cantidad'),
                    c.get('unidad'), c.get('precio_unitario'), float(c['total']),
                    ' (precio estimado)' if c.get('estimado') else ''))
    lineas.append('(Para comparar varios materiales usa comparar_materiales.)')
    return '\n'.join(lineas)


def _texto_usuario(texto, contexto, compacto=False):
    datos = {k: v for k, v in (contexto or {}).items() if k != "objetos"}
    resumen = _resumen_texto(contexto)
    if compacto:
        datos = _contexto_compacto(datos, texto)
        costos = _costos_texto(contexto, texto)
        if costos:
            resumen += '\n\n' + costos
    bloque = "CONTEXTO DEL MODELO (JSON):\n" + json.dumps(
        datos, ensure_ascii=False
    )
    return "{}\n\n{}\n\nMENSAJE DEL USUARIO:\n{}".format(resumen, bloque, texto)


def _solo_mensaje(content):
    """Del texto de un turno viejo deja solo la pregunta (sin el contexto viejo)."""
    if isinstance(content, str) and 'MENSAJE DEL USUARIO:\n' in content:
        return content.split('MENSAJE DEL USUARIO:\n', 1)[1]
    return content


def _recortar(messages, maximo=MAX_CONTENIDOS):
    """Limita el historial sin romper la secuencia de tool calls."""
    if len(messages) <= maximo:
        return messages
    window = messages[-maximo:]
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


def _imagenes_de_resultados(resultados):
    """
    Saca las imágenes que devuelven algunas herramientas del editor (p. ej.
    comparar_con_plano) para mandarlas como mensaje multimodal y no como
    texto JSON gigante dentro del resultado.
    """
    imagenes = []
    limpios = []
    for r in resultados or []:
        if not isinstance(r, dict):
            continue
        respuesta = dict(r.get('respuesta') or {})
        for item in respuesta.pop('imagenes', None) or []:
            if (isinstance(item, dict) and isinstance(item.get('url'), str)
                    and item['url'].startswith('data:image/')
                    and len(item['url']) <= 6 * 1024 * 1024):
                imagenes.append({'titulo': str(item.get('titulo') or 'Imagen'), 'url': item['url']})
        limpios.append({**r, 'respuesta': respuesta})
    return limpios, imagenes[:4]


def _armar_mensajes(historial, contexto, mensaje, resultados, pendientes, imagen, compacto=False):
    """
    Historial + el nuevo turno (pregunta o resultados). Devuelve (messages, has_image).
    Con `compacto` (modelo local) el contexto va reducido y los turnos viejos
    pierden su contexto (ya no sirve y ocupa mucho).
    """
    messages = []
    for item in (historial or []):
        if not isinstance(item, dict) or not item.get('role'):
            continue
        message = dict(item)
        # Limpiar historiales antiguos que guardaron "tool_calls": [].
        if not message.get('tool_calls'):
            message.pop('tool_calls', None)
        if compacto and message.get('role') == 'user':
            message['content'] = _solo_mensaje(message.get('content'))
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
                        texto or 'Analiza la imagen adjunta.', contexto, compacto
                    ),
                },
                {'type': 'image_url', 'image_url': {'url': imagen}},
            ]
        else:
            content = _texto_usuario(texto, contexto, compacto)
        messages.append({'role': 'user', 'content': content})
    elif resultados is not None:
        resultados, imagenes = _imagenes_de_resultados(resultados)
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
        if imagenes:
            has_image = True
            content = [{
                'type': 'text',
                'text': 'Imágenes devueltas por la herramienta (en este orden): '
                        + '; '.join(
                            'Imagen {}: {}'.format(i + 1, img['titulo'])
                            for i, img in enumerate(imagenes)
                        ),
            }]
            content += [
                {'type': 'image_url', 'image_url': {'url': img['url']}}
                for img in imagenes
            ]
            messages.append({'role': 'user', 'content': content})
    else:
        raise AgenteError('Escribe un mensaje para el agente.')
    return messages, has_image


def _responder_soporte(historial, contexto, mensaje, imagen, proveedor, on_token):
    """Guía de uso en el contrato del chat, sin exponer acciones del editor."""
    contexto = contexto if isinstance(contexto, dict) else {}
    contexto_ayuda = {
        key: contexto[key]
        for key in ('pantalla_actual', 'pantalla', 'ruta', 'vista', 'seleccion', 'unidad')
        if key in contexto
    }
    messages, _ = _armar_mensajes(
        historial, contexto_ayuda, mensaje, None, None, imagen,
    )
    guide = find_guide(mensaje, contexto_ayuda, historial)
    system = support_system_prompt()
    if guide:
        system += '\n\nGUÍA MÁS RELACIONADA: ' + guide['answer']
    else:
        system += '\n\nNo hay guía relacionada con esta pregunta. Di que no conoces esa función.'
    model_messages = [{'role': 'system', 'content': system}]
    for index, item in enumerate(messages[-14:]):
        role = item.get('role')
        if role not in ('user', 'assistant') or item.get('tool_calls'):
            continue
        content = item.get('content')
        if isinstance(content, list):
            # La imagen del turno actual sí se envía; las anteriores no se repiten.
            content = content if index == len(messages[-14:]) - 1 else _contenido_texto(item)
        else:
            content = _solo_mensaje(content)
        if content:
            model_messages.append({'role': role, 'content': content})

    text = ''
    used_provider = None
    excluded = {tool['name'] for tool in DECLARACIONES}
    for candidate in choose_providers(has_image=bool(imagen), preferido=proveedor):
        try:
            if on_token is None:
                answer = chat_completion(
                    model_messages, candidate, temperature=0.2,
                    exclude_tools=excluded,
                )
            else:
                answer = chat_completion_stream(
                    model_messages, candidate, on_token, temperature=0.2,
                    exclude_tools=excluded,
                )
        except AIProviderError:
            continue
        if answer.get('tool_calls'):
            continue
        text = _contenido_texto(answer)
        if text:
            used_provider = candidate['name']
            break

    if not text:
        text = local_support_answer(
            mensaje, contexto_ayuda, historial, has_image=bool(imagen),
        )
        if on_token is not None:
            on_token(text)
    messages.append({'role': 'assistant', 'content': text})
    result = {
        'estado': 'respuesta',
        'texto': text,
        'historial': _sanitize_history(messages),
    }
    if used_provider:
        result['proveedor'] = used_provider
    return result


def _nucleo_agente(
    historial,
    contexto,
    mensaje=None,
    resultados=None,
    pendientes=None,
    imagen=None,
    proveedor=None,
    modo=None,
    on_token=None,
):
    """
    Un paso del bucle del agente. Con `on_token(texto)` la respuesta de texto
    se transmite a medida que llega (streaming).

    Returns dict:
      {estado: 'respuesta', texto, historial, proveedor}
      {estado: 'acciones', acciones:[{id,nombre,args}], pendientes:[...], historial, proveedor}
    """
    if (modo == 'soporte' or (mensaje and is_support_question(mensaje))) and resultados is None:
        return _responder_soporte(
            historial, contexto, mensaje, imagen, proveedor, on_token,
        )

    # ¿Habrá imágenes en este turno? (decide el proveedor antes de armar el mensaje)
    trae_imagen = bool(imagen) or any(
        isinstance(r, dict) and (r.get('respuesta') or {}).get('imagenes')
        for r in (resultados or [])
    )
    providers = choose_providers(has_image=trae_imagen, preferido=proveedor)
    if not providers:
        raise AgenteError(
            'No hay proveedor de IA configurado. Define GEMINI_API_KEY o '
            'DEEPSEEK_API_KEY en el entorno.'
        )
    compacto = _perfil(providers[0])['local']
    messages, has_image = _armar_mensajes(
        historial, contexto, mensaje, resultados, pendientes, imagen, compacto=compacto
    )

    # Resultado de crear_rapido que salió bien: la frase final también es fija
    # (sin esperar a la IA; con un modelo local ahorra ~1 minuto).
    solo_rapido = (
        resultados and not pendientes
        and all(isinstance(r, dict) and r.get('nombre') == 'crear_rapido' for r in resultados)
        and all((r.get('respuesta') or {}).get('ok') is True for r in resultados)
    )
    if solo_rapido:
        creados = [str((r.get('respuesta') or {}).get('creado') or 'la pieza') for r in resultados]
        texto = 'Listo, creé: {}. Puedes moverla, girarla o cambiarle el material cuando quieras.'.format(
            '; '.join(c[0].lower() + c[1:] if c else c for c in creados))
        messages.append({'role': 'assistant', 'content': texto})
        return {
            'estado': 'respuesta',
            'texto': texto,
            'historial': _sanitize_history(messages),
            'proveedor': providers[0]['name'],
        }

    # Atajo: "créame una pared/puerta/ventana/cuarto" → crear_rapido sin
    # llamar a la IA (instantáneo).
    if mensaje and not imagen:
        atajo = _atajo_crear(mensaje)
        if atajo:
            call = _tool_call('crear_rapido', atajo)
            messages.append({'role': 'assistant', 'content': '', 'tool_calls': [call]})
            return {
                'estado': 'acciones',
                'acciones': [{'id': call['id'], 'nombre': 'crear_rapido', 'args': atajo}],
                'pendientes': [],
                'historial': _sanitize_history(messages),
                'proveedor': providers[0]['name'],
            }

    def llamar(msgs, candidate, timeout):
        perfil = _perfil(candidate)
        # Un modelo local (Ollama) necesita más tiempo que la nube.
        timeout = max(timeout, int(candidate.get('timeout') or 0))
        msgs = _recortar(msgs, perfil['max_contenidos'])
        system = [{'role': 'system', 'content': perfil['instruccion']}]
        kwargs = {
            'timeout': timeout,
            'temperature': perfil['temperatura'],
            'exclude_tools': perfil['sin_herramientas'],
        }
        if on_token is not None:
            return chat_completion_stream(system + msgs, candidate, on_token, **kwargs)
        return chat_completion(system + msgs, candidate, **kwargs)

    provider = None
    first_call = True

    for _ in range(MAX_PASOS_SERVIDOR):
        messages = _recortar(messages)
        if first_call:
            asistente = None
            errores = []
            for candidate in providers:
                try:
                    asistente = llamar(messages, candidate, 45 if has_image else 60)
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
                asistente = llamar(messages, provider, 60)
            except AIProviderError as exc:
                raise AgenteError(str(exc)) from exc

        if _perfil(provider)['local'] and not asistente.get('tool_calls'):
            rescatada = _rescatar_tool_call(_contenido_texto(asistente))
            if rescatada:
                asistente = {'role': 'assistant', 'content': '', 'tool_calls': [rescatada]}
        messages.append(asistente)
        tool_calls = asistente.get('tool_calls') or []

        if not tool_calls:
            texto = _contenido_texto(asistente)
            return {
                'estado': 'respuesta',
                'texto': texto or 'Listo.',
                'historial': _sanitize_history(messages),
                'proveedor': provider['name'],
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
                'proveedor': provider['name'],
            }

        messages.extend(resp_servidor)

    raise AgenteError(
        'El agente dio demasiadas vueltas; intenta una pregunta más concreta.'
    )


def responder_agente(
    historial,
    contexto,
    mensaje=None,
    resultados=None,
    pendientes=None,
    imagen=None,
    proveedor=None,
    modo=None,
):
    """Un paso del bucle del agente (respuesta completa, sin streaming)."""
    return _nucleo_agente(
        historial, contexto, mensaje=mensaje, resultados=resultados,
        pendientes=pendientes, imagen=imagen, proveedor=proveedor, modo=modo,
    )


def responder_agente_stream(
    historial,
    contexto,
    mensaje=None,
    resultados=None,
    pendientes=None,
    imagen=None,
    proveedor=None,
    modo=None,
):
    """
    Igual que responder_agente, pero como generador de eventos:
      ('token', {'t': texto_parcial}) ... y al final
      ('acciones', paso) | ('fin', paso) | ('error', {'detail': ...})
    El trabajo corre en un hilo y los tokens llegan por una cola.
    """
    eventos = queue.Queue()

    def trabajar():
        try:
            paso = _nucleo_agente(
                historial, contexto, mensaje=mensaje, resultados=resultados,
                pendientes=pendientes, imagen=imagen, proveedor=proveedor,
                modo=modo,
                on_token=lambda t: eventos.put(('token', {'t': t})),
            )
            eventos.put(('acciones' if paso['estado'] == 'acciones' else 'fin', paso))
        except AgenteError as exc:
            eventos.put(('error', {'detail': str(exc)}))
        except Exception as exc:  # nunca dejar el stream colgado
            eventos.put(('error', {'detail': 'Error interno del agente: {}'.format(exc)}))
        finally:
            eventos.put(None)

    hilo = threading.Thread(target=trabajar, daemon=True)
    hilo.start()
    while True:
        evento = eventos.get()
        if evento is None:
            break
        yield evento
