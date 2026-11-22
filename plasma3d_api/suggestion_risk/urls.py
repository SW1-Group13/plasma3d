from django.urls import path
from .views import (
    agente_chat,
    agente_chat_stream,
    ai_config,
    analizar_glb,
    analizar_plan_view,
    listar_analisis_plan,
    ollama_config,
    transcribir_audio_view,
)

urlpatterns = [
    path('analizar/', analizar_glb, name='analizar-glb'),
    path('agente/', agente_chat, name='agente-chat'),
    path('agente/stream/', agente_chat_stream, name='agente-chat-stream'),
    path('config/', ai_config, name='ai-config'),
    path('config/ollama/', ollama_config, name='ollama-config'),
    path('transcribir/', transcribir_audio_view, name='transcribir-audio'),
    path('plans/<int:pk>/analizar/', analizar_plan_view, name='analizar-plan'),
    path('plans/<int:pk>/analisis/', listar_analisis_plan, name='analisis-plan'),
]
