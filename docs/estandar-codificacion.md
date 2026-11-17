# Estándar de codificación — Plasma3D

> Aplica a los tres proyectos del monorepo:
>
> - Backend: `plasma3d_api` (Django 3.2 + DRF + Python 3.6 + TensorFlow 1.15)
> - Web: `plasma3d_web` (React 18 + TypeScript + Vite + Tailwind + Three.js)
> - Móvil: `plasma_mobile` (Flutter 3.47 + Dart 3.13 + GetX)
>
> El objetivo es código **legible, consistente, seguro y verificable**. Ante una duda,
> sigue el patrón ya existente en el módulo que estás tocando.

---

## Índice

1. [Principios generales](#1-principios-generales)
2. [Backend — `plasma3d_api`](#2-backend--plasma3d_api)
3. [Frontend web — `plasma3d_web`](#3-frontend-web--plasma3d_web)
4. [App móvil — `plasma_mobile`](#4-app-móvil--plasma_mobile)
5. [Seguridad](#5-seguridad)
6. [Git y revisión](#6-git-y-revisión)
7. [Comandos de verificación](#7-comandos-de-verificación)

---

## 1. Principios generales

- **Claridad antes que ingenio.** Prefiere nombres explícitos y funciones pequeñas.
- **Una responsabilidad por archivo/función.** Si un archivo mezcla HTTP, negocio y datos,
  sepáralo.
- **Consistencia.** Respeta el estilo del módulo; no introduzcas una librería o patrón nuevo
  sin justificarlo.
- **Sin lógica de negocio en la capa de presentación** (views HTTP, componentes, widgets).
- **Sin secretos en el código.** Variables de entorno y `.env` (nunca versionados).
- **Todo cambio debe compilar y pasar el linter** antes de considerarse terminado.
- **No dejar código muerto, imports sin usar ni `print`/`console.log` de depuración.**
- **Documenta decisiones no obvias** con un comentario breve o en `docs/`.

---

## 2. Backend — `plasma3d_api`

### 2.1 Arquitectura en capas (Service / Selector)

| Capa | Archivo | Responsabilidad | No debe hacer |
|---|---|---|---|
| API | `views.py`, `urls.py` | Parsear request, permisos, llamar Service/Selector, devolver `Response` | Reglas de negocio, queries complejas |
| Serializers | `serializers.py` | Validar forma/tipos y (de)serializar | Reglas de negocio, efectos secundarios |
| Services | `services.py` | Casos de uso de **escritura**, transacciones, orquestación | Conocer `request`/`response` |
| Selectors | `selectors.py` | Consultas de **lectura** reutilizables | Modificar datos |
| Models | `models.py` | Esquema, invariantes, helpers mínimos | Orquestar apps o servicios externos |
| Clients | `clients.py`, `pagues.py`, `services_gemini.py` | Integraciones externas (Stripe, Gemini, Cloudinary) | Reglas de negocio |
| Exceptions | `core/exceptions.py` | Errores de dominio | Códigos HTTP |

**Regla de dependencias:** `views → serializers → services/selectors → models/clients`.
Un Service/Selector **nunca** importa `request`, `Response` ni vistas.

### 2.2 Nombres y estilo (PEP 8)

- Módulos, funciones y variables: `snake_case`. Clases: `PascalCase`.
  Constantes: `UPPER_SNAKE_CASE`.
- Funciones con **verbo**: `crear_plan`, `procesar_pago`, `analizar_plan`.
- Un Service = **un caso de uso** público.
- Imports: stdlib → terceros → Django → locales, separados por línea en blanco.
  Usa imports absolutos (`from plans.models import Plan3DJob`).
- Líneas ≤ 100 caracteres. Sin tabs.
- Docstrings en funciones públicas (Google style, en español si el módulo está en español).
- Sin `print` en producción: usa `logging.getLogger(__name__)`.
- **Python 3.6**: no usar walrus (`:=`), `dataclasses` nativo, `from __future__ import
  annotations`, ni sintaxis de 3.7+. Cuidado con TF 1.15 / Mask R-CNN.

```python
# plans/services.py
from django.db import transaction

@transaction.atomic
def procesar_plano(*, usuario, imagen):
    """Genera el modelo 3D de un plano y lo guarda."""
    job = Plan3DJob.objects.create(usuario=usuario)
    det = run_inference(imagen)
    _guardar_glb(job, det)
    return job
```

### 2.3 Views delgadas

- Máximo ~20 líneas. Sin `if` de negocio.
- Valida con el serializer y delega.
- Devuelve códigos HTTP correctos (`200`, `201`, `204`, `400`, `401`, `403`, `404`, `409`).
- Errores de API con forma estable: `{"detail": "mensaje"}` (los endpoints de pago pueden
  conservar `success`/`message` por compatibilidad).
- Autenticación: `JWTAuthentication` (el `request.user` es `users.Usuario`).
- Permisos: `IsAuthenticated` o `EsAdministrador`; **siempre** valida pertenencia
  (`plan.usuario_id == request.user.id`) salvo admin.

```python
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def subir_plano(request):
    serializer = SubirPlanoSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    job = procesar_plano(
        usuario=request.user,
        imagen=serializer.validated_data["imagen"],
    )
    return Response(Plan3DJobSerializer(job).data, status=status.HTTP_201_CREATED)
```

### 2.4 Serializers

- Solo validan forma/tipos y representan. Sin `create`/`update` con lógica de negocio.
- No llaman a otros serializers "para hacer cosas".
- Campos sensibles (`password`, `rol`) son `write_only` o `read_only` según corresponda.
- El **rol nunca se acepta del cliente** en el registro; se fuerza a `usuario_normal`.

### 2.5 Models y migraciones

- Modelos con nombres de dominio (`Usuario`, `Plan3DJob`, `AnalisisRiesgo`).
- `__str__` útil y corto.
- Evita lógica pesada en `save()` o en signals; usa Services.
- Relaciones explícitas: `related_name`, `on_delete`, `null`/`blank` justificados.
- Índices/`ordering` cuando una consulta lo requiere.
- **Migraciones**: cada cambio de modelo debe generar migración
  (`python manage.py makemigrations <app>`). No edites migraciones aplicadas a mano.
- En este repo el arranque de Docker ejecuta `makemigrations && migrate`; aun así, revisa
  que la migración generada sea correcta.

### 2.6 Queries y base de datos

- Usa `select_related`/`prefetch_related` para evitar N+1.
- Anota agregados con `Count`, `Sum`, `Max` en lugar de bucles en Python.
- Toda escritura multi-tabla va en `@transaction.atomic`.
- No expongas querysets sin filtrar por usuario en endpoints privados.
- Pagina listas grandes (el panel admin ya limita pagos a 100).

### 2.7 Archivos, media y uploads

- Valida **extensión** y tamaño antes de guardar (`.glb`, `.gltf`, imágenes, PDF, DXF…).
- Usa el storage configurado (`STORAGE_BACKEND=local|cloudinary`); nunca rutas absolutas.
- Rutas por usuario: `media/users/<usuario>/jobs/<job>/...` (ver `plans/models.py`).
- No confíes en el nombre original del archivo para rutas; usa nombres generados.
- Al borrar un modelo, borra también sus archivos (`plan_file`, `plan_image`,
  `detections_json`, `glb_model`).

### 2.8 Integraciones externas

- Stripe: `users/pagues.py`. El monto **siempre** se calcula en el servidor
  (`PRECIOS_PLANES`); nunca se acepta del cliente. La secret key vive solo en el backend.
- Gemini: `suggestion_risk/services_gemini.py` con **fallback** heurístico en
  `services_riesgo.py`; un fallo de IA no debe romper el endpoint.
- Cloudinary: `plasma3d_api/cloudinary_storage.py`.
- Los clientes externos se mockean en tests.

### 2.9 Tests

- Services/Selectors: tests unitarios sin HTTP.
- Views: `APIClient` para permisos, validación y códigos.
- Clientes externos: mockeados.
- Cualquier cambio de API debe incluir al menos un test de camino feliz y uno de error.

### 2.10 Utilidades del proyecto

- `python manage.py make_admin <email>`: promueve a administrador.
- `python manage.py ensure_default_admin`: asegura el admin de `.env` (idempotente).
- `python manage.py check_stripe`: verifica que `pk` y `sk` sean de la misma cuenta.

---

## 3. Frontend web — `plasma3d_web`

### 3.1 Feature-Sliced Design (FSD)

| Capa | Rol | Solo puede importar de |
|---|---|---|
| `app` | bootstrap, router, providers | todas las inferiores |
| `pages` | pantallas por ruta | `widgets`, `features`, `entities`, `shared` |
| `widgets` | bloques de UI autónomos (layout, editor 3D) | `features`, `entities`, `shared` |
| `features` | interacciones/casos de uso (login, pagar, riesgo) | `entities`, `shared` |
| `entities` | entidades de negocio (tipos, api, store) | `shared` |
| `shared` | UI kit, lib, http, config | — |

**Regla de oro:** una capa solo importa de capas **inferiores**; nunca entre slices
hermanos de la misma capa. Si dos slices comparten algo, bájalo a `entities`/`shared`.

Estructura de un slice: `ui/`, `model/`, `api/`, `lib/`, `index.ts` (API pública).

### 3.2 TypeScript

- `strict: true`. **Evita `any`**; usa `unknown` + narrowing.
- `interface` para objetos; `type` para uniones/alias.
- Componentes y tipos: `PascalCase`. Funciones/variables: `camelCase`.
  Hooks: `useAlgo`. Stores: `useXStore`. APIs: `xApi`.
- Imports con alias **`@/`**; nunca `../../../`.
- Usa `import type` para tipos.
- Exportaciones **nombradas** (no `default export`).
- Tipos de props: `interface XxxProps`.
- Evita aserciones `as` innecesarias; si son inevitables, acótalas y coméntalas.

### 3.3 Componentes y hooks

- Componentes de función, un componente principal por archivo.
- Sin lógica de negocio en componentes de presentación: usa stores/API.
- `useEffect` con limpieza (timers, listeners, peticiones cancelables).
- No hagas fetch en el render; usa `useEffect`/callbacks.
- Extrae componentes si superan ~200 líneas o si se repiten.
- Accesibilidad: `aria-*`, labels asociados, foco visible, teclado (`Enter`/`Escape`).
- Textos de UI en español; código/identificadores en inglés cuando el módulo lo use.

### 3.4 Estado y datos

- Estado global con **zustand** en `entities/<x>/store.ts`.
- Datos del servidor **solo** vía `api.ts` (`entities/*/api.ts`, `features/*/api.ts`).
- HTTP centralizado en `shared/api/http.ts` (axios + `Bearer` token).
- Stores: acciones pequeñas, sin lógica de presentación.
- No dupliques estado del servidor en varios stores.

### 3.5 API y errores

- Rutas relativas (`api/...`) para funcionar tras Vite/Nginx.
- Errores: el backend devuelve `{ detail }`; muestra el mensaje del servidor.
- No expongas secretos en `VITE_*`. Solo configuración pública (base URL, Stripe pk vía API).
- Subidas: `FormData`; no fijes `Content-Type` a mano.
- URLs de media con `assetUrl()`.

### 3.6 Estilos y diseño

- Tailwind con los tokens del proyecto (`bg-canvas`, `bg-surface`, `text-muted`,
  `border-border`, `text-primary`, etc.). No uses hex sueltos salvo en tokens.
- `cn()` para clases condicionales.
- Mobile-first y responsive; respeta el tema oscuro por defecto.
- Componentes reutilizables en `shared/ui`.
- No mezcles estilos inline con Tailwind salvo valores dinámicos.

### 3.7 Three.js / editor 3D

- Motor y escena en `widgets/viewer3d/engine.ts`; wrapper de modelo en
  `entities/model3D/three/Modelo3D.ts`.
- Libera recursos: `geometry.dispose()`, `material.dispose()`, `texture.dispose()`.
- No compartas y modifiques materiales entre mallas sin clonar.
- Exportaciones: GLB/GLTF/STL con `onlyVisible: false`; retira las aristas (`__edges`) antes
  de exportar y restáuralas después.
- Evita allocations por frame; reutiliza vectores/matrices.
- Al colocar elementos, convierte de mundo a local del objeto (`worldToLocal`).
- Texturas: UVs normalizadas + `repeat` proporcional al tamaño real.

### 3.8 Rutas y guards

- Rutas en `app/AppRouter.tsx`.
- Privadas con `RequireAuth`; administración con `RequireAdmin`
  (`user.rol === 'administrador'`).
- El rol/avatar se refresca desde el backend al montar el layout privado.

### 3.9 Rendimiento

- `useMemo`/`useCallback` solo cuando aporten (listas grandes, dependencias estables).
- Carga diferida (`import()` dinámico) para exportadores pesados (PDF/Excel) si crece el bundle.
- Evita re-renders masivos; separa estado local del global.

### 3.10 Herramientas

- `npm run build` (tsc + vite), `npm run lint`, `npm run typecheck`.
- No commitees `dist/` ni `dev-dist/`.
- Si agregas tests, usa Vitest + Testing Library y scripts `test`/`test:run`.

---

## 4. App móvil — `plasma_mobile`

### 4.1 Estructura

```text
lib/
├── api/         # ApiClient + servicios (auth, modelos)
├── config/      # tema, colores, tipografías
├── const/       # constantes (URLs base)
├── routes/      # rutas GetX
└── screens/
    └── <feature>/
        ├── view/       # pantallas
        ├── service/    # controladores/servicios
        ├── models/     # modelos de datos
        └── widgets/    # widgets de la feature
```

- APIs en `lib/api/`; no hagas `http` directo en widgets/pantallas.
- Configuración de API por `--dart-define=API_BASE_URL=...` y `API_MEDIA_URL=...`.

### 4.2 Estilo Dart

- `dart format` y `flutter analyze` **sin issues**.
- `lowerCamelCase` para variables/funciones; `PascalCase` para clases; `_privado` para
  miembros internos; archivos `snake_case`.
- Imports: `dart:` → paquetes → proyecto; usa `package:plasma_mobile/...`.
- Prefiere `const` en constructores y widgets cuando sea posible.
- Evita `dynamic`; usa tipos/null-safety (`String?`, `int?`).
- Sin `print` de depuración.

### 4.3 Widgets y UI

- Widgets pequeños y reutilizables; extrae si superan ~150 líneas.
- Usa el sistema de diseño: `AppThemes`, `AppColors`, `AppTextStyle` y `shared` (`AppCard`,
  `AppButton`, `AppBadge`, `AppAvatar`, `AppLogo`, `AppEmptyState`).
- No uses colores hardcodeados; usa tokens del tema.
- Usa `.withValues(alpha: x)` en lugar de `withOpacity` (deprecado).
- Tema **oscuro por defecto**; respeta claro/oscuro.
- Estados: loading, vacío, error y éxito explícitos.
- Pull-to-refresh en listas; `ListView.builder` para listas largas.
- Accesibilidad: `tooltip`, `aria` equivalentes, tamaños táctiles ≥ 44 px.

### 4.4 Estado (GetX)

- Controladores `GetxController` con `.obs` para estado reactivo.
- `Obx`/`ObxValue` alrededor de lo que cambia; no envuelvas todo el árbol.
- Inyección con `Get.put`/`Get.find`; libera controladores (`onClose`/`dispose`).
- No guardes `BuildContext` en el controlador.
- Tras un `await`, verifica `mounted`/`context.mounted` antes de usar el contexto.

### 4.5 API y errores

- `ApiClient` centraliza base URL, JWT, multipart y parseo de errores (`{detail}`/`{message}`).
- `ModelsService` para modelos; `AuthService` para auth.
- Maneja `ApiException` y muestra snackbars/toasts claros.
- No muestres stack traces al usuario; registra en consola solo en debug.
- Subidas: valida archivo y tamaño; usa `MultipartFile`.
- URLs de media: `ApiClient.mediaUrl(path)`.

### 4.6 Modelos

- Clases inmutables (`final`) con `fromJson` tolerante a nulos.
- No uses `Map` sin tipar en la UI; convierte a modelos.
- Normaliza tipos numéricos (`int.tryParse`, `num.toInt()`).

### 4.7 Navegación y rutas

- Rutas nombradas en `routes/routes.dart` (`GetPage`).
- No navegues con `Navigator` directo salvo casos nativos puntuales.
- `logout` limpia storage y vuelve a `signin`.

### 4.8 Rendimiento

- `const` donde aplique; evita rebuilds innecesarios.
- Libera controladores, animaciones y suscripciones.
- Optimiza imágenes (`cacheWidth`/`cacheHeight` si aplica).
- Evita trabajo pesado en `build`.

### 4.9 Herramientas

- `flutter analyze`, `flutter test`, `dart format`.
- No abras emulador/navegador en validaciones automáticas.
- Prueba de humo: `flutter test test/widget_test.dart`.

---

## 5. Seguridad

- **Secretos solo en el backend** (`.env`). Nunca en `VITE_*` ni en la app móvil.
- La `STRIPE_API_KEY` y `ADMIN_PASSWORD` viven en el backend; el frontend recibe solo la
  publishable key vía API.
- No loguees tokens, contraseñas, claves ni datos de tarjeta.
- Valida **pertenencia** de recursos (usuario dueño) en cada endpoint privado.
- El registro público siempre crea `usuario_normal`; el rol admin se asigna por comando/panel.
- Valida extensiones, MIME y tamaño de archivos subidos.
- Rota cualquier clave que se haya expuesto (chat, capturas, commits).
- Usa `HTTPS` en producción; no desactives `CSRF`/CORS sin justificarlo.

---

## 6. Git y revisión

### 6.1 Commits

Formato **Conventional Commits**:

```text
feat: agregar exportación GLTF y STL
fix: corregir claves de Stripe de cuentas distintas
docs: actualizar estándar de codificación
refactor: extraer servicio de análisis de riesgo
test: cubrir límite de planos gratuitos
chore: actualizar dependencias
```

- Commits pequeños y atómicos; un tema por commit.
- No commitees `.env`, `media/`, `dist/`, `dev-dist/`, `node_modules/` ni secretos.
- Mensajes en imperativo y en español (o inglés consistente con el repo).

### 6.2 Pull requests

- Describe **qué** y **por qué**, no solo el cómo.
- Incluye pasos de verificación ejecutados (`build`, `lint`, `analyze`, tests).
- Si cambia el contrato de API, actualiza el frontend/móvil en el mismo PR o documenta el
  cambio.
- Revisa que no haya `TODO` sin issue, código comentado muerto ni logs de depuración.

### 6.3 Checklist antes de pedir revisión

- [ ] `manage.py check` sin issues (backend).
- [ ] Migraciones generadas/aplicadas si cambiaron modelos.
- [ ] `npm run build` y `npm run lint` OK (web).
- [ ] `flutter analyze` y `flutter test` OK (móvil).
- [ ] Sin secretos ni datos sensibles.
- [ ] Documentación actualizada si cambió la arquitectura o los endpoints.

---

## 7. Comandos de verificación

### Backend

```bash
docker compose -f docker-compose.dev.yml up -d
docker exec plasma3d-dev-plasma3d-api-1 python manage.py check
docker exec plasma3d-dev-plasma3d-api-1 python manage.py makemigrations <app>
docker exec plasma3d-dev-plasma3d-api-1 python manage.py migrate
```

### Web

```bash
cd plasma3d_web
npm run build
npm run lint
npm run typecheck
```

### Móvil

```bash
cd plasma_mobile
flutter analyze
flutter test
dart format --output=none --set-exit-if-changed lib test
```

---

## 8. Referencias

- [Arquitectura del backend](backend-architecture.md)
- [Arquitectura del frontend web](frontend-architecture.md)
- [Plasma3D en el celular](movil.md)
- HackSoft Django Styleguide — <https://github.com/HackSoftware/Django-Styleguide>
- Feature-Sliced Design — <https://feature-sliced.design/>
- Flutter lint rules — <https://dart.dev/tools/linter-rules>
- Conventional Commits — <https://www.conventionalcommits.org/>
