
"""Vistas para el módulo users."""
import os
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db.models import Count, Max, Q, Sum
from django.utils import timezone
from rest_framework import generics, status, viewsets
from rest_framework.decorators import (
    action,
    api_view,
    parser_classes,
    permission_classes,
)
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from users.models import Pago, Usuario

from .auth import JWTAuthentication
from .permissions import EsAdministrador
from .serializers import PagoSerializer, RegistroSerializer, UsuarioSerializer


class UsuarioViewSet(viewsets.ModelViewSet):
    queryset = Usuario.objects.all()
    serializer_class = UsuarioSerializer
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def perform_create(self, serializer):
        """Hashear password antes de crear usuario."""
        password = serializer.validated_data.get("password")
        if password:
            serializer.validated_data["password"] = make_password(password)
        serializer.save()

    def perform_update(self, serializer):
        """Hashear password antes de actualizar usuario."""
        password = serializer.validated_data.get("password")
        if password:
            serializer.validated_data["password"] = make_password(password)
        serializer.save()


class RegistroView(generics.CreateAPIView):
    """Vista para registro de nuevos usuarios."""

    queryset = Usuario.objects.all()
    serializer_class = RegistroSerializer
    permission_classes = [AllowAny]

    def post(self, request, *args, **kwargs):
        """Crear nuevo usuario (siempre con rol normal)."""
        # El rol nunca se toma del cliente: evita autoasignarse administrador.
        data = request.data.copy()
        data['rol'] = 'usuario_normal'
        serializer = self.get_serializer(data=data)
        if serializer.is_valid():
            usuario = serializer.save()
            return Response(
                UsuarioSerializer(usuario).data,
                status=status.HTTP_201_CREATED
            )
        print("❌ ERRORES DE SERIALIZER:", serializer.errors)
        return Response(
            serializer.errors,
            status=status.HTTP_400_BAD_REQUEST
        )


class LoginView(APIView):
    """Vista para inicio de sesión con JWT."""

    permission_classes = [AllowAny]

    def post(self, request):
        """Autenticar usuario y generar tokens JWT."""
        email = request.data.get("email")
        password = request.data.get("password")

        try:
            usuario = Usuario.objects.get(email=email)
        except Usuario.DoesNotExist:
            return Response(
                {"error": "Credenciales inválidas"},
                status=status.HTTP_401_UNAUTHORIZED
            )

        if not check_password(password, usuario.password):
            return Response(
                {"error": "Credenciales inválidas"},
                status=status.HTTP_401_UNAUTHORIZED
            )

        tokens = generar_tokens(usuario)

        return Response({
            "access": tokens["access"],
            "refresh": tokens["refresh"],
            "usuario": UsuarioSerializer(usuario).data
        })


class LogoutView(APIView):
    """Vista para cerrar sesión."""

    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        """Cerrar sesión del usuario."""
        return Response(
            {"message": "Sesión cerrada, borra tu token localmente"},
            status=205
        )


def generar_tokens(usuario):
    """
    Generar tokens JWT para un usuario.

    Args:
        usuario: Instancia de Usuario

    Returns:
        Dict con tokens refresh y access
    """
    refresh = RefreshToken()
    refresh['usuario_id'] = usuario.id
    refresh['rol'] = usuario.rol
    access = refresh.access_token
    access.set_exp(lifetime=timedelta(hours=24))
    return {
        "refresh": str(refresh),
        "access": str(access)
    }


@api_view(['PUT'])
def update_usuario(request, pk):
    """
    Actualizar usuario existente.

    Args:
        request: Request con datos a actualizar
        pk: ID del usuario

    Returns:
        Response con usuario actualizado o error
    """
    try:
        usuario = Usuario.objects.get(pk=pk)
    except Usuario.DoesNotExist:
        return Response(
            {"error": "Usuario no encontrado"},
            status=status.HTTP_404_NOT_FOUND
        )

    serializer = UsuarioSerializer(
        usuario,
        data=request.data,
        partial=True
    )
    if serializer.is_valid():
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


# ------------------------- Panel de administracion -------------------------

