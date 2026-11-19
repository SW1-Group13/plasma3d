"""
Compara cómo responde el Agente IA con cada proveedor sobre un plano de ejemplo.

    python manage.py probar_agente --proveedor ollama
    python manage.py probar_agente --proveedor gemini
    python manage.py probar_agente --proveedor ollama --pregunta "¿cuántos muros tiene mi plano?"

Muestra por pregunta: tiempo, si respondió o pidió acciones (herramientas) y el texto.
Las acciones del editor NO se ejecutan (no hay editor): solo se listan.
"""
import time

from django.core.management.base import BaseCommand

from suggestion_risk.services_agente import AgenteError, responder_agente


def _muro(nombre, x1, z1, x2, z2):
    return {'nombre': nombre, 'x1': x1, 'z1': z1, 'x2': x2, 'z2': z2}


# Plano de ejemplo: casa de 8 × 6 m con un muro interior.
CONTEXTO = {
    'revision_plano': 1,
    'unidad': 'm',
    'vista': 'planta',
    'piezas': {
        'wall': {'cantidad': 5, 'area_m2': 94.5, 'largo_total_m': 34.0,
                 'materiales': {'Ladrillo rojo': 5}},
        'door': {'cantidad': 2, 'area_m2': 3.78, 'largo_total_m': 1.8, 'materiales': {'Roble': 2}},
        'window': {'cantidad': 3, 'area_m2': 4.32, 'largo_total_m': 3.6,
                   'materiales': {'Vidrio transparente': 3}},
        'floor': {'cantidad': 1, 'area_m2': 48.0, 'largo_total_m': 8.0,
                  'materiales': {'Ceramica piso': 1}},
    },
    'techo': 'no',
    'limites': {'min_x': -4, 'max_x': 4, 'min_z': -3, 'max_z': 3},
    'muros': [
        _muro('wall_external_1', -4, -3, 4, -3), _muro('wall_external_2', 4, -3, 4, 3),
        _muro('wall_external_3', 4, 3, -4, 3), _muro('wall_external_4', -4, 3, -4, -3),
        _muro('wall_internal_5', 0, -3, 0, 3),
    ],
    'puertas': [_muro('door_1', -1, 3, -0.1, 3), _muro('door_2', 0, 0.5, 0, 1.4)],
    'ventanas': [_muro('window_1', -3, -3, -1.8, -3), _muro('window_2', 1.8, -3, 3, -3),
                 _muro('window_3', 4, -0.6, 4, 0.6)],
    'seleccion': None,
    'seleccion_nombres': [],
    'materiales_catalogo': ['Ladrillo rojo', 'Piedra natural', 'Roble', 'Vidrio transparente',
                            'Ceramica piso', 'Teja de arcilla'],
    'objetos': (
        [{'type': 'wall', 'name': 'wall_external_{}'.format(i), 'material': {'name': 'Ladrillo rojo'},
          'length': 8.0 if i in (1, 3) else 6.0, 'height': 2.7, 'thickness': 0.15,
          'area': (8.0 if i in (1, 3) else 6.0) * 2.7, 'volume': 1.0} for i in range(1, 5)]
        + [{'type': 'wall', 'name': 'wall_internal_5', 'material': {'name': 'Ladrillo rojo'},
            'length': 6.0, 'height': 2.7, 'thickness': 0.12, 'area': 16.2, 'volume': 1.9}]
        + [{'type': 'door', 'name': 'door_{}'.format(i), 'material': {'name': 'Roble'},
            'length': 0.9, 'height': 2.1, 'thickness': 0.05, 'area': 1.89, 'volume': 0.1} for i in (1, 2)]
        + [{'type': 'window', 'name': 'window_{}'.format(i), 'material': {'name': 'Vidrio transparente'},
            'length': 1.2, 'height': 1.2, 'thickness': 0.05, 'area': 1.44, 'volume': 0.07} for i in (1, 2, 3)]
        + [{'type': 'floor', 'name': 'floor_1', 'material': {'name': 'Ceramica piso'},
            'length': 8.0, 'height': 0.1, 'thickness': 6.0, 'area': 48.0, 'volume': 4.8}]
    ),
}

SELECCION_MURO = {
    'id': 'abc', 'nombre': 'wall_internal_5', 'tipo': 'wall',
    'posicion_mundo_m': {'x': 0, 'z': 0}, 'material': 'Ladrillo rojo',
    'piezas_seleccionadas': 1, 'largo_m': 6.0, 'alto_m': 2.7, 'espesor_m': 0.12,
}

PREGUNTAS = [
    ('hola', False),
    ('¿cuántos muros tiene mi plano?', False),
    ('¿cuánto cuesta todo?', False),
    ('¿qué le puedo aumentar?', False),
    ('¿cuánto costaría piedra natural en los muros?', False),
    ('dibuja un muro de 3 m a la derecha del plano', False),
    ('hazlo de 4 m', True),
    ('gíralo 90 grados', True),
]


class Command(BaseCommand):
    help = 'Prueba el Agente IA con preguntas fijas sobre un plano de ejemplo.'

    def add_arguments(self, parser):
        parser.add_argument('--proveedor', default=None, help='gemini | deepseek | ollama')
        parser.add_argument('--pregunta', default=None, help='Probar solo esta pregunta')

    def handle(self, *args, **opts):
        proveedor = opts.get('proveedor')
        preguntas = [(opts['pregunta'], False)] if opts.get('pregunta') else PREGUNTAS
        for texto, con_seleccion in preguntas:
            contexto = dict(CONTEXTO)
            if con_seleccion:
                contexto['seleccion'] = SELECCION_MURO
                contexto['seleccion_nombres'] = [SELECCION_MURO['nombre']]
            self.stdout.write(self.style.MIGRATE_HEADING('\n» {}{}'.format(
                texto, '   (con un muro seleccionado)' if con_seleccion else '')))
            inicio = time.time()
            try:
                paso = responder_agente([], contexto, mensaje=texto, proveedor=proveedor)
            except AgenteError as exc:
                self.stdout.write(self.style.ERROR('  ERROR: {}'.format(exc)))
                continue
            seg = time.time() - inicio
            quien = paso.get('proveedor', '?')
            if paso['estado'] == 'acciones':
                acciones = ', '.join(
                    '{}({})'.format(a['nombre'], a.get('args')) for a in paso['acciones']
                )
                self.stdout.write('  [{} · {:.1f}s] ACCIONES: {}'.format(quien, seg, acciones))
            else:
                self.stdout.write('  [{} · {:.1f}s] {}'.format(quien, seg, paso['texto']))
