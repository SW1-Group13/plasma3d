from django.contrib import admin

from .models import Pago


@admin.register(Pago)
class PagoAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'usuario', 'plan', 'monto', 'moneda', 'estado',
        'marca_tarjeta', 'ultimos4', 'fecha_creacion', 'fecha_pago'
    )
    list_filter = ('estado', 'plan')
    search_fields = ('stripe_payment_intent_id', 'usuario__email')
