"""Modelos para el módulo users."""
from django.db import models


class Usuario(models.Model):
    """Modelo de usuario con roles y suscripciones."""

    ROLES = (
        ('usuario_normal', 'Usuario Normal'),
        ('usuario_premium', 'Usuario Premium'),
    )

    nombre = models.CharField(max_length=100)
    email = models.EmailField(unique=True)
    password = models.CharField(max_length=255)
    rol = models.CharField(
        max_length=20,
        choices=ROLES,
        default='usuario_normal'
    )
    fecha_expiracion_plan = models.DateField(null=True, blank=True)
    fecha_registro = models.DateTimeField(null=True, blank=True)
    telefono = models.IntegerField(null=True, blank=True)
    url = models.CharField(max_length=255, null=True, blank=True)

    def __str__(self):
        """Representación en string del modelo."""
        return f"{self.nombre} - {self.rol}"

    @property
    def is_authenticated(self):
        """Indica si el usuario está autenticado."""
        return True

    @property
    def is_active(self):
        """Indica si el usuario está activo."""
        return True

    def get_username(self):
        """Retorna el email como nombre de usuario."""
        return self.email


class Pago(models.Model):
    """Pago de un plan registrado a traves de Stripe (PaymentIntent)."""

    ESTADOS = (
        ('pendiente', 'Pendiente'),
        ('exitoso', 'Exitoso'),
        ('fallido', 'Fallido'),
    )

    usuario = models.ForeignKey(
        Usuario,
        on_delete=models.CASCADE,
        related_name='pagos'
    )
    plan = models.CharField(max_length=20, choices=Usuario.ROLES)
    monto = models.DecimalField(max_digits=10, decimal_places=2)
    moneda = models.CharField(max_length=3, default='usd')
    stripe_payment_intent_id = models.CharField(max_length=255, unique=True)
    estado = models.CharField(
        max_length=10,
        choices=ESTADOS,
        default='pendiente'
    )
    marca_tarjeta = models.CharField(max_length=20, blank=True, default='')
    ultimos4 = models.CharField(max_length=4, blank=True, default='')
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_pago = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-fecha_creacion']

    def __str__(self):
        """Representación en string del modelo."""
        return f"Pago #{self.id} {self.usuario_id} {self.plan} {self.estado}"