# Plasma3D — nginx de borde

Punto de entrada único del despliegue. La configuración activa es
**`default.conf`** y sirve **`https://plasma3d.sebaces.fyi`**.

## Rutas

| Ruta | Destino |
|---|---|
| `/` | `plasma3d-web:5173` (SPA React) |
| `/api/` | `plasma3d-api:8000` (Django REST) |
| `/media/` | `plasma3d-api:8000` (archivos subidos) |
| `/static/` | `plasma3d-api:8000` (estáticos Django) |
| `/ws/` | `plasma3d-api:8000` (WebSocket) |
| `/.well-known/acme-challenge/` | `/var/www/certbot` (Let's Encrypt) |

## Archivos

- **`default.conf`** — configuración activa: HTTP→HTTPS, TLS y proxies.
- **`https.conf.example`** — plantilla para otros dominios.
- **`HTTPS.md`** — emisión, renovación y verificación del certificado.
- **`Dockerfile`** — imagen `nginx:stable-alpine` con `default.conf` (opcional;
  el compose usa `nginx:alpine` y monta el archivo).

## Despliegue

```bash
# Desde la raíz del repositorio
docker compose -f docker-compose.prod.yml up -d --build
```

El borde publica **80** y **443**. El frontend (`plasma3d-web`) ya **no**
publica el 5173 al exterior; solo es accesible por la red interna.

Antes del primer arranque necesitas el certificado. Sigue
[`HTTPS.md`](HTTPS.md).

## Puertos / firewall

En el servidor (o Security Group de AWS) deben estar abiertos:

| Puerto | Uso |
|---|---|
| 22 | SSH |
| 80 | Redirección a HTTPS y retos ACME |
| 443 | HTTPS |
