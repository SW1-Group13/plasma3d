# plasma3d-web

Frontend de Plasma3D — **React + TypeScript + Vite** con **Tailwind CSS** y **Radix UI**.
Consume la API de `plasma3d-api` (Django REST) y sigue la organización
**Feature-Sliced Design**.

## Requisitos
- Node 20+
- Backend `plasma3d-api` disponible (el proxy de Vite apunta a `VITE_BASE_URL`)

## Desarrollo
```bash
npm install
npm run dev        # http://localhost:FRONTEND_PORT (5173 por defecto)
```
El dev server **usa proxies** hacia el backend:
- `/api`, `/media`, `/static` → `VITE_BASE_URL` (por defecto `http://localhost:8000`)
- `/ws` → `VITE_WS_URL` (opcional, websockets)

Por eso la app usa una base relativa (`/`) y no hay problemas de CORS.

## Produccion
```bash
npm run build
npm run preview
```

## Variables de entorno
El `vite.config.ts` carga el `.env` de **la raiz del proyecto** (`envDir: '..'`), no un
`.env` local. Define ahí:
- `FRONTEND_PORT` — puerto del dev server / preview
- `VITE_BASE_URL` — target del proxy hacia Django y base de la API
- `VITE_WS_URL` — target del proxy de websockets (opcional)

Ver `.env.sample` en la raiz del proyecto.

## Estructura (FSD)
```
src/
├── app/        # bootstrap, router, providers
├── pages/      # pantallas por ruta
├── widgets/    # layout y visor/editor 3D
├── features/   # auth, payment, budget
├── entities/   # session, user, model3D, budget, media
└── shared/     # ui kit (Radix), api, config, lib
```

Ver [`docs/frontend-architecture.md`](../docs/frontend-architecture.md).
