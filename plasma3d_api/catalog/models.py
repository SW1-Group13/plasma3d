"""Modelos del catalogo del editor: capas y materiales."""
from django.db import models


def material_path(instance, filename):
    """Ruta por usuario: media/users/<usuario>/materials/<archivo>."""
    user = instance.usuario_id if instance.usuario_id else 'general'
    return 'users/{}/materials/{}'.format(user, filename)


class Layer(models.Model):
    """Capa de dibujo (equivalente a LAYER de AutoCAD)."""

    nombre = models.CharField(max_length=100, unique=True)
    color = models.CharField(max_length=9, default='#ffffff')
    visible = models.BooleanField(default=True)
    bloqueada = models.BooleanField(default=False)
    congelada = models.BooleanField(default=False)
    grosor_linea = models.FloatField(default=0.25)
    tipo_linea = models.CharField(max_length=20, default='continuous')
    transparencia = models.IntegerField(default=0)
    descripcion = models.CharField(max_length=255, blank=True, default='')
    orden = models.IntegerField(default=0)

    class Meta:
        ordering = ['orden', 'id']

    def __str__(self):
        return self.nombre


class Material(models.Model):
    """Material 3D de la biblioteca (textura + propiedades PBR)."""

    nombre = models.CharField(max_length=120)
    categoria = models.CharField(max_length=80, default='Personalizado')
    # Textura subida por el usuario (se guarda en media/users/<id>/materials/)
    textura = models.FileField(upload_to=material_path, blank=True, null=True)
    # Ruta de textura de un asset local (p. ej. /static/textures/ladrillo.jpg)
    textura_path = models.CharField(max_length=255, blank=True, default='')
    color_difuso = models.CharField(max_length=9, default='#cccccc')
    rugosidad = models.FloatField(default=0.8)
    reflectividad = models.FloatField(default=0.1)
    metalico = models.FloatField(default=0.0)
    opacidad = models.FloatField(default=1.0)
    escala_u = models.FloatField(default=1.0)
    escala_v = models.FloatField(default=1.0)
    creado = models.DateTimeField(auto_now_add=True)
    usuario = models.ForeignKey(
        'users.Usuario',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='materials',
    )

    class Meta:
        ordering = ['categoria', 'nombre']

    def __str__(self):
        return self.nombre
