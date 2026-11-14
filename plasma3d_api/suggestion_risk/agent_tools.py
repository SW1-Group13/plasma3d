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
