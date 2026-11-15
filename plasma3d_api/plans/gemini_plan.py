# plans/gemini_plan.py
"""
Gemini como "árbitro" del plano 2D.

Los detectores de píxeles (IA + cv_walls) no leen texto y se pierden muros
dibujados muy claros o finos. Gemini mira la imagen completa y devuelve:

  - el ancho/alto total del edificio en metros (leído de las cotas), que da
    la escala real del plano;
  - los muros que ve, como segmentos en coordenadas normalizadas 0-1000.

Nada de lo que dice Gemini se usa a ciegas: un muro solo se agrega si en la
imagen hay trazo dibujado a lo largo de él (ver pipeline._ink_ratio).
Si no hay API key o la respuesta no es JSON válido, devuelve None y el
pipeline sigue igual que antes.
"""
import base64
import io
import json
import logging
import os
import re

log = logging.getLogger(__name__)

PROMPT = """Eres un experto leyendo planos arquitectónicos 2D.
Analiza la imagen del plano y responde SOLO con JSON válido (sin markdown) con esta forma:
{
  "building_width_m": number|null,
  "building_height_m": number|null,
  "walls": [{"x1": int, "y1": int, "x2": int, "y2": int}],
  "doors": [{"x1": int, "y1": int, "x2": int, "y2": int}],
  "windows": [{"x1": int, "y1": int, "x2": int, "y2": int}],
  "rooms": [{"name": string, "x": int, "y": int}]
}
Reglas:
- Coordenadas normalizadas de 0 a 1000 sobre la imagen (x a la derecha, y hacia abajo).
- "walls": TODOS los muros (exteriores e interiores/tabiques), como segmentos por el
  eje central del muro. Un muro interrumpido por una puerta o ventana se da como un solo segmento.
  Muros en diagonal (ochavas): un segmento con sus dos puntas reales.
  Muros CURVOS: aproxímalos con varios segmentos cortos consecutivos (uno cada ~0.5 m).
  No incluyas líneas de cota, grilla, textos, muebles ni la brújula.
- "building_width_m"/"building_height_m": ancho y alto TOTAL exterior del edificio en metros,
  leídos de las cotas escritas del plano (p. ej. 18.33). null si no hay cotas.
- "doors": TODA puerta o acceso, sea cual sea el símbolo: arco de giro, hueco en el muro,
  hoja dibujada, o símbolo de ENTRADA (triángulo/flecha/rectángulo negro junto a un muro).
  Da la caja del vano SOBRE el muro (el tramo de muro que ocupa la puerta), no del arco.
- "windows": ventanas (líneas finas dobles/triples dentro del muro exterior, o vidrio).
  Si no hay, lista vacía.
- "rooms": nombre de cada ambiente y la posición de su etiqueta.
"""


def _enabled():
    return os.environ.get('PLAN_GEMINI', '1') not in ('0', 'false', 'False', '')


def _parse(text):
    text = re.sub(r'```(?:json)?', '', text or '').strip()
    start, end = text.find('{'), text.rfind('}')
    if start < 0 or end <= start:
        return None
    try:
        return json.loads(text[start:end + 1])
    except ValueError:
        return None


def _num(v, lo, hi):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return v if lo <= v <= hi else None


def read_plan(image):
    """
    Pide a Gemini la lectura del plano.

    Args:
        image: PIL.Image (la misma que ven los detectores).

    Returns:
        dict {width_m, height_m, walls:[{x1,y1,x2,y2}] en PÍXELES de image,
        rooms:[{name,x,y}] en píxeles} o None si no se pudo.
    """
    if not _enabled():
        return None
    try:
        import requests
        from django.conf import settings
        from suggestion_risk.services_gemini import GEMINI_API_URL
        key = getattr(settings, 'GEMINI_API_KEY', None)
    except Exception as exc:
        log.warning('Gemini no disponible: %s', exc)
        return None
    if not key:
        return None

    buf = io.BytesIO()
    image.convert('RGB').save(buf, format='PNG')
    payload = {
        'contents': [{'role': 'user', 'parts': [
            {'text': PROMPT},
            {'inline_data': {'mime_type': 'image/png',
                             'data': base64.b64encode(buf.getvalue()).decode('ascii')}},
        ]}],
        'generationConfig': {
            'temperature': 0.0,
            'seed': 7,  # misma imagen -> misma lectura (más estable)
            'maxOutputTokens': 32768,  # el modelo "piensa" antes: sin margen corta el JSON
            'responseMimeType': 'application/json',
        },
    }
    text = None
    for _ in range(2):  # un reintento si la respuesta no es JSON
        try:
            r = requests.post(GEMINI_API_URL, params={'key': key}, json=payload, timeout=120)
            if r.status_code != 200:
                log.warning('Gemini %s: %s', r.status_code, r.text[:300])
                return None
            cand = (r.json().get('candidates') or [{}])[0]
            text = ''.join(p.get('text', '') for p in (cand.get('content') or {}).get('parts', [])
                           if not p.get('thought'))
        except Exception as exc:
            log.warning('Gemini falló: %s', exc)
            return None
        if _parse(text) is not None:
            break
    res = {'data': text}
    data = _parse(res.get('data'))
    if not isinstance(data, dict):
        return None

    W, H = image.size
    sx, sy = W / 1000.0, H / 1000.0
    walls = []
    for w in data.get('walls') or []:
        try:
            x1, y1, x2, y2 = (float(w[k]) for k in ('x1', 'y1', 'x2', 'y2'))
        except (KeyError, TypeError, ValueError):
            continue
        if not all(-5 <= v <= 1005 for v in (x1, y1, x2, y2)):
            continue
        walls.append({'x1': x1 * sx, 'y1': y1 * sy, 'x2': x2 * sx, 'y2': y2 * sy})
    def boxes(key):
        out = []
        for b in data.get(key) or []:
            try:
                x1, y1, x2, y2 = (float(b[k]) for k in ('x1', 'y1', 'x2', 'y2'))
            except (KeyError, TypeError, ValueError):
                continue
            out.append({'x1': min(x1, x2) * sx, 'y1': min(y1, y2) * sy,
                        'x2': max(x1, x2) * sx, 'y2': max(y1, y2) * sy})
        return out

    rooms = []
    for r in data.get('rooms') or []:
        try:
            rooms.append({'name': str(r['name'])[:60], 'x': float(r['x']) * sx, 'y': float(r['y']) * sy})
        except (KeyError, TypeError, ValueError):
            continue
    return {
        'width_m': _num(data.get('building_width_m'), 1.0, 500.0),
        'height_m': _num(data.get('building_height_m'), 1.0, 500.0),
        'walls': walls,
        'rooms': rooms,
        'doors': boxes('doors'),
        'windows': boxes('windows'),
    }
