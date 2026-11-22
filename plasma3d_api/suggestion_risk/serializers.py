from rest_framework import serializers

from .models import ConfiguracionIA


class ConfiguracionIASerializer(serializers.ModelSerializer):
    """Configuracion editable de Ollama desde el panel administrador."""

    class Meta:
        model = ConfiguracionIA
        fields = [
            'ollama_url',
            'ollama_models',
            'ollama_timeout',
            'actualizado',
        ]
        read_only_fields = ('actualizado',)

    def validate_ollama_url(self, value):
        value = (value or '').strip().rstrip('/')
        if value and not value.startswith(('http://', 'https://')):
            raise serializers.ValidationError(
                'La URL debe comenzar con http:// o https://.'
            )
        return value

    def validate_ollama_models(self, value):
        return (value or '').strip()

    def validate_ollama_timeout(self, value):
        if value is None:
            return None
        if value < 10 or value > 3600:
            raise serializers.ValidationError(
                'El timeout debe estar entre 10 y 3600 segundos.'
            )
        return value
