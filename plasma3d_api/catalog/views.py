from rest_framework import viewsets

from catalog.models import Layer, Material
from catalog.seed import seed_layers, seed_materials
from catalog.serializers import LayerSerializer, MaterialSerializer


class LayerViewSet(viewsets.ModelViewSet):
    queryset = Layer.objects.all()
    serializer_class = LayerSerializer

    def list(self, request, *args, **kwargs):
        seed_layers(Layer)
        return super().list(request, *args, **kwargs)


class MaterialViewSet(viewsets.ModelViewSet):
    queryset = Material.objects.all()
    serializer_class = MaterialSerializer

    def list(self, request, *args, **kwargs):
        seed_materials(Material)
        return super().list(request, *args, **kwargs)

    def perform_create(self, serializer):
        user = getattr(self.request, 'user', None)
        user_id = getattr(user, 'id', None)
        serializer.save(usuario_id=user_id)
