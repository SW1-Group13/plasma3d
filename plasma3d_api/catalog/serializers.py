from rest_framework import serializers

from catalog.models import Layer, Material


class LayerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Layer
        fields = [
            'id', 'nombre', 'color', 'visible', 'bloqueada', 'congelada',
            'grosor_linea', 'tipo_linea', 'transparencia', 'descripcion', 'orden',
        ]


class MaterialSerializer(serializers.ModelSerializer):
    textura_url = serializers.SerializerMethodField()
    escala_textura = serializers.SerializerMethodField()

    class Meta:
        model = Material
        fields = [
            'id', 'nombre', 'categoria', 'textura', 'textura_path', 'textura_url',
            'color_difuso', 'rugosidad', 'reflectividad', 'metalico', 'opacidad',
            'escala_u', 'escala_v', 'escala_textura', 'usuario',
        ]

    def get_textura_url(self, obj):
        if obj.textura:
            return obj.textura.url
        return obj.textura_path or None

    def get_escala_textura(self, obj):
        return [obj.escala_u, obj.escala_v]
