from django.core.management.base import BaseCommand, CommandError

from users.models import Usuario


class Command(BaseCommand):
    help = 'Promueve un usuario existente a administrador (por email).'

    def add_arguments(self, parser):
        parser.add_argument('email', help='Email del usuario a promover.')

    def handle(self, *args, **options):
        email = options['email'].strip()
        try:
            usuario = Usuario.objects.get(email=email)
        except Usuario.DoesNotExist:
            raise CommandError('No existe un usuario con email {}'.format(email))

        usuario.rol = 'administrador'
        usuario.save(update_fields=['rol'])
        self.stdout.write(
            self.style.SUCCESS(
                'Usuario {} ahora es administrador.'.format(usuario.email)
            )
        )
