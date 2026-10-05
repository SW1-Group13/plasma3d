from rest_framework.routers import DefaultRouter

from catalog.views import LayerViewSet, MaterialViewSet

router = DefaultRouter()
router.register(r'layers', LayerViewSet, basename='layer')
router.register(r'materials', MaterialViewSet, basename='material')

urlpatterns = router.urls
