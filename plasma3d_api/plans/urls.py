# plans/urls.py
from django.urls import path
from .views import (
    create_plan3d_job, create_plan_json, create_empty_plan, get_lista_modelos,
    generate_dynamic_glb, reemplazar_glb, delete_plan, regenerar_plan,
    detect_plan, plan_detections, build_plan,
)

urlpatterns = [
    path('plans/', create_plan3d_job, name='plans-create'),
    path('plans/detect/', detect_plan, name='plans-detect'),
    path('plans/<int:pk>/detections/', plan_detections, name='plans-detections'),
    path('plans/<int:pk>/build/', build_plan, name='plans-build'),
    path('plans/empty/', create_empty_plan, name='plans-empty'),
    path('plans/<int:pk>/', delete_plan, name='plans-delete'),
    path('plans/<int:pk>/regenerar/', regenerar_plan, name='plans-regenerar'),
    path('plans_json/', create_plan_json, name='plans-json-create'),
    path('lista_modelos/', get_lista_modelos, name='lista-modelos'),
    path('generate_dynamic_glb/', generate_dynamic_glb, name='generate_dynamic_glb'),
    path('reemplazar_glb/', reemplazar_glb, name='reemplazar_glb'),
]
