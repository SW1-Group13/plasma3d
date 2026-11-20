"""Proveedores de IA compatibles con la API de OpenAI (Gemini / DeepSeek / Ollama).

- El proveedor lo elige el usuario en el chat; no hay proveedor por entorno.
- Permite listas de modelos separadas por comas y rota entre ellos si uno falla.
- Convierte las herramientas del agente al formato OpenAI (function calling).
- Si llega una imagen, solo se usa el proveedor elegido si admite visión.
"""
import json
import time

import requests
from django.conf import settings

from .agent_tools import DECLARACIONES


class AIProviderError(Exception):
    """No se pudo obtener respuesta de ningun proveedor/modelo."""


_TIPOS = {
    'OBJECT': 'object',
    'ARRAY': 'array',
    'STRING': 'string',
    'NUMBER': 'number',
    'INTEGER': 'integer',
    'BOOLEAN': 'boolean',
}


def _split_models(value):
    return [m.strip() for m in (value or '').split(',') if m.strip()]


def _modelos(value, fallbacks):
    """Modelos configurados + alternativas validas al final."""
    models = _split_models(value)
    for fallback in fallbacks:
        if fallback not in models:
            models.append(fallback)
    return models


def _schema_openai(value):
    """Convierte el esquema OpenAPI del agente (tipos en mayusculas) a JSON Schema."""
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            if key == 'type' and isinstance(item, str):
                out[key] = _TIPOS.get(item.upper(), item.lower())
            elif key == 'properties' and isinstance(item, dict):
                out[key] = {
                    prop: _schema_openai(sub)
                    for prop, sub in item.items()
                }
            elif key == 'items':
                out[key] = _schema_openai(item)
            else:
                out[key] = item
        return out
    if isinstance(value, list):
        return [_schema_openai(item) for item in value]
    return value


def _tools_openai(exclude=None):
    """Herramientas en formato OpenAI (sin las de `exclude`, para modelos chicos)."""
    exclude = set(exclude or ())
    return [
        {
            'type': 'function',
            'function': {
                'name': tool['name'],
                'description': tool.get('description', ''),
                'parameters': _schema_openai(
                    tool.get('parameters') or {'type': 'object', 'properties': {}}
                ),
            },
        }
        for tool in DECLARACIONES
        if tool['name'] not in exclude
    ]


def _configs():
    return {
        'gemini': {
            'name': 'gemini',
            'api_key': getattr(settings, 'GEMINI_API_KEY', '') or '',
            'base': (
                getattr(settings, 'GEMINI_BASE_URL', '')
                or 'https://generativelanguage.googleapis.com/v1beta/openai'
            ).rstrip('/'),
            'models': _modelos(
                getattr(settings, 'GEMINI_MODELS', ''),
                [
                    'gemini-3.5-flash',
                    'gemini-3.7-flash',
                    'gemini-3.8-flash',
                ],
            ),
        },
        'deepseek': {
            'name': 'deepseek',
            'api_key': getattr(settings, 'DEEPSEEK_API_KEY', '') or '',
            'base': (
                getattr(settings, 'DEEPSEEK_BASE_URL', '')
                or 'https://api.deepseek.com'
            ).rstrip('/'),
            'models': _modelos(
                getattr(settings, 'DEEPSEEK_MODELS', ''),
                ['deepseek-chat'],
            ),
        },
        # IA local: Ollama expone la misma API de OpenAI en /v1 (mismas
        # herramientas y mismo agente que Gemini). No pide API key real.
        'ollama': {
            'name': 'ollama',
            'api_key': 'ollama' if _ollama_base() else '',
            'base': _ollama_base(),
            'models': _split_models(getattr(settings, 'OLLAMA_MODELS', '') or 'qwen2.5:3b'),
            'timeout': int(getattr(settings, 'OLLAMA_TIMEOUT', 240) or 240),
        },
    }


def _ollama_base():
    """OLLAMA_URL + /v1 (acepta la URL con o sin /v1)."""
    url = (getattr(settings, 'OLLAMA_URL', '') or '').strip().rstrip('/')
    if not url:
        return ''
    return url if url.endswith('/v1') else url + '/v1'


PROVIDER_LABELS = {'gemini': 'Gemini', 'deepseek': 'DeepSeek', 'ollama': 'Ollama (local)'}
# Proveedores que aceptan imágenes en /chat/completions.
VISION_PROVIDERS = {'gemini', 'deepseek'}


