from django.db import models


class DeviceToken(models.Model):
    """Token FCM de una instalacion movil vinculada a un usuario."""

    PLATFORM_CHOICES = (
        ('android', 'Android'),
        ('ios', 'iOS'),
    )

    # Se guarda el id para no acoplar esta app a la app users sin migraciones.
    user_id = models.PositiveIntegerField(db_index=True)
    token = models.CharField(max_length=512, unique=True)
    platform = models.CharField(max_length=10, choices=PLATFORM_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return '{} device for user {}'.format(self.platform, self.user_id)
