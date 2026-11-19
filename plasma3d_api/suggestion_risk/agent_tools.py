"""
Herramientas (function calling) del Agente IA.

- De SERVIDOR: precios y costos. Se ejecutan aquí con los datos reales
  (misma lógica que el botón Presupuesto).
- Del EDITOR: dibujar, cambiar materiales, seleccionar... Las ejecuta el
  frontend sobre el modelo 3D abierto; aquí solo se declaran.

Coordenadas del editor: metros, centro del plano en (0,0), x → derecha,
z → abajo en la vista Planta (norte = -z), piso en y=0.
"""
from presupuesto.views import _cantidad, calcular, tabla_precios

CATEGORIAS = ["wall", "door", "window", "floor", "roof"]
NOMBRE_CAT = {
    "wall": "muros", "door": "puertas", "window": "ventanas",
    "floor": "pisos", "roof": "techos",
}

# Esquemas en formato OpenAPI de Vertex AI
_NUM = {"type": "NUMBER"}
_STR = {"type": "STRING"}


def _cat(desc="Categoría de piezas"):
    return {"type": "STRING", "enum": CATEGORIAS, "description": desc}


def _obj(props, required=None, desc=""):
    return {
        "type": "OBJECT",
        "properties": props,
        "required": required or [],
        "description": desc,
    }


def _seg(desc):
    return _obj({
        "x1": _NUM, "z1": _NUM, "x2": _NUM, "z2": _NUM,
    }, ["x1", "z1", "x2", "z2"], desc)