def available_providers():
    """Proveedores con API key configurada: [{id, label, vision}]."""
    return [
        {
            'id': name,
            'label': PROVIDER_LABELS.get(name, name),
            'vision': name in VISION_PROVIDERS,
        }
        for name, cfg in _configs().items()
        if cfg['api_key'] and cfg['models']
    ]


def provider_config(name):
    """Configuración de un proveedor por id, tenga o no clave configurada."""
    return _configs().get((name or '').strip().lower())


def _provider_available(provider):
    return bool(
        provider
        and provider.get('api_key')
        and provider.get('models')
    )


def choose_providers(has_image=False, preferido=None):
    """Devuelve SOLO el proveedor seleccionado por el usuario.

    - `preferido`: id elegido en el chat ('gemini', 'deepseek' u 'ollama').
    - Sin selección, usa el primer proveedor configurado (para clientes viejos).
    - No lee AI_PROVIDER ni cambia a otro proveedor si el elegido falla.
    - Con imagen, exige que el proveedor elegido tenga visión.
    """
    preferido = (preferido or '').strip().lower()
    selected = provider_config(preferido) if preferido else None
    if not _provider_available(selected):
        selected = None

    if selected is None and not preferido:
        for name in ('gemini', 'deepseek', 'ollama'):
            candidate = provider_config(name)
            if _provider_available(candidate):
                selected = candidate
                break

    if selected is None:
        return []
    if has_image and selected['name'] not in VISION_PROVIDERS:
        return []
    return [selected]


def choose_provider(has_image=False, preferido=None):
    """Proveedor seleccionado (compatibilidad)."""
    providers = choose_providers(has_image=has_image, preferido=preferido)
    if not providers:
        raise AIProviderError(
            'No hay proveedor de IA seleccionado o configurado. Configura '
            'Gemini, DeepSeek u Ollama (OLLAMA_URL).'
        )
    return providers[0]


def chat_completion(messages, provider, timeout=60, temperature=0.4, exclude_tools=None):
    """Llama a /chat/completions del proveedor, rotando entre sus modelos."""
    url = provider['base'] + '/chat/completions'
    headers = {
        'Authorization': 'Bearer {}'.format(provider['api_key']),
        'Content-Type': 'application/json',
    }
    tools = _tools_openai(exclude_tools)
    errors = []

    for model in provider['models']:
        payload = {
            'model': model,
            'messages': messages,
            'temperature': temperature,
            'max_tokens': 4096,
        }
        if tools:
            payload['tools'] = tools
            payload['tool_choice'] = 'auto'

        response = None
        for intento in range(2):
            try:
                response = requests.post(
                    url,
                    headers=headers,
                    json=payload,
                    timeout=timeout,
                )
            except requests.RequestException as exc:
                # Sin reintento en timeout: se falla rapido y se prueba el
                # siguiente modelo/proveedor.
                errors.append('{}/{}: {}'.format(provider['name'], model, exc))
                response = None
                break

            if response.status_code in (429, 500, 502, 503, 504) and intento == 0:
                time.sleep(1.5)
                continue
            break

        if response is None:
            continue

        if response.status_code != 200:
            errors.append(
                '{}/{}: {} {}'.format(
                    provider['name'], model, response.status_code,
                    response.text[:180],
                )
            )
            continue

        try:
            response.encoding = 'utf-8'  # algunos proveedores no envían charset
            data = response.json()
            message = data['choices'][0]['message']
        except (KeyError, IndexError, ValueError) as exc:
            errors.append('{}/{}: respuesta invalida ({})'.format(
                provider['name'], model, exc
            ))
            continue

        content = message.get('content')
        if isinstance(content, list):
            content = ' '.join(
                part.get('text', '')
                for part in content
                if isinstance(part, dict)
            )
        result = {
            'role': 'assistant',
            'content': content or '',
        }
        tool_calls = message.get('tool_calls') or []
        if tool_calls:
            result['tool_calls'] = tool_calls
        return result

    raise AIProviderError(
        'El agente no pudo responder con {}. {}'.format(
            provider['name'], ' | '.join(errors[-3:])
        )
    )


