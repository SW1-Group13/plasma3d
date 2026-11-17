"""Usuario administrador por defecto (idempotente)."""
import logging

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.utils import timezone

from .models import Usuario

logger = logging.getLogger(__name__)


def ensure_default_admin():
    """
    Crea el administrador por defecto si no existe y asegura su rol.

    - Usa ADMIN_NOMBRE, ADMIN_EMAIL y ADMIN_PASSWORD del entorno.
    - No duplica: busca por email (sin distinguir mayusculas).
    - Si ya existe, no cambia la contrasena; solo asegura el rol admin.
    """
    email = (getattr(settings, 'ADMIN_EMAIL', '') or '').strip()
    password = getattr(settings, 'ADMIN_PASSWORD', '') or ''
    nombre = (getattr(settings, 'ADMIN_NOMBRE', '') or 'Administrador').strip()

    if not email:
        return None

    usuario = Usuario.objects.filter(email__iexact=email).first()

    if usuario is None:
        if not password:
            logger.warning(
                'ADMIN_PASSWORD no configurada: no se crea el administrador %s.',
                email,
            )
            return None
        usuario = Usuario.objects.create(
            nombre=nombre,
            email=email,
            password=make_password(password),
            rol='administrador',
            fecha_registro=timezone.now(),
        )
        logger.info('Administrador por defecto creado: %s', email)
        return usuario

    fields = []
    if usuario.rol != 'administrador':
        usuario.rol = 'administrador'
        fields.append('rol')
    if not usuario.nombre:
        usuario.nombre = nombre
        fields.append('nombre')
    if fields:
        usuario.save(update_fields=fields)
        logger.info('Administrador por defecto asegurado: %s', email)
    return usuario