DECLARACIONES = [
    # ---------------- Servidor: precios y costos ----------------
    {
        "name": "listar_precios",
        "description": "Lista los precios cargados (material, unidad, precio). "
                       "Úsala para saber qué materiales existen y cuánto cuestan.",
        "parameters": _obj({"categoria": _cat("Opcional: filtrar por categoría")}),
    },
    {
        "name": "costo_material",
        "description": "Costo REAL de usar un material en todas las piezas de una "
                       "categoría (o solo en la selección), con las medidas reales "
                       "del plano y el precio cargado.",
        "parameters": _obj({
            "categoria": _cat(),
            "material": {"type": "STRING", "description": "Nombre del material, ej. 'Piedra natural'"},
            "alcance": {"type": "STRING", "enum": ["todas", "seleccion"],
                        "description": "todas (default) o solo las piezas seleccionadas"},
        }, ["categoria", "material"]),
    },
    {
        "name": "comparar_materiales",
        "description": "Compara el costo de varios materiales para una categoría.",
        "parameters": _obj({
            "categoria": _cat(),
            "materiales": {"type": "ARRAY", "items": _STR},
        }, ["categoria", "materiales"]),
    },
    {
        "name": "presupuesto_actual",
        "description": "Presupuesto total del modelo tal como está (igual al botón Presupuesto).",
        "parameters": _obj({}),
    },
    # ---------------- Editor: acciones en el modelo 3D ----------------
    {
        "name": "crear_rapido",
        "description": "Crea al INSTANTE un muro/pared, puerta, ventana o ambiente (cuarto) "
                       "SIN pedir ubicación, medidas ni material: el editor la coloca "
                       "afuera del modelo (o, si hay un muro seleccionado y es puerta/"
                       "ventana, centrada en ese muro) con material por defecto. Úsala "
                       "siempre que el usuario pida crear/poner/agregar algo sin dar "
                       "coordenadas. Ej.: 'créame una pared' → {tipo:'muro'}; "
                       "'2 ventanas a la izquierda' → {tipo:'ventana', cantidad:2, lado:'izquierda'}.",
        "parameters": _obj({
            "tipo": {"type": "STRING", "enum": ["muro", "puerta", "ventana", "ambiente"]},
            "cantidad": {"type": "NUMBER", "description": "1 a 10, default 1"},
            "largo": {"type": "NUMBER", "description": "m. Default: muro 3, puerta 0.9, ventana 1.2, ambiente 3 (ancho)"},
            "fondo": {"type": "NUMBER", "description": "m, solo ambiente (default 4)"},
            "lado": {"type": "STRING", "enum": ["derecha", "izquierda", "arriba", "abajo"],
                     "description": "Lado del modelo donde se crea (default derecha)"},
        }, ["tipo"]),
    },
    {
        "name": "dibujar_muro",
        "description": "Dibuja un muro recto de (x1,z1) a (x2,z2) en metros.",
        "parameters": _obj({
            "x1": _NUM, "z1": _NUM, "x2": _NUM, "z2": _NUM,
            "espesor": {"type": "NUMBER", "description": "m, default 0.15"},
            "alto": {"type": "NUMBER", "description": "m, default 3.0"},
        }, ["x1", "z1", "x2", "z2"]),
    },
    {
        "name": "dibujar_ambiente",
        "description": "Dibuja un ambiente rectangular cerrado (4 muros) con esquina "
                       "superior izquierda en (x,z), ancho en x y largo en z. "
                       "Opcionalmente con piso.",
        "parameters": _obj({
            "x": _NUM, "z": _NUM,
            "ancho": {"type": "NUMBER", "description": "m en x"},
            "largo": {"type": "NUMBER", "description": "m en z"},
            "con_piso": {"type": "BOOLEAN"},
        }, ["x", "z", "ancho", "largo"]),
    },
    {
        "name": "agregar_puerta",
        "description": "Coloca una puerta de (x1,z1) a (x2,z2) (ancho típico 0.9 m), "
                       "normalmente sobre un muro existente.",
        "parameters": _seg(""),
    },
    {
        "name": "agregar_ventana",
        "description": "Coloca una ventana de (x1,z1) a (x2,z2) (ancho típico 1.2 m) sobre un muro.",
        "parameters": _seg(""),
    },
    {
        "name": "dibujar_piso",
        "description": "Losa de piso rectangular entre las esquinas (x1,z1) y (x2,z2).",
        "parameters": _seg(""),
    },
    {
        "name": "dibujar_techo",
        "description": "Techo rectangular entre (x1,z1) y (x2,z2), plano o a dos aguas.",
        "parameters": _obj({
            "x1": _NUM, "z1": _NUM, "x2": _NUM, "z2": _NUM,
            "tipo": {"type": "STRING", "enum": ["plano", "dos_aguas"]},
        }, ["x1", "z1", "x2", "z2"]),
    },
    {
        "name": "cambiar_material",
        "description": "Asigna un material del catálogo a la selección o a todas las "
                       "piezas de una categoría.",
        "parameters": _obj({
            "alcance": {"type": "STRING", "enum": ["seleccion"] + CATEGORIAS,
                        "description": "'seleccion' o una categoría"},
            "material": _STR,
        }, ["alcance", "material"]),
    },
    {
        "name": "seleccionar",
        "description": "Selecciona piezas por categoría o por nombre para mostrarlas al usuario.",
        "parameters": _obj({"categoria": _cat(), "nombre": _STR}),
    },
    {
        "name": "mover_seleccion",
        "description": "Mueve una única pieza que el usuario ya seleccionó en el editor. "
                       "Las direcciones son fijas en la vista Planta, no según la cámara: "
                       "derecha = +x, izquierda = -x, arriba/norte = -z, abajo/sur = +z. "
                       "La distancia debe venir del usuario y expresarse en metros; "
                       "si falta la selección o la distancia, pregunta antes de llamar esta herramienta.",
        "parameters": _obj({
            "direccion": {"type": "STRING", "enum": ["derecha", "izquierda", "arriba", "abajo"]},
            "distancia_m": {"type": "NUMBER", "description": "Distancia positiva en metros, indicada por el usuario"},
        }, ["direccion", "distancia_m"]),
    },
    {
        "name": "redimensionar_seleccion",
        "description": "Cambia las medidas reales (en metros) de la ÚNICA pieza que el "
                       "usuario seleccionó (muro, puerta, ventana o piso). Ej.: 'hazlo de "
                       "4 m' → largo=4. Si falta la selección o la medida, pregunta antes. "
                       "'crecer_hacia' indica hacia dónde se alarga en la vista Planta "
                       "(el otro extremo queda fijo); por defecto 'ambos' (desde el centro).",
        "parameters": _obj({
            "largo": {"type": "NUMBER", "description": "m (ancho, en puertas/ventanas)"},
            "alto": {"type": "NUMBER", "description": "m"},
            "grosor": {"type": "NUMBER", "description": "m (espesor del muro)"},
            "crecer_hacia": {"type": "STRING",
                             "enum": ["ambos", "derecha", "izquierda", "arriba", "abajo"]},
        }),
    },
    {
        "name": "rotar_seleccion",
        "description": "Gira la ÚNICA pieza seleccionada en la vista Planta. Grados "
                       "positivos = antihorario visto desde arriba, negativos = horario. "
                       "'girar 90°' sin sentido → 90. Un muro gira junto con sus puertas "
                       "y ventanas. pivote: 'centro' (default) o 'extremo' (el extremo izquierdo).",
        "parameters": _obj({
            "grados": {"type": "NUMBER"},
            "pivote": {"type": "STRING", "enum": ["centro", "extremo"]},
        }, ["grados"]),
    },
    {
        "name": "eliminar",
        "description": "Elimina la selección o todas las piezas de una categoría. "
                       "El usuario debe confirmarlo en el chat.",
        "parameters": _obj({
            "alcance": {"type": "STRING", "enum": ["seleccion"] + CATEGORIAS},
        }, ["alcance"]),
    },
    {
        "name": "mostrar_medidas",
        "description": "Muestra cotas sobre el plano.",
        "parameters": _obj({
            "categorias": {"type": "ARRAY", "items": _cat()},
            "unidad": {"type": "STRING", "enum": ["cm", "m", "in"]},
        }, ["categorias"]),
    },
    {
        "name": "cambiar_vista",
        "description": "Cambia la vista de la cámara.",
        "parameters": _obj({
            "vista": {"type": "STRING", "enum": ["planta", "alzado", "perfil", "isometrica", "3d"]},
        }, ["vista"]),
    },
    {
        "name": "ajustar_al_muro",
        "description": "Encaja puertas/ventanas en su muro más cercano: las alinea, "
                       "centra y les da el espesor del muro; con rellenar=true cierra "
                       "huecos de hasta 30 cm a los lados. Úsala si el usuario ve "
                       "espacios o ventanas/puertas desalineadas.",
        "parameters": _obj({
            "alcance": {"type": "STRING", "enum": ["seleccion", "window", "door"],
                        "description": "selección, todas las ventanas o todas las puertas"},
            "rellenar": {"type": "BOOLEAN"},
        }, ["alcance"]),
    },
    {
        "name": "proponer_plan",
        "description": "Para pedidos GRANDES (más de 5 piezas o varios ambientes, ej. "
                       "'diseña una casa de 2 dormitorios'): propone TODO el plan de una "
                       "vez. El usuario lo ve con vista previa y decide si se ejecuta. "
                       "Cada paso lleva sus acciones (dibujar_ambiente, dibujar_muro, "
                       "agregar_puerta, agregar_ventana, dibujar_piso, dibujar_techo) con "
                       "los mismos argumentos que esas herramientas.",
        "parameters": _obj({
            "titulo": _STR,
            "pasos": {
                "type": "ARRAY",
                "items": _obj({
                    "descripcion": {"type": "STRING", "description": "ej. 'Sala 4×5 m'"},
                    "acciones": {
                        "type": "ARRAY",
                        "items": _obj({
                            "nombre": {"type": "STRING", "enum": [
                                "dibujar_ambiente", "dibujar_muro", "agregar_puerta",
                                "agregar_ventana", "dibujar_piso", "dibujar_techo",
                            ]},
                            "args": {"type": "STRING",
                                     "description": "JSON con los argumentos de esa "
                                                    "herramienta, ej. "
                                                    "'{\"x\":0,\"z\":0,\"ancho\":4,\"largo\":5,\"con_piso\":true}'"},
                        }, ["nombre", "args"]),
                    },
                }, ["descripcion", "acciones"]),
            },
            "costo_estimado": {"type": "NUMBER",
                               "description": "USD, opcional (usa las herramientas de costo)"},
        }, ["titulo", "pasos"]),
    },
    {
        "name": "comparar_con_plano",
        "description": "Envía 2 imágenes para comparar: el PLANO ORIGINAL que subió el "
                       "usuario y el PLANO ACTUAL del modelo (vista en planta de muros, "
                       "puertas y ventanas). Úsala para '¿falta algo?', '¿se parece a mi "
                       "plano?' o '¿qué cambié?'.",
        "parameters": _obj({}),
    },
    {
        "name": "deshacer_ultima_accion",
        "description": "Revierte la última acción que hizo el agente en el editor.",
        "parameters": _obj({}),
    },
]

