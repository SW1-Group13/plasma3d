"""Diagnostico de la configuracion de Stripe."""
import os

import requests
import stripe
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Comprueba que STRIPE_API_KEY y STRIPE_PUBLISHABLE_KEY sean de la misma cuenta.'

    def handle(self, *args, **options):
        secret = os.getenv('STRIPE_API_KEY') or ''
        publishable = os.getenv('STRIPE_PUBLISHABLE_KEY') or ''

        if not secret:
            raise CommandError('STRIPE_API_KEY no esta configurada.')
        if not publishable:
            raise CommandError('STRIPE_PUBLISHABLE_KEY no esta configurada.')

        stripe.api_key = secret
        account = stripe.Account.retrieve()
        self.stdout.write('Cuenta de la secret key: {}'.format(account.id))

        intent = stripe.PaymentIntent.create(
            amount=50,
            currency='usd',
            payment_method_types=['card'],
        )
        try:
            response = requests.get(
                'https://api.stripe.com/v1/payment_intents/{}'.format(intent.id),
                params={
                    'key': publishable,
                    'client_secret': intent.client_secret,
                },
                timeout=20,
            )
        finally:
            try:
                stripe.PaymentIntent.cancel(intent.id)
            except Exception:
                pass

        if response.status_code == 200:
            self.stdout.write(
                self.style.SUCCESS(
                    'OK: la publishable key y la secret key son de la misma cuenta.'
                )
            )
            return

        self.stdout.write(
            self.style.ERROR(
                'ERROR: la publishable key NO corresponde a la cuenta {}.\n'
                'Copia la "Publishable key" (pk_test_...) desde el mismo '
                'Dashboard de Stripe (Developers > API keys) que la '
                'secret key (sk_test_...).\nRespuesta de Stripe: {}'.format(
                    account.id, response.text[:300]
                )
            )
        )
