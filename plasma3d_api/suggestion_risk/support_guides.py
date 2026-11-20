"""Guías breves de la interfaz web usadas por el soporte del Agente IA.

Los pasos se basan en los controles visibles de Dashboard, Revisión 2D,
Editor, Perfil, Pagos y Admin. Mantenerlos al día cuando cambie la interfaz.
"""

import re
import unicodedata


GUIDES = (
    {
        'key': 'subir_plano',
        'title': 'Subir un plano',
        'patterns': (r'\b(subir|subo|sube|cargar|cargo|importar|importo|adjuntar)\b.*\bplano\b',),
        'answer': (
            'En Dashboard, elige el tipo de techo y, si conoces la medida, escribe el Ancho real. '
            'Pulsa «Subir plano» y selecciona tu archivo. Si activaste «Revisar en 2D», '
            'corrige la detección antes de pulsar «Generar 3D».'
        ),
    },
    {
        'key': 'abrir_modelo',
        'title': 'Abrir o crear un modelo',
        'patterns': (
            r'\b(abrir|abro|abre|entrar|ver|veo)\b.*\b(modelo|proyecto|editor)\b',
            r'\b(crear|creo)\b.*\bmodelo\b',
        ),
        'answer': (
            'En Dashboard, busca la tarjeta de tu modelo y pulsa «Abrir editor». '
            'Si quieres empezar desde cero, pulsa «Crear modelo» y después abre su tarjeta.'
        ),
    },
    {
        'key': 'revision_2d',
        'title': 'Revisar el plano en 2D',
        'patterns': (
            r'\b(revisar|reviso|corregir|corrijo|revision|deteccion)\b.*\b(2d|plano|muro|puerta|ventana)\b',
            r'\b(2d|plano)\b.*\b(revisar|corregir)\b',
        ),
        'answer': (
            'Activa «Revisar en 2D» antes de subir el plano, o pulsa «Corregir 2D» en su tarjeta. '
            'En la revisión elige Muro, Puerta o Ventana para dibujar lo que falta; selecciona '
            'lo incorrecto y usa «Borrar». Pulsa «Guardar» y luego «Generar 3D».'
        ),
    },
    {
        'key': 'dibujar_pared',
        'title': 'Dibujar una pared',
        'patterns': (
            r'\b(crear|creo|dibujo|dibujar|hacer|hago|poner|pongo|agregar|agrego)\b.*\b(pared|muro)\b',
            r'\b(pared|muro)\b.*\b(dibujar|crear)\b',
        ),
        'answer': (
            'Abre el modelo en el editor, pulsa la herramienta «Dibujar muro» y arrastra '
            'sobre el piso desde el inicio hasta el final de la pared. Pulsa Esc para cancelar. '
            'También puedes pedirme «Créame una pared» si quieres que la dibuje por ti.'
        ),
    },
    {
        'key': 'crear_cuarto',
        'title': 'Crear un cuarto',
        'patterns': (r'\b(crear|creo|dibujar|dibujo|hacer)\b.*\b(cuarto|habitacion|ambiente)\b',),
        'answer': (
            'En el editor abre «Agente IA» y pide «Créame un cuarto de 3×4 m». '
            'Revisa la vista previa y pulsa «Aplicar» si la posición y las medidas '
            'son correctas. Para hacerlo manualmente, dibuja sus muros y piso.'
        ),
    },
    {
        'key': 'dibujar_abertura',
        'title': 'Dibujar una puerta o ventana',
        'patterns': (
            r'\b(crear|creo|dibujo|dibujar|hacer|hago|poner|pongo|agregar|agrego)\b.*\b(puerta|ventana)\b',
            r'\b(puerta|ventana)\b.*\b(dibujar|crear)\b',
        ),
        'answer': (
            'En el editor pulsa «Dibujar puerta» o «Dibujar ventana». Arrastra sobre '
            'el muro donde debe quedar la abertura; al terminar, revisa su posición '
            'y tamaño en «Propiedades».'
        ),
    },
    {
        'key': 'mover_pieza',
        'title': 'Mover una pieza',
        'patterns': (r'\b(mover|muevo|desplazar|girar|rotar|escalar)\b.*\b(pared|muro|pieza|puerta|ventana|objeto)\b',),
        'answer': (
            'Selecciona una sola pieza en el editor. Usa «Mover», «Rotar» o «Escalar» '
            'en la barra de herramientas y ajusta la pieza; también puedes cambiar '
            'sus valores en «Propiedades». Si me pides moverla, indica dirección y distancia.'
        ),
    },
    {
        'key': 'materiales',
        'title': 'Cambiar un material',
        'patterns': (r'\b(material|textura|color)\b',),
        'answer': (
            'Selecciona la pieza en el editor, abre «Propiedades» y elige su material. '
            'También puedes abrir «Materiales» para ver la biblioteca y aplicarlo '
            'a la selección. Comprueba el estado «Guardado» antes de salir.'
        ),
    },
    {
        'key': 'guardar',
        'title': 'Guardar el modelo',
        'patterns': (r'\b(guardar|guardo|guardado|autoguardado|salvar)\b',),
        'answer': (
            'En el editor pulsa «Guardar» y espera a que aparezca «Guardado ✓». '
            'Los cambios también se guardan automáticamente unos segundos después '
            'de editar. Si aparece «Error al guardar», vuelve a pulsar «Guardar».'
        ),
    },
    {
        'key': 'deshacer',
        'title': 'Deshacer o rehacer',
        'patterns': (r'\b(deshacer|rehacer|ctrl\s*\+\s*z|ctrl\s*\+\s*y)\b',),
        'answer': (
            'En el editor usa los botones de deshacer y rehacer, o Ctrl+Z y Ctrl+Y. '
            'Revisa el resultado en el plano antes de guardarlo.'
        ),
    },
    {
        'key': 'presupuesto',
        'title': 'Ver presupuesto y precios',
        'patterns': (r'\b(presupuesto|precios|costo|costos)\b',),
        'answer': (
            'Con el modelo abierto en el editor pulsa «Presupuesto» para ver el cálculo '
            'de materiales del plano. Pulsa «Precios» para consultar los precios de '
            'materiales; si cambias un material, vuelve a generar el presupuesto.'
        ),
    },
    {
        'key': 'riesgo',
        'title': 'Analizar riesgo estructural',
        'patterns': (r'\b(riesgo|analizar|analisis)\b',),
        'answer': (
            'En el editor, «Analizar» examina el modelo que tienes abierto. En Dashboard, '
            '«Riesgo IA» examina el GLB guardado de la tarjeta. Guarda primero los cambios '
            'del editor si quieres analizar allí la versión actualizada.'
        ),
    },
    {
        'key': 'exportar',
        'title': 'Exportar el modelo',
        'patterns': (r'\b(exportar|descargar)\b.*\b(modelo|glb|gltf|stl|3d)\b',),
        'answer': (
            'Abre el modelo en el editor, pulsa «Exportar» y elige GLB, GLTF o STL. '
            'La descarga se prepara desde el modelo abierto.'
        ),
    },
    {
        'key': 'perfil',
        'title': 'Cambiar el perfil',
        'patterns': (r'\b(perfil|foto|avatar|nombre|correo|email|telefono)\b',),
        'answer': (
            'En la barra superior abre «Perfil». Pulsa «Editar», cambia los datos '
            'permitidos y termina con «Guardar cambios». Para la foto usa «Cambiar imagen».'
        ),
    },
    {
        'key': 'pagos',
        'title': 'Consultar planes y pagos',
        'patterns': (r'\b(pago|pagos|plan premium|suscripcion|historial de pagos)\b',),
        'answer': (
            'En la barra superior abre «Pagos». Allí puedes revisar los planes y elegir '
            'uno; tus operaciones aparecen en «Historial de pagos» en la misma pantalla. '
            'Si un pago no aparece, actualiza la página y comprueba el estado antes de reintentar.'
        ),
    },
    {
        'key': 'admin',
        'title': 'Panel de administración',
        'patterns': (r'\b(admin|administrador|administracion|usuarios)\b',),
        'answer': (
            'Si tu cuenta tiene el rol administrador, abre «Admin» en la barra superior. '
            'El panel muestra métricas, usuarios y pagos; desde la lista de usuarios '
            'puedes revisar sus datos y cambiar roles. Si no ves «Admin», pide acceso '
            'a quien administra el proyecto.'
        ),
    },
    {
        'key': 'primeros_pasos',
        'title': 'Primeros pasos en Plasma3D',
        'patterns': (r'\b(usar|uso|empezar|inicio|primeros pasos|tutorial|app|aplicacion)\b',),
        'answer': (
            'Empieza en Dashboard: pulsa «Subir plano» para convertir un plano 2D o '
            '«Crear modelo» para dibujar desde cero. Abre la tarjeta con «Abrir editor». '
            'Allí puedes dibujar, seleccionar piezas, cambiar materiales y pulsar «Guardar». '
            'Dime en qué paso necesitas ayuda.'
        ),
    },
)

