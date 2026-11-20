"""Permisos personalizados del modulo users."""
from rest_framework.permissions import BasePermission


class EsAdministrador(BasePermission):
    """Permite solo a usuarios con rol 'administrador'."""

    message = 'Se requiere rol de administrador.'

    def has_permission(self, request, view):
        user = getattr(request, 'user', None)
        return bool(user and getattr(user, 'rol', None) == 'administrador')
