"""Serializadores para el módulo users."""
from django.contrib.auth.hashers import make_password
from rest_framework import serializers

from users.models import Pago, Usuario


# El plan solo cambia a traves de los endpoints de pago (users/pagues.py).
CAMPOS_PLAN = ('rol', 'fecha_expiracion_plan')


class UsuarioSerializer(serializers.ModelSerializer):
    """Serializador completo para el modelo Usuario."""

    class Meta:
        model = Usuario
        fields = '__all__'
        read_only_fields = CAMPOS_PLAN
        extra_kwargs = {'password': {'write_only': True}}


class RegistroSerializer(serializers.ModelSerializer):
    """Serializador para registro de nuevos usuarios."""

    class Meta:
        model = Usuario
        fields = [
            'id', 'nombre', 'email', 'password', 'rol',
            'telefono', 'fecha_registro', 'fecha_expiracion_plan', 'url'
        ]
        read_only_fields = CAMPOS_PLAN
        extra_kwargs = {'password': {'write_only': True}}

    def create(self, validated_data):
        """Crear usuario con password hasheado (siempre en plan Normal)."""
        validated_data['password'] = make_password(
            validated_data['password']
        )
        validated_data['rol'] = 'usuario_normal'
        return super().create(validated_data)


class PagoSerializer(serializers.ModelSerializer):
    """Pago registrado (sin datos sensibles de la tarjeta)."""

    class Meta:
        model = Pago
        fields = [
            'id', 'plan', 'monto', 'moneda', 'estado', 'marca_tarjeta',
            'ultimos4', 'fecha_creacion', 'fecha_pago',
            'stripe_payment_intent_id'
        ]
        read_only_fields = fields