GUIDE_BY_KEY = {guide['key']: guide for guide in GUIDES}
SCREEN_GUIDE = {
    'dashboard': 'primeros_pasos',
    'review': 'revision_2d',
    'revision': 'revision_2d',
    'editor': 'primeros_pasos',
    'perfil': 'perfil',
    'pago': 'pagos',
    'pagos': 'pagos',
    'admin': 'admin',
}


def normalize(text):
    """Normaliza tildes para comparar intenciones y temas en español."""
    value = unicodedata.normalize('NFKD', str(text or '').lower())
    return ''.join(char for char in value if not unicodedata.combining(char))


def is_support_question(message):
    """Distingue preguntas de uso de órdenes directas de modelado."""
    text = normalize(message).strip(' \t\r\n¿?¡!.')
    if not text:
        return False
    if re.match(r'^como\b', text):
        # Las consultas de diseño siguen pasando al agente con herramientas.
        if re.search(r'\b(qued\w*|seri\w*|mejor\w*|aument\w*|disen\w*|costar\w*|constru\w*|distribu\w*|se veria)\b', text):
            return False
        return bool(re.search(
            r'\b(app|aplicacion|plasma3d|editor|boton|herramienta|pantalla|panel|'
            r'pared|muro|puerta|ventana|cuarto|habitacion|piso|techo|material|'
            r'plano|modelo|guardar|guardo|subir|subo|abrir|abro|revisar|reviso|'
            r'exportar|perfil|pago|pagos|seleccionar|selecciono|mover|muevo|'
            r'cambiar|cambio|usar|uso|funciona|activar|activo|deshacer)\b',
            text,
        ))
    return bool(re.match(
        r'^(?:donde\s+(?:esta|encuentro|puedo)|que\s+(?:hago|significa|boton|opcion)|'
        r'para\s+que\s+sirve|por\s+que\s+(?:no\s+puedo|no\s+veo)|'
        r'explicame|ensen(?:a|ame)|guiame|quiero\s+aprender|'
        r'necesito\s+ayuda|ayudame\s+a\s+(?:usar|aprender)|'
        r'pasos?\s+para|tutorial)\b',
        text,
    ))


