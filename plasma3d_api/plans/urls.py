# plans/urls.py
from django.urls import path
from .views import create_plan3d_job, create_plan_json, create_empty_plan, get_lista_modelos, generate_dynamic_glb, reemplazar_glb, delete_plan, regenerar_plan

urlpatterns = [
    path('plans/', create_plan3d_job, name='plans-create'),
    path('plans/empty/', create_empty_plan, name='plans-empty'),
    path('plans/<int:pk>/', delete_plan, name='plans-delete'),
    path('plans/<int:pk>/regenerar/', regenerar_plan, name='plans-regenerar'),
    path('plans_json/', create_plan_json, name='plans-json-create'),
    path('lista_modelos/', get_lista_modelos, name='lista-modelos'),
    path('generate_dynamic_glb/', generate_dynamic_glb, name='generate_dynamic_glb'),
    path('reemplazar_glb/', reemplazar_glb, name='reemplazar_glb'),
]
