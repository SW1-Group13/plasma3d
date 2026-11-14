from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import Material, CategoriaMaterial
from .seed import asegurar_precios


# Unidades de precio soportadas -> qué medida de la pieza se cobra
UNIDADES = {
    "m2": "area",       # superficie (cara del muro, vano, losa, techo)
    "m3": "volume",     # volumen
    "ml": "length",     # metro lineal (largo)
    "u": "unit",        # por pieza
}


def _f(obj, key, default=0.0):
    try:
        return float(obj.get(key) or default)
    except (TypeError, ValueError):
        return default


def _cantidad(obj, unidad):
    """
    Cantidad a cobrar de una pieza según la unidad del precio.

    Usa las medidas reales que envía el editor (length/height/thickness/area/
    volume, en ejes locales). Si faltan (cliente viejo), las estima con la
    caja width/height/depth como antes.
    """
    tipo = obj.get("type")
    w, h, d = _f(obj, "width"), _f(obj, "height"), _f(obj, "depth")
    length = _f(obj, "length") or max(w, d)
    height = _f(obj, "height")
    thickness = _f(obj, "thickness") or min(w, d)

    area = _f(obj, "area")
    if not area:
        area = w * d if tipo in ("floor", "roof") else length * height
    volume = _f(obj, "volume")
    if not volume:
        volume = area * thickness if tipo not in ("floor", "roof") else area * h

    medida = UNIDADES.get((unidad or "").lower(), "area")
    if medida == "unit":
        return 1.0
    return {"area": area, "volume": volume, "length": length}[medida]


@api_view(['GET'])
def listar_materiales(request):
    """Precios guardados: [{categoria, nombre, unidad, precio_unitario}]."""
    asegurar_precios()
    data = [
        {
            "categoria": m.categoria.nombre if m.categoria else "",
            "nombre": m.nombre,
            "unidad": m.unidad,
            "precio_unitario": float(m.precio_unitario),
        }
        for m in Material.objects.select_related("categoria").order_by("categoria__nombre", "id")
    ]
    return Response(data)


def tabla_precios():
    """
    Precios cargados: (categorias, precios[(cat, material)], referencia[cat]).
    La referencia es el primer material de cada categoría (por id).
    """
    asegurar_precios()
    categorias = {
        c.nombre.lower(): c for c in CategoriaMaterial.objects.all()
    }
    precios = {}
    referencia = {}
    for m in Material.objects.select_related("categoria").order_by("id"):
        if not m.categoria:
            continue
        cat = m.categoria.nombre.lower()
        precios[(cat, m.nombre.lower())] = m
        referencia.setdefault(cat, m)
    return categorias, precios, referencia


