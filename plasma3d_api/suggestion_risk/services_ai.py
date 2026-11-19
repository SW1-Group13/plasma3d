"""Proveedores de IA compatibles con la API de OpenAI (Gemini / DeepSeek).

- Selecciona el proveedor segun AI_PROVIDER.
- Permite listas de modelos separadas por comas y rota entre ellos si uno falla.
- Convierte las herramientas del agente al formato OpenAI (function calling).
- Si llega una imagen, prioriza Gemini (vision) cuando hay clave configurada.
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


def _tools_openai():
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
                    'gemini-3.8-flash',
                    'gemini-3.7-flash',
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
    }


def choose_providers(has_image=False):
    """Proveedores disponibles en el orden recomendado para este turno.

    `has_image` se mantiene por compatibilidad: el proveedor siempre es el
    de AI_PROVIDER (no se cambia por la seleccion del cliente).
    """
    configs = _configs()
    selected = (getattr(settings, 'AI_PROVIDER', 'gemini') or 'gemini').strip().lower()

    order = []
    if selected in configs:
        order.append(selected)
    for name in ('gemini', 'deepseek'):
        if name not in order:
            order.append(name)

    providers = []
    for name in order:
        provider = configs[name]
        if provider['api_key'] and provider['models']:
            providers.append(provider)
    return providers


def choose_provider(has_image=False):
    """Primer proveedor disponible (compatibilidad)."""
    providers = choose_providers(has_image=has_image)
    if not providers:
        raise AIProviderError(
            'No hay proveedor de IA configurado. Define GEMINI_API_KEY o '
            'DEEPSEEK_API_KEY en el entorno.'
        )
    return providers[0]


def chat_completion(messages, provider, timeout=60):
    """Llama a /chat/completions del proveedor, rotando entre sus modelos."""
    url = provider['base'] + '/chat/completions'
    headers = {
        'Authorization': 'Bearer {}'.format(provider['api_key']),
        'Content-Type': 'application/json',
    }
    tools = _tools_openai()
    errors = []

    for model in provider['models']:
        payload = {
            'model': model,
            'messages': messages,
            'temperature': 0.4,
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
