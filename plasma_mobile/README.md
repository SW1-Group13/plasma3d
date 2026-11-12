# plasma_mobile

Aplicación móvil de **Plasma3D** (Flutter) para generar y visualizar modelos 3D
a partir de planos 2D con IA.

## Requisitos
- Flutter **3.47.8** (stable) / Dart **3.13**
- Backend `plasma3d_api` accesible

## Configuración de la API
Por defecto la app apunta a `https://django-sw1.fournext.me/`.
Puedes cambiar la URL sin tocar código:

```bash
flutter run \
  --dart-define=API_BASE_URL=https://tu-backend/ \
  --dart-define=API_MEDIA_URL=https://tu-backend
```

La app **no** contiene claves secretas ni referencias a blockchain.

## Funcionalidades
- Autenticación con JWT (registro, login, logout).
- **Inicio**: lista de modelos, subir plano, crear modelo vacío y eliminar.
- **IA Diseño**: cámara/galería → genera un modelo 3D.
- **Visualizador 3D**: modelos del usuario, controles y AR.
- **Perfil**: editar nombre/contraseña, ver plan y datos.
- **Plan Premium** y centro de soporte.

## Estructura
```
lib/
  api/         # ApiClient + servicios (auth, modelos)
  config/      # tema, colores, tipografías
  const/       # constantes (URLs base)
  routes/      # rutas GetX
  screens/     # auth, dashboard, main, perfil, visor...
```

## Endpoints que consume
- `POST /api/users/auth/registro/`
- `POST /api/users/auth/login/`
- `POST /api/users/auth/logout/`
- `PATCH /api/users/usuarios/<id>/`
- `GET  /api/set_plan/lista_modelos/`
- `POST /api/set_plan/plans/` (multipart: `plan_file`, `usuario`)
- `POST /api/set_plan/plans/empty/`
- `DELETE /api/set_plan/plans/<id>/`
- `POST /api/users/payment/process/`

## Notas
- Tipografía Poppins (`google_fonts`).
- Tema oscuro por defecto (alineado con `plasma3d_web`) con toggle claro/oscuro.
- Para desarrollo: `flutter analyze` y `flutter test`.
