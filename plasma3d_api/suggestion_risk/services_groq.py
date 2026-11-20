"""Transcripcion de audio con Groq (Whisper, API compatible con OpenAI)."""
import requests
from django.conf import settings


class GroqError(Exception):
    """No se pudo transcribir el audio."""


def transcribir_audio(archivo):
    """Transcribe un archivo de audio usando Groq y devuelve el texto."""
    api_key = getattr(settings, 'GROQ_API_KEY', '') or ''
    if not api_key:
        raise GroqError(
            'La transcripcion de audio no esta configurada '
            '(falta GROQ_API_KEY).'
        )

    modelo = getattr(settings, 'GROQ_MODEL', '') or 'whisper-large-v3'
    base = (
        getattr(settings, 'GROQ_BASE_URL', '')
        or 'https://api.groq.com/openai/v1'
    ).rstrip('/')
    idioma = getattr(settings, 'GROQ_LANGUAGE', '') or ''

    archivo.seek(0)
    data = {'model': modelo}
    if idioma:
        data['language'] = idioma

    files = {
        'file': (
            getattr(archivo, 'name', 'audio.webm'),
            archivo.read(),
            getattr(archivo, 'content_type', 'audio/webm'),
        )
    }

    try:
        response = requests.post(
            base + '/audio/transcriptions',
            headers={'Authorization': 'Bearer {}'.format(api_key)},
            data=data,
            files=files,
            timeout=120,
        )
    except requests.RequestException as exc:
        raise GroqError('No se pudo contactar a Groq: {}'.format(exc)) from exc

    if response.status_code != 200:
        raise GroqError(
            'Groq no pudo transcribir el audio ({}): {}'.format(
                response.status_code, response.text[:300]
            )
        )

    try:
        texto = (response.json() or {}).get('text', '').strip()
    except ValueError as exc:
        raise GroqError('Respuesta invalida de Groq.') from exc

    if not texto:
        raise GroqError('La transcripcion quedo vacia; intenta hablar mas claro.')
    return texto
