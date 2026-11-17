# Arquitectura de la App Móvil — `plasma_mobile`

## 1. Stack

- **Flutter 3.47.8 / Dart 3.13.7** (Material 3).
- **GetX** para estado, navegación e inyección de dependencias.
- **get_storage** para sesión/tokens y preferencias locales.
- **http** para la API REST, centralizado en `ApiClient`.
- **image_picker** para cámara/galería.
- **model_viewer_plus** para el visor 3D y AR.
- **google_fonts** (Poppins) y tema oscuro por defecto.

La app es el cliente móvil de Plasma3D: autenticación, listado y gestión de
modelos, generación con IA, visor 3D, perfil y plan. **No incluye el editor CAD**;
la edición 3D se realiza en `plasma3d_web`.

---

## 2. Capas

| Capa | Ubicación | Responsabilidad |
|---|---|---|
| **UI / Pantallas** | `lib/screens/<feature>/view` | Widgets, composición visual, interacción |
| **Controladores** | `lib/screens/<feature>/service`, `lib/config` | Estado (GetX), casos de uso, navegación |
| **API / Servicios** | `lib/api` | `ApiClient`, `AuthService`, `ModelsService`; JWT y errores |
| **Modelos** | `lib/screens/<feature>/models` | Clases inmutables con `fromJson` |
| **Configuración** | `lib/config`, `lib/const` | Tema, colores, tipografías, URLs base |
| **Rutas** | `lib/routes` | `GetPage` y nombres de rutas |
| **UI compartida** | `lib/screens/widgets` | `AppCard`, `AppButton`, `AppTextField`, etc. |

**Regla de dependencias:** `screens → services/controllers → api → backend`.
La UI **no** hace peticiones HTTP directas; usa controladores/servicios.

---

## 3. Estructura

```text
lib/
├── api/
│   ├── api_client.dart       # base URL, JWT, multipart, errores
│   ├── auth_service.dart     # login, registro, logout, perfil
│   └── models_service.dart   # listar, subir, crear, eliminar modelos
├── config/
│   ├── app_colors.dart       # tokens de color
│   ├── app_themes.dart       # tema claro/oscuro (oscuro por defecto)
│   ├── app_textstyles.dart   # Poppins
│   └── theme_controller.dart # cambio de tema persistido
├── const/
│   └── app_constants.dart    # API_BASE_URL / API_MEDIA_URL
├── routes/
│   └── routes.dart           # GetPage + nombres
└── screens/
    ├── splash/
    ├── onboarding/
    ├── auth/                 # view, service, models
    ├── dasboard/             # dashboard + widgets
    ├── main/                 # shell, sidebar, perfil, visor
    ├── view/                 # visor 3D genérico
    └── widgets/
        ├── input/            # campos de formulario
        ├── navegacion/       # bottom navigation
        └── ui/               # sistema de diseño
```

---

## 4. Flujo de una petición

```text
Widget / Pantalla
      │  (evento de usuario)
      ▼
Controlador GetX / Servicio
      │
      ▼
ApiClient (base URL + Bearer + manejo de errores)
      │
      ▼
API Django REST  ──►  PostgreSQL / media
      │
      ▼
JSON (snake_case)
      │
      ▼
Modelo Dart (fromJson)  ──►  Estado (.obs)  ──►  UI (Obx)
```

- Los tokens y el usuario se guardan en **GetStorage**.
- `ApiClient` obtiene el token desde `AuthController` y añade
  `Authorization: Bearer <token>`.
- Los errores del backend (`detail`/`message`) se convierten en `ApiException` y
  se muestran con snackbars/toasts.

---

## 5. Sesión y configuración

- `AuthController` (GetX, permanente) gestiona login, registro, logout y perfil.
- Almacenamiento: `access`, `refresh`, `usuario`, `isLoggedIn`.
- `SplashScreen` decide la ruta inicial: onboarding, login o home.
- `PrivateLayout`/shell refresca el usuario desde el backend para mantener el
  rol y el avatar actualizados.
- URLs base por `--dart-define`:
  - `API_BASE_URL` (por defecto `https://django-sw1.fournext.me/`)
  - `API_MEDIA_URL` (sin slash final)
- No hay secretos en la app móvil; solo configuración pública.

---

## 6. Pantallas y navegación

