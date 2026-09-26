# Arquitectura del Frontend — `plasma3d-web` (Angular + FSD)

## 1. Motivación

A medida que crece una SPA, organizar el código por **tipo técnico** (`components/`,
`services/`, `models/`) dispersa una misma funcionalidad en muchas carpetas y genera
dependencias cruzadas difíciles de seguir.

El frontend adopta **Feature-Sliced Design (FSD)**: se organiza por **responsabilidad y
nivel de abstracción**, con una **regla estricta de dependencias** entre capas. Esto hace que
cada funcionalidad sea aislada, testeable y reemplazable.

Proyecto: Angular 20 (standalone components, signals, `inject()`, SSR).

---

## 2. Capas (de arriba hacia abajo)

| Capa | Rol | Puede importar de |
|------|-----|-------------------|
| `app` | Bootstrap, providers, routing y estilos globales | todas las capas inferiores |
| `pages` | Pantallas asociadas a una ruta; componen widgets/features/entities | `widgets`, `features`, `entities`, `shared` |
| `widgets` | Bloques de UI grandes y autónomos (layout, visor 3D) | `features`, `entities`, `shared` |
| `features` | Interacciones del usuario / casos de uso (login, pagar, guardar) | `entities`, `shared` |
| `entities` | Entidades de negocio (modelo, UI, API) | `shared` |
| `shared` | Reutilizable y sin lógica de negocio (UI kit, lib, api base, config) | — |

**Regla de oro:** una capa **solo** importa de capas **estrictamente inferiores**. Nunca al
revés, y nunca entre slices hermanos de la misma capa.

---

## 3. Estructura de un slice

Cada slice (carpeta dentro de una capa) expone una **API pública** vía `index.ts` y organiza
su interior en segmentos:

```text
features/auth/
├── ui/           # componentes standalone de la feature
├── model/        # estado (signals), stores, tipos
├── api/          # llamadas HTTP de la feature
├── lib/          # helpers internos
└── index.ts      # API pública (único punto de import permitido)
```

Reglas:

- Importar un slice **solo** por su `index.ts` (`features/auth`), nunca por rutas internas.
- Un slice no importa a otro de su misma capa; si comparten algo, baja ese algo a `entities`
  o `shared`.

---

## 4. Estructura objetivo en Angular

```text
src/app/
├── app/                  # app.config.ts, app.routes.ts, providers, estilos globales
├── pages/                # home, dashboard, editor, perfil
├── widgets/              # public/private layout, visor 3D
├── features/             # auth (login/register), payment, blockchain, guardar-modelo
├── entities/             # user, model3D, budget, material, blockchain, cloudinary
│   └── <entity>/
│       ├── ui/
│       ├── model/
│       ├── api/
│       └── index.ts
└── shared/
    ├── ui/               # spinner, botones, inputs...
    ├── api/              # HttpClient base, interceptores, config del endpoint
    ├── lib/              # utilidades puras
    └── config/           # environment, constantes
```

---

## 5. Mapeo del estado actual → objetivo

| Actual | Objetivo FSD |
|--------|--------------|
| `src/app/models/**` (interfaces/clases) | `entities/<entity>/model` |
| `src/app/features/*/services/*.ts` (HTTP) | `entities/<entity>/api` (si es de entidad) o `features/<f>/api` |
| `src/app/layout/**` | `widgets/layout` y `shared/ui` (spinner) |
| `src/app/features/auth/**` | `features/auth` (+ `entities/user` para el modelo de usuario) |
| `src/app/features/viewer3d/**` | `widgets/viewer3d` (visor) + `features/editor` (acciones) + `entities/model3D` |
| `src/app/features/users/pages/**` | `pages/dashboard`, `pages/perfil`; subcomponentes a `features/*` |
| `src/app/features/public/pages/home-page` | `pages/home` |
| `src/app/routes/*.routes.ts` | `app/app.routes.ts` (o `pages/*` con rutas lazy) |
| `src/app/app.ts`, `app.config.ts` | `app/` |

> Migración incremental: mover una feature completa, dejando un `index.ts` como fachada, y
> actualizar los imports.

---

## 6. Convenciones

- Componentes **standalone**; estado con **signals**; inyección con **`inject()`**.
- **HTTP solo** en `api/` de `entities`/`features`, no en componentes.
- Sin lógica de negocio en los templates; moverla a `model/` o servicios.
- Rutas con **lazy loading** por página.
- Nada externo a `shared` puede ser usado por `shared`.
- Evitar imports relativos profundos (`../../../`); usar **alias de paths**.

---

## 7. Alias de paths (recomendado en `tsconfig.json`)

```json
{
  "compilerOptions": {
    "baseUrl": "src",
    "paths": {
      "@app/*": ["app/app/*"],
      "@pages/*": ["app/pages/*"],
      "@widgets/*": ["app/widgets/*"],
      "@features/*": ["app/features/*"],
      "@entities/*": ["app/entities/*"],
      "@shared/*": ["app/shared/*"]
    }
  }
}
```

---

## 8. Referencias

- Feature-Sliced Design — <https://feature-sliced.design/>
- Angular Style Guide — <https://angular.dev/style-guide>
