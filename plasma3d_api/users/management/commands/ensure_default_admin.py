from django.core.management.base import BaseCommand

from users.defaults import ensure_default_admin


class Command(BaseCommand):
    help = 'Crea/asegura el administrador por defecto desde el entorno.'

    def handle(self, *args, **options):
        usuario = ensure_default_admin()
        if usuario is None:
            self.stdout.write(
                self.style.WARNING(
                    'ADMIN_EMAIL/ADMIN_PASSWORD no configurados; '
                    'no se creo el administrador por defecto.'
                )
            )
            return
        self.stdout.write(
            self.style.SUCCESS(
                'Administrador asegurado: {} ({})'.format(
                    usuario.email, usuario.rol
                )
            )
        )