| Pantalla | Archivo | Rol |
|---|---|---|
| Splash | `screens/splash/splash_screen.dart` | Arranque y decisión de ruta |
| Onboarding | `screens/onboarding/onboarding_screen.dart` | Presentación inicial |
| Login / Registro | `screens/auth/view/` | Autenticación JWT |
| Inicio | `screens/dasboard/view/dashboard_screen.dart` | Modelos, subir plano, crear/eliminar |
| IA Diseño | `screens/main/sidebar/widget/diseno_ia.dart` | Cámara/galería → modelo 3D |
| Visor 3D | `screens/main/planVisualizador/visualizador3d_page.dart` | Modelos del usuario + AR |
| Perfil | `screens/main/perfil/profile_screen.dart` | Datos, edición y logout |
| Configuración | `screens/main/sidebar/widget/config_options_card.dart` | Tema, premium, soporte |

- Rutas declaradas en `lib/routes/routes.dart` (`GetPage`).
- El shell principal (`main_screen.dart`) usa **sidebar** en tablet/escritorio y
  **bottom navigation** en móvil.
- La contratación de planes se gestiona en la **web**; la app muestra el estado
  del plan del usuario.

---

## 7. API utilizada

| Método | Endpoint | Uso |
|---|---|---|
| POST | `/api/users/auth/registro/` | Registro |
| POST | `/api/users/auth/login/` | Login (JWT) |
| POST | `/api/users/auth/logout/` | Logout |
| PATCH | `/api/users/usuarios/<id>/` | Actualizar perfil |
| GET | `/api/set_plan/lista_modelos/` | Listar modelos del usuario |
| POST | `/api/set_plan/plans/` | Subir plano (multipart) |
| POST | `/api/set_plan/plans/empty/` | Crear modelo vacío |
| DELETE | `/api/set_plan/plans/<id>/` | Eliminar modelo |

---

## 8. UI y diseño

- Tema **oscuro por defecto** (alineado con `plasma3d_web`), con toggle claro.
- Tokens en `AppColors` y `AppThemes`; tipografía **Poppins**.
- Componentes compartidos en `screens/widgets/ui` (`AppCard`, `AppButton`,
  `AppBadge`, `AppAvatar`, `AppLogo`, `AppEmptyState`).
- Sin colores hardcodeados; se usan tokens del tema.
- Estados explícitos: cargando, vacío, error y éxito.
- Listas con `ListView.builder`/`GridView` y *pull to refresh* cuando aplica.

---

## 9. Modelos 3D e IA

- **IA Diseño**: selecciona/toma una foto, la envía a
  `POST /api/set_plan/plans/` y el backend ejecuta la detección/generación.
- El modelo resultante (GLB/GLTF) se visualiza con `model_viewer_plus`.
- La app no procesa pagos ni edita geometría; solo consume el resultado del
  backend.

---

## 10. Build y entornos

```bash
flutter pub get
flutter analyze
flutter test
flutter run \
  --dart-define=API_BASE_URL=http://192.168.1.50:8000/ \
  --dart-define=API_MEDIA_URL=http://192.168.1.50:8000
```

Para APK:

```bash
flutter build apk --release \
  --dart-define=API_BASE_URL=https://tu-backend/ \
  --dart-define=API_MEDIA_URL=https://tu-backend
```

No se abren emuladores/navegadores en las validaciones automáticas.

---

## 11. Convenciones

El detalle de estilo, nombres y reglas está en
[`estandar-codificacion.md`](estandar-codificacion.md). Puntos clave del móvil:

- `dart format` y `flutter analyze` sin issues.
- Archivos `lower_snake_case.dart`; clases `PascalCase`.
- Widgets pequeños, `const` cuando aplique, sin lógica de negocio en `build`.
- Estado con GetX (`.obs`, `Obx`), liberando controladores.
- HTTP solo vía `ApiClient`/servicios.
- Tras un `await`, verificar `mounted` antes de usar el contexto.

---

## 12. Referencias

- [`movil.md`](movil.md) — cómo usar la app en el celular (web, PWA y APK).
- [`estandar-codificacion.md`](estandar-codificacion.md) — estándar del proyecto.
- Flutter — <https://docs.flutter.dev/>
- GetX — <https://pub.dev/packages/get>
- Effective Dart — <https://dart.dev/effective-dart>
