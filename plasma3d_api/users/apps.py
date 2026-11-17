from django.apps import AppConfig


class UsersConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'users'

    def ready(self):
        """Asegura el administrador por defecto despues de migrar."""
        from django.db.models.signals import post_migrate

        from .defaults import ensure_default_admin

        def _ensure(sender, **kwargs):
            try:
                ensure_default_admin()
            except Exception as exc:  # nunca romper las migraciones
                import logging

                logging.getLogger(__name__).warning(
                    'No se pudo asegurar el administrador por defecto: %s',
                    exc,
                )

        post_migrate.connect(
            _ensure,
            sender=self,
            dispatch_uid='users.ensure_default_admin',
        )
