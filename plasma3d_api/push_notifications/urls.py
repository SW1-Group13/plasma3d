from django.urls import path

from .views import register_device, unregister_device

urlpatterns = [
    path('devices/register/', register_device, name='push-device-register'),
    path('devices/unregister/', unregister_device, name='push-device-unregister'),
]