@api_view(['POST'])
def calcular_presupuesto(request):
    """
    Presupuesto del modelo, agrupado por (categoría, material).

    - La cantidad depende de la unidad del precio (m2, m3, ml, u).
    - Si el material de una pieza no tiene precio en su categoría, se usa el
      precio de referencia de la categoría (el primero cargado) y la fila
      queda marcada como `estimado`.
    """
    try:
        return Response(
            calcular(request.data.get("objects", [])), status=status.HTTP_200_OK
        )
    except Exception as e:
        return Response(
            {"error": str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


def calcular(objetos):
    """Cálculo del presupuesto (lo usan la vista y el Agente IA)."""
    categorias, precios, referencia = tabla_precios()

    filas = {}
    sin_precio = {}
    sin_categoria = {}

    for obj in objetos:
        tipo = (obj.get("type") or "").lower()
        nombre = ((obj.get("material") or {}).get("name") or "Sin material").strip()

        if tipo not in categorias or tipo not in referencia:
            sin_categoria[tipo] = sin_categoria.get(tipo, 0) + 1
            continue

        material = precios.get((tipo, nombre.lower()))
        estimado = material is None
        if estimado:
            material = referencia[tipo]
            clave_sp = (tipo, nombre)
            sin_precio[clave_sp] = sin_precio.get(clave_sp, 0) + 1

        clave = (tipo, nombre.lower(), estimado)
        fila = filas.get(clave)
        if fila is None:
            fila = filas[clave] = {
                "categoria": tipo,
                "material": nombre if estimado else material.nombre,
                "piezas": 0,
                "cantidad": 0.0,
                "unidad": material.unidad,
                "precio_unitario": float(material.precio_unitario),
                "subtotal": 0.0,
                "estimado": estimado,
                "precio_de": material.nombre if estimado else None,
            }
        fila["piezas"] += 1
        fila["cantidad"] += _cantidad(obj, material.unidad)

    detalle = []
    totales = {}
    for fila in filas.values():
        fila["cantidad"] = round(fila["cantidad"], 3)
        fila["subtotal"] = round(fila["cantidad"] * fila["precio_unitario"], 2)
        totales[fila["categoria"]] = round(
            totales.get(fila["categoria"], 0.0) + fila["subtotal"], 2
        )
        detalle.append(fila)

    orden = ["wall", "door", "window", "floor", "roof"]
    detalle.sort(key=lambda f: (
        orden.index(f["categoria"]) if f["categoria"] in orden else 99,
        -f["subtotal"],
    ))

    no_encontrados = [
        f"{nombre} ({tipo}) · {n} pieza{'s' if n != 1 else ''}"
        for (tipo, nombre), n in sin_precio.items()
    ] + [
        f"Sin precios cargados para '{tipo}' ({n} pieza{'s' if n != 1 else ''}): "
        f"cárgalos en Precios"
        for tipo, n in sin_categoria.items()
    ]

    return {
        "total_estimado": round(sum(totales.values()), 2),
        "totales_por_categoria": totales,
        "categorias_sin_precio": sorted(t for t in sin_categoria if t),
        "detalle": detalle,
        "materiales_no_encontrados": no_encontrados,
    }


@api_view(['POST'])
def cargar_materiales(request):
    """
    Carga o actualiza categorías y materiales.
    Si el material o categoría ya existe, se actualiza el precio.
    """
    data = request.data
    categorias_data = data.get("categorias", [])
    materiales_data = data.get("materiales", [])

    categorias_creadas = []
    materiales_creados = []
    categorias_actualizadas = []
    materiales_actualizados = []

    # Cargar o actualizar categorías
    for cat in categorias_data:
        nombre = cat.get("nombre")
        descripcion = cat.get("descripcion", "")
        categoria, creada = CategoriaMaterial.objects.update_or_create(
            nombre__iexact=nombre,
            defaults={
                "nombre": nombre,
                "descripcion": descripcion
            }
        )
        if creada:
            categorias_creadas.append(nombre)
        else:
            categorias_actualizadas.append(nombre)

    # Cargar o actualizar materiales
    conservar = set()
    for mat in materiales_data:
        cat_nombre = mat.get("categoria")
        try:
            categoria = CategoriaMaterial.objects.get(
                nombre__iexact=cat_nombre
            )
        except CategoriaMaterial.DoesNotExist:
            continue

        material, creado = Material.objects.update_or_create(
            nombre__iexact=mat.get("nombre"),
            categoria=categoria,
            defaults={
                "nombre": mat.get("nombre"),
                "unidad": mat.get("unidad"),
                "precio_unitario": mat.get("precio_unitario")
            }
        )
        if creado:
            materiales_creados.append(mat.get("nombre"))
        else:
            materiales_actualizados.append(mat.get("nombre"))
        conservar.add(material.pk)

    # reemplazar=true: la lista enviada es la lista completa de esas
    # categorías; se borran los materiales viejos que ya no figuran.
    materiales_eliminados = []
    if str(data.get("reemplazar", "")).lower() in ("true", "1"):
        nombres_cat = [c.get("nombre") for c in categorias_data if c.get("nombre")]
        sobrantes = Material.objects.filter(
            categoria__nombre__in=nombres_cat
        ).exclude(pk__in=conservar)
        materiales_eliminados = list(sobrantes.values_list("nombre", flat=True))
        sobrantes.delete()

    return Response({
        "materiales_eliminados": materiales_eliminados,
        "categorias_creadas": categorias_creadas,
        "categorias_actualizadas": categorias_actualizadas,
        "materiales_creados": materiales_creados,
        "materiales_actualizados": materiales_actualizados
    })