def find_guide(message, context=None, history=None):
    """Busca un tema verificado; usa la pantalla solo en preguntas generales."""
    text = normalize(message)
    for guide in GUIDES:
        if any(re.search(pattern, text) for pattern in guide['patterns']):
            return guide
    if history and re.match(r'^\s*(?:y\s+)?(?:ahora|despues|luego|como sigo)\b', text):
        for previous in reversed(history):
            if not isinstance(previous, dict) or previous.get('role') != 'user':
                continue
            prior = normalize(previous.get('content', ''))
            for guide in GUIDES:
                if any(re.search(pattern, prior) for pattern in guide['patterns']):
                    return guide
    if re.search(r'\b(que hago aqui|como uso esta pantalla|por donde empiezo|guia general|ayuda general)\b', text):
        context = context if isinstance(context, dict) else {}
        candidates = (
            normalize(context.get('pantalla_actual', '')),
            normalize(context.get('pantalla', '')),
            normalize(context.get('ruta', '')),
        )
        for candidate in candidates:
            for key, guide_key in SCREEN_GUIDE.items():
                if key in candidate:
                    return GUIDE_BY_KEY[guide_key]
        return GUIDE_BY_KEY['primeros_pasos']
    return None


def local_support_answer(message, context=None, history=None, has_image=False):
    """Respuesta útil cuando no hay proveedor de IA o este falla."""
    guide = find_guide(message, context, history)
    if guide is None:
        return (
            'No encuentro una guía verificada para eso en Plasma3D. '
            'Puedo ayudarte a subir un plano, revisar en 2D, editar y guardar '
            'un modelo, cambiar materiales, analizar riesgos, ver pagos o usar el perfil. '
            'Dime cuál de esos pasos necesitas.'
        )
    if has_image:
        return ('No puedo interpretar la imagen sin un modelo de IA con visión. '
                'Mientras tanto: ' + guide['answer'])
    return guide['answer']


def support_system_prompt():
    """Conocimiento acotado a funciones verificadas, sin herramientas de edición."""
    lines = [
        'Eres el asistente de soporte de Plasma3D. Responde en español con pasos cortos '
        'para aprender a usar la aplicación. Usa exclusivamente las guías verificadas '
        'que siguen y el contexto de pantalla; si una función no aparece, dilo y pide '
        'una aclaración. No inventes botones, rutas, estados, precios ni credenciales. '
        'No afirmes que ejecutaste acciones, no modifiques el modelo y no solicites '
        'contraseñas ni datos de tarjeta. Si el usuario da una orden de dibujo dentro '
        'de una consulta de ayuda, explica cómo hacerlo o pídele que use el modo de '
        'edición. En Dashboard, Perfil, Pagos y Admin solo puedes orientar.',
        'GUÍAS VERIFICADAS:',
    ]
    lines.extend('{}: {}'.format(guide['title'], guide['answer']) for guide in GUIDES)
    return '\n'.join(lines)
