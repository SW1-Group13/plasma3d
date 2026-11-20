"""
Pagos de planes con Stripe (PaymentIntents).

Flujo:
    1. POST payment/create-intent/  -> crea el PaymentIntent (monto fijado
       en el servidor) y un Pago 'pendiente'; devuelve el client_secret.
    2. El navegador confirma la tarjeta directamente con Stripe
       (stripe.confirmCardPayment): los datos de la tarjeta nunca pasan
       por este backend.
    3. POST payment/confirm/  -> se consulta el PaymentIntent en Stripe y,
       si esta 'succeeded', se registra el pago y se activa el plan.
    (Opcional) POST payment/webhook/ hace lo mismo desde Stripe.
"""
import hashlib
import json
import os
import time
from datetime import date, timedelta
from decimal import Decimal

import requests
import stripe
from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Pago, Usuario
from .serializers import PagoSerializer, UsuarioSerializer


stripe.api_key = os.getenv("STRIPE_API_KEY")

MONEDA = 'usd'
DIAS_PLAN = 30

# Cache del chequeo pk/sk (evita crear un intent en cada carga de la pagina).
_KEYS_CHECK = {'signature': None, 'at': 0.0, 'result': None}
_KEYS_CHECK_TTL = 300

# Precio de cada plan de pago, en centavos. El monto SIEMPRE se toma de aqui,
# nunca del cliente.
PRECIOS_PLANES = {
    'usuario_premium': 4000,  # $40.00
}


def _stripe_configurado():
    return bool(stripe.api_key)


def _stripe_keys_match():
    """
    Comprueba que la publishable key pertenezca a la cuenta de la secret key.

    Stripe.js falla con "No such payment_intent" cuando las claves son de
    cuentas distintas. Se verifica leyendo un PaymentIntent de prueba con la
    publishable key + client_secret y se cachea el resultado unos minutos.

    Returns:
        True/False, o None si no se pudo comprobar (red/API).
    """
    publishable = os.getenv('STRIPE_PUBLISHABLE_KEY', '')
    secret = os.getenv('STRIPE_API_KEY', '')
    if not publishable or not secret:
        return False

    signature = hashlib.sha256(
        (publishable + secret).encode('utf-8')
    ).hexdigest()
    now = time.time()
    if (
        _KEYS_CHECK['signature'] == signature
        and now - _KEYS_CHECK['at'] < _KEYS_CHECK_TTL
    ):
        return _KEYS_CHECK['result']

    result = None
    try:
        intent = stripe.PaymentIntent.create(
            amount=50,
            currency=MONEDA,
            payment_method_types=['card'],
        )
        try:
            response = requests.get(
                'https://api.stripe.com/v1/payment_intents/{}'.format(
                    intent.id
                ),
                params={
                    'key': publishable,
                    'client_secret': intent.client_secret,
                },
                timeout=10,
            )
            result = response.status_code == 200
        finally:
            try:
                stripe.PaymentIntent.cancel(intent.id)
            except Exception:
                pass
    except Exception:
        result = None

    _KEYS_CHECK.update(signature=signature, at=now, result=result)
    return result


def _error(message, code):
    return Response({'success': False, 'message': message}, status=code)


def activar_premium(usuario):
    """Pasa el usuario a Premium y suma DIAS_PLAN dias a su plan vigente."""
    hoy = date.today()
    base = usuario.fecha_expiracion_plan
    if usuario.rol != 'usuario_premium' or base is None or base < hoy:
        base = hoy
    usuario.fecha_expiracion_plan = base + timedelta(days=DIAS_PLAN)
    usuario.rol = 'usuario_premium'
    usuario.save(update_fields=['rol', 'fecha_expiracion_plan'])


def _datos_tarjeta(intent):
    """Marca y ultimos 4 digitos de la tarjeta usada (si Stripe los da)."""
    pm = intent.get('payment_method')
    if isinstance(pm, str):
        try:
            pm = stripe.PaymentMethod.retrieve(pm)
        except stripe.error.StripeError:
            return '', ''
    card = (pm or {}).get('card') or {}
    return card.get('brand') or '', card.get('last4') or ''