def _leer_stream(response, on_token):
    """
    Lee un stream SSE de /chat/completions (formato OpenAI) y arma el mensaje
    final. El texto se va entregando con on_token; los tool_calls llegan en
    pedazos por índice (nombre y argumentos) y se juntan aquí.
    """
    texto = []
    calls = {}
    for raw in response.iter_lines(decode_unicode=True):
        if not raw:
            continue
        line = raw.strip()
        if not line.startswith('data:'):
            continue
        data = line[5:].strip()
        if data == '[DONE]':
            break
        try:
            chunk = json.loads(data)
        except ValueError:
            continue
        for choice in chunk.get('choices') or []:
            delta = choice.get('delta') or {}
            piece = delta.get('content')
            if isinstance(piece, list):
                piece = ''.join(
                    p.get('text', '') for p in piece if isinstance(p, dict)
                )
            if piece:
                texto.append(piece)
                on_token(piece)
            for tc in delta.get('tool_calls') or []:
                index = tc.get('index', len(calls))
                slot = calls.setdefault(index, {
                    'id': None,
                    'type': 'function',
                    'function': {'name': '', 'arguments': ''},
                })
                if tc.get('id'):
                    slot['id'] = tc['id']
                fn = tc.get('function') or {}
                if fn.get('name'):
                    slot['function']['name'] += fn['name']
                if fn.get('arguments'):
                    slot['function']['arguments'] += fn['arguments']
                # Gemini a veces manda campos extra (thought_signature, etc.).
                for key, value in tc.items():
                    if key not in ('index', 'id', 'type', 'function'):
                        slot[key] = value
    result = {'role': 'assistant', 'content': ''.join(texto)}
    tool_calls = [
        {**calls[i], 'id': calls[i]['id'] or 'call_{}'.format(i)}
        for i in sorted(calls)
        if calls[i]['function']['name']
    ]
    if tool_calls:
        result['tool_calls'] = tool_calls
    return result


def chat_completion_stream(messages, provider, on_token, timeout=60, temperature=0.4, exclude_tools=None):
    """
    Igual que chat_completion pero con stream=True: el texto se entrega con
    on_token(fragmento) a medida que llega. Si el proveedor no soporta
    streaming, cae a la respuesta completa (y la entrega de una vez).
    """
    url = provider['base'] + '/chat/completions'
    headers = {
        'Authorization': 'Bearer {}'.format(provider['api_key']),
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
    }
    tools = _tools_openai(exclude_tools)
    errors = []

    for model in provider['models']:
        payload = {
            'model': model,
            'messages': messages,
            'temperature': temperature,
            'max_tokens': 4096,
            'stream': True,
        }
        if tools:
            payload['tools'] = tools
            payload['tool_choice'] = 'auto'
        try:
            response = requests.post(
                url, headers=headers, json=payload, timeout=timeout, stream=True,
            )
        except requests.RequestException as exc:
            errors.append('{}/{}: {}'.format(provider['name'], model, exc))
            continue
        try:
            # Ollama manda text/event-stream sin charset: requests asumiría
            # ISO-8859-1 y "á" llegaría como "Ã¡".
            response.encoding = 'utf-8'
            if response.status_code != 200:
                errors.append('{}/{}: {} {}'.format(
                    provider['name'], model, response.status_code,
                    response.text[:180],
                ))
                continue
            content_type = response.headers.get('Content-Type', '')
            if 'event-stream' not in content_type:
                # El proveedor ignoró stream=True: respuesta completa.
                try:
                    message = response.json()['choices'][0]['message']
                except (KeyError, IndexError, ValueError) as exc:
                    errors.append('{}/{}: respuesta invalida ({})'.format(
                        provider['name'], model, exc))
                    continue
                content = message.get('content') or ''
                if isinstance(content, list):
                    content = ' '.join(
                        p.get('text', '') for p in content if isinstance(p, dict)
                    )
                if content:
                    on_token(content)
                result = {'role': 'assistant', 'content': content}
                if message.get('tool_calls'):
                    result['tool_calls'] = message['tool_calls']
                return result
            try:
                return _leer_stream(response, on_token)
            except requests.RequestException as exc:
                errors.append('{}/{}: stream cortado ({})'.format(
                    provider['name'], model, exc))
                continue
        finally:
            response.close()

    raise AIProviderError(
        'El agente no pudo responder con {}. {}'.format(
            provider['name'], ' | '.join(errors[-3:])
        )
    )