@api_view(['GET'])
@permission_classes([EsAdministrador])
def admin_metricas(request):
    """Metricas globales para el panel de administrador."""
    from plans.models import Plan3DJob
    from suggestion_risk.models import AnalisisRiesgo

    ahora = timezone.now()
    hace30 = ahora - timedelta(days=30)

    usuarios = Usuario.objects.all()
    modelos = Plan3DJob.objects.all()
    pagos = Pago.objects.all()
    exitosos = pagos.filter(estado='exitoso')
    riesgos = AnalisisRiesgo.objects.all()

    total_usuarios = usuarios.count()
    total_modelos = modelos.count()
    ingresos = exitosos.aggregate(total=Sum('monto'))['total'] or 0
    ingresos30 = exitosos.filter(fecha_pago__gte=hace30).aggregate(
        total=Sum('monto')
    )['total'] or 0

    return Response(
        {
            'usuarios': {
                'total': total_usuarios,
                'normales': usuarios.filter(rol='usuario_normal').count(),
                'premium': usuarios.filter(rol='usuario_premium').count(),
                'administradores': usuarios.filter(
                    rol='administrador'
                ).count(),
                'nuevos_30d': usuarios.filter(
                    fecha_registro__gte=hace30
                ).count(),
            },
            'modelos': {
                'total': total_modelos,
                'con_3d': modelos.filter(glb_model__isnull=False).exclude(
                    glb_model=''
                ).count(),
                'nuevos_30d': modelos.filter(created_at__gte=hace30).count(),
                'promedio_por_usuario': (
                    round(total_modelos / total_usuarios, 2)
                    if total_usuarios else 0
                ),
            },
            'pagos': {
                'total': pagos.count(),
                'exitosos': exitosos.count(),
                'ingresos': float(ingresos),
                'ingresos_30d': float(ingresos30),
            },
            'riesgo': {
                'analisis': riesgos.count(),
                'altos': riesgos.filter(
                    nivel_riesgo__in=['alto', 'crítico', 'critico']
                ).count(),
            },
            'generado_en': ahora.isoformat(),
        },
        status=status.HTTP_200_OK,
    )


@api_view(['GET'])
@permission_classes([EsAdministrador])
def admin_usuarios(request):
    """Lista de usuarios con metricas por usuario."""
    usuarios = (
        Usuario.objects.annotate(
            modelos=Count('plan3d_jobs', distinct=True),
            pagos_exitosos=Count(
                'pagos',
                filter=Q(pagos__estado='exitoso'),
                distinct=True,
            ),
            ultimo_modelo=Max('plan3d_jobs__created_at'),
        ).order_by('-fecha_registro', '-id')
    )

    results = [
        {
            'id': u.id,
            'nombre': u.nombre,
            'email': u.email,
            'rol': u.rol,
            'telefono': u.telefono,
            'url': u.url,
            'fecha_registro': u.fecha_registro,
            'fecha_expiracion_plan': u.fecha_expiracion_plan,
            'modelos': u.modelos,
            'pagos_exitosos': u.pagos_exitosos,
            'ultimo_modelo': u.ultimo_modelo,
        }
        for u in usuarios
    ]
    return Response({'count': len(results), 'results': results})


@api_view(['PATCH'])
@permission_classes([EsAdministrador])
def admin_usuario_update(request, pk):
    """Actualiza rol o datos basicos de un usuario (solo administradores)."""
    try:
        usuario = Usuario.objects.get(pk=pk)
    except Usuario.DoesNotExist:
        return Response(
            {'detail': 'Usuario no encontrado.'},
            status=status.HTTP_404_NOT_FOUND,
        )

    if 'rol' in request.data:
        rol = request.data.get('rol')
        roles_validos = {clave for clave, _ in Usuario.ROLES}
        if rol not in roles_validos:
            return Response(
                {'detail': 'Rol no valido.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        usuario.rol = rol

    if 'nombre' in request.data:
        usuario.nombre = str(request.data.get('nombre') or '').strip()
    if 'telefono' in request.data:
        telefono = request.data.get('telefono')
        usuario.telefono = int(telefono) if telefono not in (None, '') else None
    if 'fecha_expiracion_plan' in request.data:
        usuario.fecha_expiracion_plan = (
            request.data.get('fecha_expiracion_plan') or None
        )

    usuario.save()
    return Response(UsuarioSerializer(usuario).data, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([EsAdministrador])
def admin_pagos(request):
    """Ultimos pagos registrados (para el panel de administrador)."""
    pagos = Pago.objects.select_related('usuario').order_by(
        '-fecha_creacion'
    )[:100]
    return Response(
        [
            {
                'id': p.id,
                'usuario': p.usuario_id,
                'usuario_email': p.usuario.email if p.usuario else '',
                'plan': p.plan,
                'monto': float(p.monto),
                'moneda': p.moneda,
                'estado': p.estado,
                'marca_tarjeta': p.marca_tarjeta,
                'ultimos4': p.ultimos4,
                'fecha_creacion': p.fecha_creacion,
                'fecha_pago': p.fecha_pago,
            }
            for p in pagos
        ]
    )

