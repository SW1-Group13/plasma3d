"""Datos por defecto del catalogo (capas y materiales)."""

DEFAULT_LAYERS = [
    {
        'nombre': 'Paredes',
        'color': '#ffffff',
        'grosor_linea': 0.30,
        'tipo_linea': 'continuous',
        'descripcion': 'Muros y tabiques',
        'orden': 0,
    },
    {
        'nombre': 'Puertas',
        'color': '#8a5a2b',
        'grosor_linea': 0.25,
        'tipo_linea': 'continuous',
        'descripcion': 'Vanos de puerta',
        'orden': 1,
    },
    {
        'nombre': 'Ventanas',
        'color': '#9aa3af',
        'grosor_linea': 0.25,
        'tipo_linea': 'continuous',
        'descripcion': 'Vanos de ventana',
        'orden': 2,
    },
    {
        'nombre': 'Pisos',
        'color': '#d6d3cc',
        'grosor_linea': 0.15,
        'tipo_linea': 'continuous',
        'descripcion': 'Losa de piso',
        'orden': 3,
    },
    {
        'nombre': 'Techos',
        'color': '#b5623c',
        'grosor_linea': 0.15,
        'tipo_linea': 'continuous',
        'descripcion': 'Cubierta / techo',
        'orden': 4,
    },
]

# Agregados despues de la primera version: se crean tambien en bases de
# datos que ya tenian capas/materiales.
ADDED_LAYERS = ('Pisos', 'Techos')
ADDED_MATERIALS = ('Ceramica piso',)

DEFAULT_MATERIALS = [
    {'nombre': 'Ladrillo rojo', 'categoria': 'Mampostería', 'textura_path': '/static/textures/ladrillo.jpg', 'color_difuso': '#A0522D'},
    {'nombre': 'Ladrillo blanco', 'categoria': 'Mampostería', 'color_difuso': '#E7E3DA'},
    {'nombre': 'Bloque hormigón', 'categoria': 'Mampostería', 'textura_path': '/static/textures/concreto.png', 'color_difuso': '#B7B7B0'},
    {'nombre': 'Piedra natural', 'categoria': 'Mampostería', 'textura_path': '/static/textures/piedra.jpg', 'color_difuso': '#9C9689'},
    {'nombre': 'Yeso blanco', 'categoria': 'Revestimiento', 'color_difuso': '#F3F1EC', 'rugosidad': 0.95},
    {'nombre': 'Estuco', 'categoria': 'Revestimiento', 'color_difuso': '#E4DCCB'},
    {'nombre': 'Cemento', 'categoria': 'Revestimiento', 'textura_path': '/static/textures/concreto.png', 'color_difuso': '#C9C9C4'},
    {'nombre': 'Ceramica piso', 'categoria': 'Piso', 'textura_path': '/static/textures/textura_suelo.jpg', 'color_difuso': '#D6D3CC', 'rugosidad': 0.6},
    {'nombre': 'Roble', 'categoria': 'Madera', 'textura_path': '/static/textures/madera-lisa.jpg', 'color_difuso': '#B98A54'},
    {'nombre': 'Pino', 'categoria': 'Madera', 'textura_path': '/static/textures/puerta-madera.jpg', 'color_difuso': '#C9A06A'},
    {'nombre': 'Nogal', 'categoria': 'Madera', 'textura_path': '/static/textures/tablas-desgastadas.jpg', 'color_difuso': '#5C4033'},
    {'nombre': 'Barniz', 'categoria': 'Madera', 'color_difuso': '#8B5A2B', 'rugosidad': 0.35},
    {'nombre': 'Vidrio transparente', 'categoria': 'Vidrio', 'textura_path': '/static/textures/hielo.jpg', 'color_difuso': '#CFE8F5', 'opacidad': 0.25, 'rugosidad': 0.05},
    {'nombre': 'Vidrio esmerilado', 'categoria': 'Vidrio', 'textura_path': '/static/textures/hielo.jpg', 'color_difuso': '#D8E4E8', 'opacidad': 0.5, 'rugosidad': 0.4},
    {'nombre': 'Vidrio templado azulado', 'categoria': 'Vidrio', 'textura_path': '/static/textures/hielo.jpg', 'color_difuso': '#9CC3D9', 'opacidad': 0.3, 'rugosidad': 0.1},
    {'nombre': 'Aluminio', 'categoria': 'Metal', 'color_difuso': '#C0C4C8', 'metalico': 0.9, 'rugosidad': 0.3, 'reflectividad': 0.8},
    {'nombre': 'Acero', 'categoria': 'Metal', 'color_difuso': '#8A8F94', 'metalico': 0.95, 'rugosidad': 0.25, 'reflectividad': 0.85},
    {'nombre': 'Hierro forjado', 'categoria': 'Metal', 'color_difuso': '#4A4A4A', 'metalico': 0.85, 'rugosidad': 0.5, 'reflectividad': 0.6},
    {'nombre': 'Blanca mate', 'categoria': 'Pintura', 'color_difuso': '#F2F2F0', 'rugosidad': 0.9},
    {'nombre': 'Gris perla', 'categoria': 'Pintura', 'color_difuso': '#BFBFBF'},
    {'nombre': 'Beige', 'categoria': 'Pintura', 'color_difuso': '#D9CBB3'},
    {'nombre': 'Terracota', 'categoria': 'Pintura', 'color_difuso': '#B5623C'},
]


def seed_layers(Layer):
    if Layer.objects.exists():
        for data in DEFAULT_LAYERS:
            if data['nombre'] in ADDED_LAYERS:
                Layer.objects.get_or_create(
                    nombre=data['nombre'],
                    defaults={k: v for k, v in data.items() if k != 'nombre'},
                )
        return
    for data in DEFAULT_LAYERS:
        Layer.objects.create(**data)


def seed_materials(Material):
    if Material.objects.exists():
        for data in DEFAULT_MATERIALS:
            if (data['nombre'] in ADDED_MATERIALS
                    and not Material.objects.filter(nombre=data['nombre']).exists()):
                Material.objects.create(**data)
        return
    for data in DEFAULT_MATERIALS:
        Material.objects.create(**data)
