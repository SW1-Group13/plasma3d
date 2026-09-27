# Guía de Despliegue con Nginx Proxy Manager (NPM) - Plasma 3D

Esta guía detalla la configuración paso a paso para desplegar y enrutar la aplicación usando **Nginx Proxy Manager** (alojado en tu Proxmox) para apuntar a la máquina virtual de la aplicación (`192.168.0.97`) usando un único dominio (`<TU_DOMINIO>`).

---

## Arquitectura

El stack de producción (`docker-compose.prod.yml`) expone un único punto de entrada: **`plasma3d-nginx`** (puerto `80`), que enruta:

- `/` → `plasma3d-web` (React + Vite, SPA servida por su Nginx interno en `5173`)
- `/api`, `/media`, `/static` → `plasma3d-api` (Django, `8000`)

El frontend usa una base relativa (`VITE_API_BASE=/`), por lo que no hay dominio ni endpoint hardcodeados.

---

## Paso 1: Configurar el `.env` (raíz del proyecto)

En el archivo [.env](file:///c:/Users/brayan/Documents/Chamba/Software/plasma3d/.env) de la raíz, define para tu dominio:

```env
CSRF_TRUSTED_ORIGINS=https://<TU_DOMINIO>,http://<TU_DOMINIO>
CSRF_COOKIE_SECURE=True

# Clave secreta de Stripe para producción (sk_live_...)
STRIPE_API_KEY=tu_clave_secreta_stripe_aqui
```

El backend permite todos los hosts (`ALLOWED_HOSTS=['*']` en `settings.py`).

---

## Paso 2: Iniciar los Contenedores en la Máquina Virtual (`192.168.0.97`)

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

Servicios y puertos host: `plasma3d-nginx` (`80`), `plasma3d-api` (`8000`), `plasma3d-web` (`5173`), `postgres` (solo red interna).

---

## Paso 3: Configurar Nginx Proxy Manager (NPM) en Proxmox

Entra al panel web de tu Nginx Proxy Manager y crea/edita el Proxy Host para `<TU_DOMINIO>`:

### A. Pestaña "Details"
* **Domain Names**: `<TU_DOMINIO>`
* **Scheme**: `http`
* **Forward Hostname / IP**: `192.168.0.97` *(IP de la máquina virtual)*
* **Forward Port**: `80` *(plasma3d-nginx)*
* Activa **Websockets Support**

### B. Pestaña "SSL"
* Selecciona tu certificado SSL de **Let's Encrypt** para `<TU_DOMINIO>`.
* Activa **Force SSL**.
* Activa **HTTP/2 Support**.

No necesitas **Custom Locations**: `plasma3d-nginx` ya enruta `/api`, `/media`, `/static` y `/` hacia los servicios correspondientes.
