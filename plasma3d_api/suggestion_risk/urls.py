from django.urls import path
from .views import agente_chat, analizar_glb

urlpatterns = [
    path('analizar/', analizar_glb, name='analizar-glb'),
    path('agente/', agente_chat, name='agente-chat'),
]
