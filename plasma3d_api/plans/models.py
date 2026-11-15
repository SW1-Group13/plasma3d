"""Modelos para el módulo plans."""
from django.conf import settings
from django.db import models


def job_dir(instance):
    """Carpeta base de un job: media/users/<user_id>/jobs/<job_id>/."""
    user = instance.usuario_id if instance.usuario_id else 'sin_usuario'
    job = instance.id if instance.id else 'nuevo'
    return 'users/{}/jobs/{}'.format(user, job)


def plan_input_path(instance, filename):
    """Archivo de entrada (plano original)."""
    return '{}/inputs/{}'.format(job_dir(instance), filename)


def plan_raster_path(instance, filename):
    """Imagen rasterizada para inferencia."""
    return '{}/rasterized/{}'.format(job_dir(instance), filename)


def plan_output_path(instance, filename):
    """Salidas generadas (detecciones JSON, modelo GLB)."""
    return '{}/outputs/{}'.format(job_dir(instance), filename)


class Plan3DJob(models.Model):
    """
    Modelo para trabajos de generación de planos 3D.

    Almacena archivos de entrada, detecciones JSON y modelos GLB generados.
    Los archivos se organizan por usuario y job:
        media/users/<usuario>/jobs/<job>/{inputs,rasterized,outputs}/
    """

    # Archivo de entrada (cualquier formato)
    plan_file = models.FileField(upload_to=plan_input_path)

    # Versión rasterizada para inferencia (opcional)
    plan_image = models.ImageField(
        upload_to=plan_raster_path,
        blank=True,
        null=True
    )

    detections_json = models.FileField(
        upload_to=plan_output_path,
        blank=True,
        null=True
    )
    glb_model = models.FileField(
        upload_to=plan_output_path,
        blank=True,
        null=True
    )

    created_at = models.DateTimeField(auto_now_add=True)
    # Informe de la detección: muros/puertas/ventanas, escala y avisos.
    calidad = models.JSONField(null=True, blank=True)
    width = models.IntegerField(default=0)
    height = models.IntegerField(default=0)

    # Usuario propietario del trabajo
    usuario = models.ForeignKey(
        'users.Usuario',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='plan3d_jobs'
    )

    def __str__(self):
        """Representación en string del modelo."""
        return f'Plan3DJob #{self.id}'
