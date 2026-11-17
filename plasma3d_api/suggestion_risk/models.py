from django.db import models


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