SERVIDOR = {"listar_precios", "costo_material", "comparar_materiales", "presupuesto_actual"}
EDITOR = {d["name"] for d in DECLARACIONES} - SERVIDOR


# ---------------------------------------------------------------------------
# Ejecución de las herramientas de servidor
# ---------------------------------------------------------------------------

def _listar_precios(args, contexto):
    _, precios, referencia = tabla_precios()
    cat = (args.get("categoria") or "").lower()
    filas = [
        {
            "categoria": c, "material": m.nombre, "unidad": m.unidad,
            "precio": float(m.precio_unitario),
            "referencia": referencia.get(c) is m,
        }
        for (c, _), m in precios.items() if not cat or c == cat
    ]
    return {"precios": filas}


def _costo(categoria, material, alcance, contexto):
    categoria = (categoria or "").lower()
    if categoria not in CATEGORIAS:
        return {"error": f"Categoría inválida: {categoria}"}
    _, precios, referencia = tabla_precios()
    if categoria not in referencia:
        return {"error": f"No hay precios cargados para {NOMBRE_CAT[categoria]}."}

    objetos = [o for o in (contexto.get("objetos") or [])
               if (o.get("type") or "").lower() == categoria]
    if alcance == "seleccion":
        nombres = set(contexto.get("seleccion_nombres") or [])
        objetos = [o for o in objetos if o.get("name") in nombres]
    if not objetos:
        return {"error": f"No hay {NOMBRE_CAT[categoria]} "
                         f"{'seleccionados' if alcance == 'seleccion' else 'en el plano'}."}

    m = precios.get((categoria, (material or "").lower()))
    estimado = m is None
    if estimado:
        m = referencia[categoria]
    cantidad = round(sum(_cantidad(o, m.unidad) for o in objetos), 3)
    precio = float(m.precio_unitario)
    res = {
        "categoria": NOMBRE_CAT[categoria],
        "material": material,
        "piezas": len(objetos),
        "cantidad": cantidad,
        "unidad": m.unidad,
        "precio_unitario": precio,
        "total": round(cantidad * precio, 2),
    }
    if estimado:
        res["aviso"] = (f"'{material}' no tiene precio cargado; se estimó con el de "
                        f"'{m.nombre}'. Sugiere agregarlo en Precios.")
    return res


