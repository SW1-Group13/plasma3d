# Estructura de Archivos y Origen de Datos para Producción - Plasma 3D (con Nginx Proxy Manager)

Este documento describe detalladamente la estructura de archivos que se debe subir al servidor y cómo cada contenedor lee y gestiona sus datos bajo un esquema de red administrado por **Nginx Proxy Manager** (NPM).

---

## 1. Estructura de Archivos para la Máquina Virtual (`192.168.0.97`)

Para desplegar el proyecto en la máquina virtual, debes transferir la siguiente estructura de archivos:

```text
plasma3d/                           # Directorio raíz del proyecto en la máquina virtual
├── .env                            # Variables de entorno del proyecto (backend + frontend)
├── docker-compose.dev.yml          # Orquestación de desarrollo (postgres + api + web)
├── docker-compose.prod.yml         # Orquestación de producción (postgres + api + web + nginx)
├── nginx/
│   └── default.conf                # Reverse proxy (API + SPA)
│
├── plasma3d_api/                   # Código fuente del Backend
│   ├── plasma3d_api/               # Configuración principal de Django (settings.py, urls.py)
│   ├── weights/                    # Pesos de Inteligencia Artificial (CRÍTICO)
│   │   └── maskrcnn_15_epochs.h5   # Archivo de pesos descargado para inferencia 3D
│   ├── media/                      # Almacenamiento de imágenes y planos subidos
│   ├── static/                     # Estáticos del backend
│   ├── Dockerfile.dev              # Imagen de desarrollo (runserver)
│   ├── Dockerfile.prod             # Imagen de producción (gunicorn)
│   └── requirements.txt            # Dependencias de Python
│
└── plasma3d_web/                   # Código fuente del Frontend (React + Vite)
    ├── src/                        # Código fuente (FSD)
    ├── Dockerfile.dev              # Dev server de Vite
    ├── Dockerfile.prod             # Build + Nginx sirviendo la SPA
    ├── nginx.conf                  # Config del Nginx interno (puerto 5173)
    └── vite.config.ts              # Config de Vite (proxy + envDir)
```

---

## 2. Origen de Datos de cada Contenedor (VM: `192.168.0.97`)

### A. Contenedor de Base de Datos (`postgres`)
* **Credenciales**: Lee del [.env](file:///c:/Users/brayan/Documents/Chamba/Software/plasma3d/.env) (`POSTGRES_USER`, `POSTGRES_PASSWORD`, etc.) en tiempo de ejecución.
* **Persistencia**: Se almacena en el volumen de Docker `pgdata`.

### B. Contenedor del Backend (`plasma3d-api`)
* **Código**: Copiado al contenedor mediante `Dockerfile.dev`/`Dockerfile.prod`.
* **Variables de Entorno**: Inyectadas desde el [.env](file:///c:/Users/brayan/Documents/Chamba/Software/plasma3d/.env) de la raíz del proyecto gracias a la propiedad `env_file` (incluye Gemini API, CSRF y `STRIPE_API_KEY`).
* **Pesos del Modelo**: Lee localmente `/weights/maskrcnn_15_epochs.h5`.
* **Puertos expuestos**: Puerto `8000` expuesto a la red local para recibir llamadas desde Nginx Proxy Manager.

### C. Contenedor del Frontend (`plasma3d-web`)
* **App**: React + TypeScript + Vite (SPA), servida por Nginx en el puerto `5173`.
* **Endpoint API**: relativo (`/`), así que hereda el origen (`/api/...`). El proxy usa `VITE_BASE_URL`.
* **Puertos expuestos**: Puerto `5173` expuesto a la red local.

### D. Contenedor Reverse Proxy (`plasma3d-nginx`)
* **Puertos expuestos**: Puerto `80`; enruta `/` al frontend y `/api`, `/media`, `/static` al backend.

---

## 3. Flujo de Red de Nginx Proxy Manager (Proxmox: `192.168.0.210`)

Nginx Proxy Manager es el único punto de contacto público que tiene certificados SSL. Las peticiones se enrutan de la siguiente manera:

```text
                  ┌──────────────────────────────────────────────┐
                  │          Nginx Proxy Manager (Host)          │
                  │              (<TU_DOMINIO>)                 │
                  └──────────────┬────────────────┬──────────────┘
                                 │                │
                    (Ruta / o assets)         (Ruta /api/)
                                 │                │
                        ┌────────▼────────┐    ┌──▼──────────────┐
                        │ Front React SPA │    │  Back Django    │
                        │192.168.0.97:5173│    │192.168.0.97:8000│
                        └─────────────────┘    └─────────────────┘
```
