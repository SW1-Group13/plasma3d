# Arquitectura del Frontend — `plasma3d-web` (React + Vite + FSD)

## 1. Motivación

A medida que crece una SPA, organizar el código por **tipo técnico** (`components/`,
`services/`, `models/`) dispersa una misma funcionalidad en muchas carpetas y genera
dependencias cruzadas difíciles de seguir.

El frontend adopta **Feature-Sliced Design (FSD)**: se organiza por **responsabilidad y
nivel de abstracción**, con una **regla estricta de dependencias** entre capas. Esto hace que
cada funcionalidad sea aislada, testeable y reemplazable.

Proyecto: **React 18 + TypeScript + Vite** con **Tailwind CSS**, **Radix UI**, `zustand`
(estado), `react-router-dom` (rutas), `axios` (HTTP) y `three` (3D).

---

## 2. Capas (de arriba hacia abajo)

| Capa | Rol | Puede importar de |
|------|-----|-------------------|
| `app` | Bootstrap, providers, router | todas las capas inferiores |
| `pages` | Pantallas asociadas a una ruta | `widgets`, `features`, `entities`, `shared` |
| `widgets` | Bloques de UI grandes y autónomos (layout, editor 3D) | `features`, `entities`, `shared` |
| `features` | Interacciones del usuario / casos de uso (login, pagar, guardar) | `entities`, `shared` |
| `entities` | Entidades de negocio (modelo, UI, API, store) | `shared` |
| `shared` | Reutilizable y sin lógica de negocio (UI kit, lib, api base, config) | — |

**Regla de oro:** una capa **solo** importa de capas **estrictamente inferiores**. Nunca al
revés, y nunca entre slices hermanos de la misma capa.

---

## 3. Estructura de un slice

Cada slice (carpeta dentro de una capa) expone su interior mediante segmentos:

```text
features/auth/
├── ui/           # componentes React de la feature
├── model/        # estado (zustand), tipos
├── api/          # llamadas HTTP de la feature
├── lib/          # helpers internos
└── index.ts      # API pública (punto de import recomendado)
```

Reglas:

- Un slice no importa a otro de su misma capa; si comparten algo, baja ese algo a `entities`
  o `shared`.
- Importar un slice por su `index.ts` cuando exista.

---

## 4. Estructura actual

```text
src/
├── app/                  # App.tsx, AppRouter.tsx, RequireAuth.tsx
├── pages/                # Home, Login, Register, Dashboard, Editor, Perfil, Payment
├── widgets/
│   ├── layout/           # PublicLayout, PrivateLayout
│   └── viewer3d/         # engine.ts (Three.js), EditorViewer, HomeViewer
├── features/
│   ├── auth/             # api + ui (LoginForm, RegisterForm)
│   ├── payment/          # api + ui (PaymentForm)
│   └── budget/           # ui (BudgetDialog, PricesDialog)
├── entities/
│   ├── session/          # store de sesión (tokens + usuario)
│   ├── user/             # types + api
│   ├── model3D/          # types, api, store, three/{Modelo3D,textures}
│   ├── budget/           # types, api, store, materials
│   ├── structural/       # types + api
│   ├── cloudinary/       # types + api
│   └── payment/          # types
└── shared/
    ├── api/              # http (axios + interceptor de token)
    ├── config/           # env (VITE_*)
    ├── lib/              # cn(), utilidades
    └── ui/               # Button, Input, Label, Card, Dialog, Badge, Spinner, Toast, Icons
```

---

## 5. Convenciones

- Componentes de **función** + hooks; estado global con **zustand** (`store.ts` por entidad).
- **HTTP solo** en `entities/*/api.ts` o `features/*/api.ts`; el cliente axios vive en
  `shared/api/http.ts` e inyecta el `Bearer` token (excluyendo login/registro/cloudinary).
- **Datos del servidor** vía `api.ts`; **estado** en `store.ts`.
- **UI reutilizable** en `shared/ui` (Radix + `class-variance-authority` + Tailwind).
- Rutas en `app/AppRouter.tsx`; rutas privadas protegidas con `RequireAuth`.
- Evitar `../../../`; usar el alias **`@/`**.
- Sin lógica de negocio en los componentes de presentación: usar stores/API.

---

## 6. Alias de paths

Definido en `tsconfig.app.json` y `vite.config.ts`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  }
}
```

---

## 7. Entorno y proxy

`vite.config.ts` carga el `.env` de **la raíz del proyecto** (`envDir: '..'`) y define proxies
hacia el backend:

- `/api`, `/media`, `/static` → `VITE_API_URL`
- `/ws` → `VITE_WS_URL` (opcional)

La app usa base relativa (`VITE_API_BASE=/`), así que funciona igual tras el proxy de Vite
(dev) y tras Nginx (prod), sin CORS.

---

## 8. Referencias

- Feature-Sliced Design — <https://feature-sliced.design/>
- React — <https://react.dev/>
- Vite — <https://vite.dev/>
