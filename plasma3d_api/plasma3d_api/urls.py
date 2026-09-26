"""
URL configuration for plasma3d_api project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin

from django.urls import include, path, re_path
from django.conf import settings
from django.views.static import serve
from django.http import JsonResponse

def home(request):
    return JsonResponse({"message": "API Plasma 3D activa..... Bienvenido!"})

urlpatterns = [
    # path('admin/', admin.site.urls),
    path('', home),
    path('api/view_model/', include('view_url_3D.urls')),
    path('api/set_plan/', include('plans.urls')),
    path('api/users/', include('users.urls')),
    path('api/presupuesto/', include('presupuesto.urls')),
    path('api/suggestion_risk/', include('suggestion_risk.urls')),
]

# Servir archivos media (tambien cuando DEBUG=False, p. ej. en produccion)
urlpatterns += [
    re_path(r'^media/(?P<path>.*)$', serve, {'document_root': settings.MEDIA_ROOT}),
]
