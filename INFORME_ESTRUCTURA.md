# Estructura de Archivos y Origen de Datos para Producción - Plasma 3D (con Nginx Proxy Manager)

Este documento describe detalladamente la estructura de archivos que se debe subir al servidor y cómo cada contenedor lee y gestiona sus datos bajo un esquema de red administrado por **Nginx Proxy Manager** (NPM).

---

## 1. Estructura de Archivos para la Máquina Virtual (`192.168.0.97`)

Para desplegar el proyecto en la máquina virtual, debes transferir la siguiente estructura de archivos:

```text
plasma3d/                       # Directorio raíz del proyecto en la máquina virtual
├── docker-compose.db.yml           # Orquestación de la Base de Datos y PgAdmin
├── docker-compose.app.yml          # Orquestación del Backend (Django) y Frontend (Angular)
│
├── plasma3d_api/              # Código fuente del Backend
│   ├── plasma3d_api/           # Configuración principal de Django (settings.py, urls.py)
│   ├── weights/                    # Pesos de Inteligencia Artificial (CRÍTICO)
│   │   └── maskrcnn_15_epochs.h5   # Archivo de pesos descargado para inferencia 3D
│   ├── media/                      # Almacenamiento de imágenes y planos subidos
│   ├── Dockerfile                  # Receta de construcción de la imagen Python/Django
│   ├── requirements.txt            # Dependencias de Python
│   └── .env                        # Variables de entorno secretas del Backend
│
└── plasma3d_frontend/             # Código fuente del Frontend
    ├── src/                        # Código Angular (componentes, servicios, vistas)
    │   └── environments/
    │       └── environment.ts      # Endpoint por defecto compilado en Angular
    ├── .env.ts                     # Configuración del dominio de producción para Angular
    └── Dockerfile                  # Receta de construcción de Angular SSR (Node.js)
```

---

## 2. Origen de Datos de cada Contenedor (VM: `192.168.0.97`)

### A. Contenedor de Base de Datos (`postgres_db`)
* **Credenciales**: Lee de [docker-compose.db.yml](file:///c:/Users/brayan/Documents/Chamba/Software/plasma3d/docker-compose.db.yml) (`POSTGRES_USER`, `POSTGRES_PASSWORD`, etc.) en tiempo de ejecución.
* **Persistencia**: Se almacena en el volumen de Docker `pgdata`.
* **Puertos expuestos**: Puerto `5432` expuesto a la red local (para conexiones desde el Proxmox u otra máquina de desarrollo).

### B. Contenedor del Backend (`django_backend`)
* **Código**: Copiado al contenedor mediante el Dockerfile del backend y mapeado en caliente mediante volumen en desarrollo/producción.
* **Variables de Entorno**: Inyectadas desde [plasma3d_api/.env](file:///c:/Users/brayan/Documents/Chamba/Software/plasma3d/plasma3d_api/.env) gracias a la propiedad `env_file` (incluye llaves blockchain, Gemini API, CSRF y `STRIPE_API_KEY`).
* **Pesos del Modelo**: Lee localmente `/weights/maskrcnn_15_epochs.h5`.
* **Puertos expuestos**: Puerto `8000` expuesto a la red local para recibir llamadas desde Nginx Proxy Manager.

### C. Contenedor del Frontend (`angular_frontend`)
* **Endpoint API**: Toma `https://app.bratox.me/` desde [.env.ts](file:///c:/Users/brayan/Documents/Chamba/Software/plasma3d/plasma3d_frontend/.env.ts) y lo compila estáticamente.
* **Puertos expuestos**: Puerto `4000` expuesto a la red local para recibir llamadas desde Nginx Proxy Manager.

---

## 3. Flujo de Red de Nginx Proxy Manager (Proxmox: `192.168.0.210`)

Nginx Proxy Manager es el único punto de contacto público que tiene certificados SSL. Las peticiones se enrutan de la siguiente manera:

```text
                  ┌──────────────────────────────────────────────┐
                  │          Nginx Proxy Manager (Host)          │
                  │              (app.bratox.me)                 │
                  └──────────────┬────────────────┬──────────────┘
                                 │                │
                    (Ruta / o assets)         (Ruta /api/)
                                 │                │
                        ┌────────▼────────┐    ┌──▼──────────────┐
                        │  Front Angular  │    │  Back Django    │
                        │ 192.168.0.97:4000│    │192.168.0.97:8000 │
                        └─────────────────┘    └─────────────────┘
```
