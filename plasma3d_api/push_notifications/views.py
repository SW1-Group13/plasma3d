from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import DeviceToken
from .serializers import DeviceTokenSerializer


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def register_device(request):
    serializer = DeviceTokenSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    DeviceToken.objects.update_or_create(
        token=serializer.validated_data['token'],
        defaults={
            'user_id': request.user.id,
            'platform': serializer.validated_data['platform'],
        },
    )
    return Response({'registered': True}, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def unregister_device(request):
    serializer = DeviceTokenSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    DeviceToken.objects.filter(
        user_id=request.user.id,
        token=serializer.validated_data['token'],
    ).delete()
    return Response(status=status.HTTP_204_NO_CONTENT)
