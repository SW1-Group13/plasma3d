# Guía de Despliegue con Nginx Proxy Manager (NPM) - Plan Risk 3D

Esta guía detalla la configuración paso a paso para desplegar y enrutar la aplicación usando **Nginx Proxy Manager** (alojado en tu Proxmox) para apuntar a la máquina virtual de la aplicación (`192.168.0.97`) usando un único dominio (`app.bratox.me`) y rutas `/api/`.

---

## Paso 1: Configurar el código localmente

1. **Modificar el Frontend**:
   Abre [front_plan_risk_3d/src/environments/environment.ts](file:///c:/Users/brayan/Documents/Chamba/Software/Plan_Risk_3D/front_plan_risk_3d/src/environments/environment.ts) y [.env.ts](file:///c:/Users/brayan/Documents/Chamba/Software/Plan_Risk_3D/front_plan_risk_3d/.env.ts):
   ```typescript
   export const environment = {
     endpoint: 'https://app.bratox.me/', // Tu dominio con HTTPS sin /api/ al final
     cloudinary: 'https://api.cloudinary.com/v1_1'
   }
   ```
2. **Configurar el archivo `.env` del Backend**:
   En tu archivo `.env` del backend (dentro de [back_plan_risk_3d/.env](file:///c:/Users/brayan/Documents/Chamba/Software/Plan_Risk_3D/back_plan_risk_3d/.env)), agrega y configura las variables:
   ```env
   CSRF_TRUSTED_ORIGINS=https://app.bratox.me,http://app.bratox.me
   CSRF_COOKIE_SECURE=True
   
   # Clave secreta de Stripe para producción (sk_live_...)
   STRIPE_API_KEY=tu_clave_secreta_stripe_aqui
   ```

---

## Paso 2: Iniciar los Contenedores en la Máquina Virtual (`192.168.0.97`)

En tu máquina virtual, asegúrate de levantar los servicios exponiendo los puertos locales `8000` (Backend) y `4000` (Frontend) al host:

1. Levanta la Base de Datos:
   ```bash
   docker-compose -f docker-compose.db.yml up -d
   ```
2. Levanta Django y Angular (los cuales ya tienen los puertos expuestos `8000` y `4000` en tu [docker-compose.app.yml](file:///c:/Users/brayan/Documents/Chamba/Software/Plan_Risk_3D/docker-compose.app.yml)):
   ```bash
   docker compose -f docker-compose.app.yml up --build -d
   ```

---

## Paso 3: Configurar Nginx Proxy Manager (NPM) en Proxmox

Entra al panel web de tu Nginx Proxy Manager y edita/crea el host de proxy para `app.bratox.me`:

### A. Pestaña "Details" (Configurar Frontend por defecto)
* **Domain Names**: `app.bratox.me`
* **Scheme**: `http`
* **Forward Hostname / IP**: `192.168.0.97` *(IP de la máquina virtual)*
* **Forward Port**: `4000` *(Puerto de Angular SSR)*
* Activa **Websockets Support** (Requerido para la actualización en vivo de Angular y desarrollo).

*Cualquier petición general al dominio sin ruta `/api/` cargará el frontend.*

---

### B. Pestaña "Custom Locations" (Enrutar al Backend)
Añade las siguientes ubicaciones para redirigir las llamadas de la API y administración al backend de Django:

1. **Location: `/api/`**
   * **Scheme**: `http`
   * **Forward Hostname / IP**: `192.168.0.97`
   * **Forward Port**: `8000` *(Puerto de Django)*
2. **Location: `/admin/`**
   * **Scheme**: `http`
   * **Forward Hostname / IP**: `192.168.0.97`
   * **Forward Port**: `8000`
3. **Location: `/static/`**
   * **Scheme**: `http`
   * **Forward Hostname / IP**: `192.168.0.97`
   * **Forward Port**: `8000`
4. **Location: `/media/`**
   * **Scheme**: `http`
   * **Forward Hostname / IP**: `192.168.0.97`
   * **Forward Port**: `8000`

---

### C. Pestaña "SSL"
* Selecciona tu certificado SSL de **Let's Encrypt** para `app.bratox.me`.
* Activa **Force SSL** para forzar HTTPS.
* Activa **HTTP/2 Support**.

---

## Paso 4: Eliminar archivos innecesarios
Ya no necesitas el archivo `nginx.conf` en la raíz de tu proyecto, ya que Nginx Proxy Manager se encarga de todo el enrutamiento visualmente desde Proxmox. Puedes borrarlo con seguridad.