def registrar_resultado(intent):
    """
    Aplica el estado de un PaymentIntent de Stripe a su Pago.

    Es idempotente: si el pago ya estaba 'exitoso' no vuelve a sumar dias
    (puede llamarse desde confirm y desde el webhook).

    Returns:
        El Pago actualizado, o None si no existe un Pago para ese intent.
    """
    with transaction.atomic():
        pago = (
            Pago.objects.select_for_update()
            .select_related('usuario')
            .filter(stripe_payment_intent_id=intent['id'])
            .first()
        )
        if pago is None or pago.estado == 'exitoso':
            return pago

        estado_stripe = intent.get('status')
        monto_ok = (
            intent.get('amount') == int(pago.monto * 100)
            and intent.get('currency') == pago.moneda
        )

        if estado_stripe == 'succeeded' and monto_ok:
            pago.marca_tarjeta, pago.ultimos4 = _datos_tarjeta(intent)
            pago.estado = 'exitoso'
            pago.fecha_pago = timezone.now()
            pago.save()
            activar_premium(pago.usuario)
        elif estado_stripe in ('canceled', 'requires_payment_method') or (
            estado_stripe == 'succeeded' and not monto_ok
        ):
            pago.estado = 'fallido'
            pago.save(update_fields=['estado'])
        return pago


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_payment_intent(request):
    """Crea el PaymentIntent del plan elegido y registra el Pago pendiente."""
    if not _stripe_configurado():
        return _error(
            'La pasarela de pago no esta configurada.',
            status.HTTP_503_SERVICE_UNAVAILABLE
        )

    plan = request.data.get('plan')
    centavos = PRECIOS_PLANES.get(plan)
    if centavos is None:
        return _error('Plan no valido.', status.HTTP_400_BAD_REQUEST)

    user = request.user
    try:
        intent = stripe.PaymentIntent.create(
            amount=centavos,
            currency=MONEDA,
            # Stripe administra los métodos de pago desde el Dashboard.
            # payment_method_types=['card'],  # Ya no es compatible con la API configurada.
            description='Plasma3D - {}'.format(plan),
            receipt_email=user.email or None,
            metadata={'usuario_id': str(user.id), 'plan': plan},
        )
    except stripe.error.StripeError as e:
        return _error(
            e.user_message or 'No se pudo iniciar el pago.',
            status.HTTP_502_BAD_GATEWAY
        )

    Pago.objects.create(
        usuario=user,
        plan=plan,
        monto=Decimal(centavos) / 100,
        moneda=MONEDA,
        stripe_payment_intent_id=intent['id'],
    )

    return Response(
        {
            'client_secret': intent['client_secret'],
            'payment_intent_id': intent['id'],
            'monto': centavos / 100,
            'moneda': MONEDA,
        },
        status=status.HTTP_201_CREATED
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def confirm_payment(request):
    """
    Verifica en Stripe el PaymentIntent y, si se cobro, registra el pago
    y activa el plan del usuario.
    """
    if not _stripe_configurado():
        return _error(
            'La pasarela de pago no esta configurada.',
            status.HTTP_503_SERVICE_UNAVAILABLE
        )

    intent_id = request.data.get('payment_intent_id')
    if not intent_id:
        return _error('Falta payment_intent_id.', status.HTTP_400_BAD_REQUEST)

    pago = Pago.objects.filter(stripe_payment_intent_id=intent_id).first()
    if pago is None:
        return _error('Pago no encontrado.', status.HTTP_404_NOT_FOUND)
    if pago.usuario_id != request.user.id:
        return _error(
            'Este pago no pertenece al usuario.',
            status.HTTP_403_FORBIDDEN
        )

    try:
        intent = stripe.PaymentIntent.retrieve(
            intent_id, expand=['payment_method']
        )
    except stripe.error.StripeError as e:
        return _error(
            e.user_message or 'No se pudo verificar el pago.',
            status.HTTP_502_BAD_GATEWAY
        )

    if (intent.get('metadata') or {}).get('usuario_id') != str(request.user.id):
        return _error(
            'Este pago no pertenece al usuario.',
            status.HTTP_403_FORBIDDEN
        )

    pago = registrar_resultado(intent)
    usuario = Usuario.objects.get(pk=request.user.id)

    if pago.estado != 'exitoso':
        return Response(
            {
                'success': False,
                'message': 'El pago no se completo (estado: {}).'.format(
                    intent.get('status')
                ),
                'pago': PagoSerializer(pago).data,
            },
            status=status.HTTP_402_PAYMENT_REQUIRED
        )

    return Response(
        {
            'success': True,
            'message': 'Pago registrado. Tu plan Premium esta activo.',
            'usuario': UsuarioSerializer(usuario).data,
            'pago': PagoSerializer(pago).data,
        },
        status=status.HTTP_200_OK
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def payment_history(request):
    """Historial de pagos del usuario autenticado."""
    pagos = Pago.objects.filter(usuario_id=request.user.id)
    return Response(PagoSerializer(pagos, many=True).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def downgrade_plan(request):
    """Vuelve al plan Normal (gratis, no pasa por Stripe)."""
    usuario = Usuario.objects.get(pk=request.user.id)
    usuario.rol = 'usuario_normal'
    usuario.fecha_expiracion_plan = None
    usuario.save(update_fields=['rol', 'fecha_expiracion_plan'])
    return Response(
        {
            'success': True,
            'message': 'Ahora tienes el plan Normal.',
            'usuario': UsuarioSerializer(usuario).data,
        },
        status=status.HTTP_200_OK
    )


@csrf_exempt
@require_POST
def stripe_webhook(request):
    """
    Webhook de Stripe (opcional): registra el pago aunque el usuario cierre
    la pestaña antes de llamar a confirm. Requiere STRIPE_WEBHOOK_SECRET.
    """
    secret = os.getenv('STRIPE_WEBHOOK_SECRET')
    if not secret:
        return HttpResponse(status=503)

    try:
        event = stripe.Webhook.construct_event(
            request.body,
            request.META.get('HTTP_STRIPE_SIGNATURE', ''),
            secret
        )
    except (ValueError, stripe.error.SignatureVerificationError):
        return HttpResponse(status=400)

    if event['type'] in (
        'payment_intent.succeeded',
        'payment_intent.payment_failed',
        'payment_intent.canceled',
    ):
        registrar_resultado(event['data']['object'])

    return HttpResponse(json.dumps({'received': True}), status=200)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def payment_config(request):
    """
    Configuracion publica de pagos.

    Expone SOLO la publishable key. La secret key (STRIPE_API_KEY) permanece
    en el backend y nunca se envia al frontend.
    """
    publishable = os.getenv('STRIPE_PUBLISHABLE_KEY', '')
    keys_match = _stripe_keys_match()
    warning = None
    if keys_match is False:
        warning = (
            'La publishable key no corresponde a la cuenta de la secret key. '
            'Copia ambas claves del mismo Dashboard de Stripe '
            '(Developers > API keys).'
        )
    return Response(
        {
            'publishable_key': publishable,
            'enabled': (
                bool(publishable)
                and _stripe_configurado()
                and keys_match is not False
            ),
            'keys_match': keys_match,
            'warning': warning,
            'precios': {
                plan: centavos / 100
                for plan, centavos in PRECIOS_PLANES.items()
            },
            'moneda': MONEDA,
        },
        status=status.HTTP_200_OK,
    )
