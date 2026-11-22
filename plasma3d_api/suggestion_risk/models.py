from django.db import models


class ConfiguracionIA(models.Model):
    """Configuracion dinamica de la IA local (fila unica, id=1).

    Los campos vacios usan los valores de OLLAMA_* del entorno como fallback.
    """

    ollama_url = models.CharField(max_length=500, blank=True, default='')
    ollama_models = models.CharField(max_length=500, blank=True, default='')
    ollama_timeout = models.PositiveIntegerField(null=True, blank=True)
    actualizado = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Configuracion de IA'
        verbose_name_plural = 'Configuracion de IA'

    @classmethod
    def load(cls):
        config, _ = cls.objects.get_or_create(pk=1)
        return config

    def __str__(self):
        return 'Configuracion de IA local'


class AnalisisRiesgo(models.Model):
    """Resultado de un analisis de riesgo estructural (IA o heuristico)."""

    FUENTES = (
        ('gemini', 'Gemini IA'),
        ('heuristica', 'Reglas'),
    )

    usuario = models.ForeignKey(
        'users.Usuario',
        on_delete=models.CASCADE,
        related_name='analisis_riesgo',
        null=True,
        blank=True,
    )
    plan = models.ForeignKey(
        'plans.Plan3DJob',
        on_delete=models.CASCADE,
        related_name='analisis_riesgo',
        null=True,
        blank=True,
    )
    resultado = models.JSONField()
    nivel_riesgo = models.CharField(max_length=20, default='bajo')
    fuente = models.CharField(max_length=20, choices=FUENTES, default='heuristica')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return 'Analisis #{} ({} · {})'.format(
            self.id, self.nivel_riesgo, self.fuente
        )
