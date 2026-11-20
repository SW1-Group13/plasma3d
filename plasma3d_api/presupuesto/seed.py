"""
Precios iniciales del presupuesto.

DEBE coincidir con DEFAULT_MATERIALS de
plasma3d_web/src/entities/budget/materials.ts (el frontend la usa para el botón
"Restablecer" y como respaldo). Los nombres son los del catálogo de materiales
del editor, así cada pieza encuentra el precio del material que tiene asignado.
El primero de cada categoría es el precio de referencia.
"""
from decimal import Decimal

from django.db import transaction

DEFAULT_CATEGORIAS = [
    ("wall", "Materiales para paredes"),
    ("door", "Materiales para puertas"),
    ("window", "Materiales para ventanas"),
    ("floor", "Materiales para pisos"),
    ("roof", "Materiales para techos"),
]

# (categoria, nombre, unidad, precio)
DEFAULT_PRECIOS = [
    ("wall", "Ladrillo rojo", "m2", 15),
    ("wall", "Ladrillo blanco", "m2", 17),
    ("wall", "Bloque hormigón", "m2", 12),
    ("wall", "Piedra natural", "m2", 28),
    ("wall", "Cemento", "m2", 10),
    ("wall", "Yeso blanco", "m2", 6),
    ("wall", "Estuco", "m2", 8),
    ("door", "Roble", "m2", 60),
    ("door", "Pino", "m2", 40),
    ("door", "Nogal", "m2", 75),
    ("door", "Acero", "m2", 90),
    ("door", "Aluminio", "m2", 70),
    ("window", "Vidrio transparente", "m2", 25),
    ("window", "Vidrio esmerilado", "m2", 32),
    ("window", "Vidrio templado azulado", "m2", 45),
    ("window", "Aluminio", "m2", 55),
    ("floor", "Ceramica piso", "m2", 12),
    ("floor", "Cemento", "m2", 8),
    ("floor", "Piedra natural", "m2", 30),
    ("floor", "Roble", "m2", 35),
    ("roof", "Cemento", "m2", 10),
    ("roof", "Terracota", "m2", 18),
    ("roof", "Acero", "m2", 22),
    ("roof", "Teja de arcilla", "m2", 25),
    ("roof", "Teja de concreto", "m2", 20),
    ("roof", "Teja asfáltica", "m2", 15),
    ("roof", "Lámina trapezoidal", "m2", 18),
    ("roof", "Lámina corrugada", "m2", 12),
    ("roof", "Pizarra", "m2", 45),
    ("roof", "Tejuela de madera", "m2", 30),
    ("roof", "Policarbonato", "m2", 22),
    ("roof", "Alquitrán y grava", "m2", 10),
    ("roof", "Caucho EPDM", "m2", 16),
    ("roof", "Membrana TPO", "m2", 19),
    ("roof", "Techo verde", "m2", 55),
]

# La lista vieja, exactamente como venía por defecto. Solo se borra si nadie
# la modificó (mismo nombre, unidad y precio).
LEGACY_PRECIOS = [
    ("wall", "Ladrillo", "m2", 15),
    ("wall", "Cemento", "kg", 0.5),
    ("wall", "Piedra", "kg", 0.5),
    ("door", "Madera tajibo", "m3", 50),
    ("door", "Madera ochoo", "m3", 50),
    ("door", "Madera roble", "m3", 50),
    ("window", "Vidrio simple", "m2", 20),
    ("window", "Vidrio escandinavo", "m2", 20),
]

_listo = False


def asegurar_precios(force=False):
    """
    Deja la base con precios para las 5 categorías. Idempotente:
    - crea categorías y materiales por defecto que falten,
    - nunca modifica un precio existente,
    - borra la lista vieja solo si sigue intacta.
    Corre una vez por proceso (salvo force=True).
    """
    global _listo
    if _listo and not force:
        return
    from .models import CategoriaMaterial, Material

    with transaction.atomic():
        cats = {}
        for nombre, descripcion in DEFAULT_CATEGORIAS:
            cat = CategoriaMaterial.objects.filter(nombre__iexact=nombre).first()
            if cat is None:
                cat = CategoriaMaterial.objects.create(nombre=nombre, descripcion=descripcion)
            cats[nombre] = cat

        for cat_nombre, nombre, unidad, precio in LEGACY_PRECIOS:
            Material.objects.filter(
                categoria=cats[cat_nombre],
                nombre=nombre,
                unidad=unidad,
                precio_unitario=Decimal(str(precio)),
            ).delete()

        for cat_nombre, nombre, unidad, precio in DEFAULT_PRECIOS:
            existe = Material.objects.filter(
                categoria=cats[cat_nombre], nombre__iexact=nombre
            ).exists()
            if not existe:
                Material.objects.create(
                    categoria=cats[cat_nombre],
                    nombre=nombre,
                    unidad=unidad,
                    precio_unitario=Decimal(str(precio)),
                )
    _listo = True