def _costo_material(args, contexto):
    return _costo(args.get("categoria"), args.get("material"),
                  args.get("alcance") or "todas", contexto)


def _comparar(args, contexto):
    return {"comparacion": [
        _costo(args.get("categoria"), mat, "todas", contexto)
        for mat in (args.get("materiales") or [])[:8]
    ]}


def _presupuesto(args, contexto):
    r = calcular(contexto.get("objetos") or [])
    return {
        "total": r["total_estimado"],
        "por_categoria": {NOMBRE_CAT.get(k, k): v for k, v in r["totales_por_categoria"].items()},
        "detalle": [
            {k: f[k] for k in ("categoria", "material", "piezas", "cantidad", "unidad",
                               "precio_unitario", "subtotal", "estimado")}
            for f in r["detalle"]
        ],
        "avisos": r["materiales_no_encontrados"],
    }


_EJECUTORES = {
    "listar_precios": _listar_precios,
    "costo_material": _costo_material,
    "comparar_materiales": _comparar,
    "presupuesto_actual": _presupuesto,
}


def ejecutar_servidor(nombre, args, contexto):
    try:
        return _EJECUTORES[nombre](args or {}, contexto or {})
    except Exception as exc:  # el agente recibe el error y puede corregirse
        return {"error": f"No se pudo ejecutar {nombre}: {exc}"}
