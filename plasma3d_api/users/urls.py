from django.urls import path
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import UsuarioViewSet,RegistroView, LoginView, LogoutView, update_usuario
from .pagues import (
    confirm_payment,
    create_payment_intent,
    downgrade_plan,
    payment_config,
    payment_history,
    stripe_webhook,
)
router = DefaultRouter()
router.register(r'usuarios', UsuarioViewSet, basename='usuario')

urlpatterns = [
    path('auth/registro/', RegistroView.as_view(), name='registro'),
    path('auth/login/', LoginView.as_view(), name='login'),
    path('auth/logout/', LogoutView.as_view(), name='logout'),
    path('auth/usuario/update/<int:pk>/', update_usuario, name='usuario-update'),
    path('payment/config/', payment_config, name='payment-config'),
    path('payment/create-intent/', create_payment_intent, name='payment-create-intent'),
    path('payment/confirm/', confirm_payment, name='payment-confirm'),
    path('payment/historial/', payment_history, name='payment-history'),
    path('payment/downgrade/', downgrade_plan, name='payment-downgrade'),
    path('payment/webhook/', stripe_webhook, name='payment-webhook'),
    path('', include(router.urls)),
]
