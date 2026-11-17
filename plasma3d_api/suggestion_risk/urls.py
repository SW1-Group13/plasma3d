from django.urls import path
from .views import (
    agente_chat,
    analizar_glb,
    analizar_plan_view,
    listar_analisis_plan,
)

urlpatterns = [
    path('analizar/', analizar_glb, name='analizar-glb'),
    path('agente/', agente_chat, name='agente-chat'),
    path('plans/<int:pk>/analizar/', analizar_plan_view, name='analizar-plan'),
    path('plans/<int:pk>/analisis/', listar_analisis_plan, name='analisis-plan'),
]
