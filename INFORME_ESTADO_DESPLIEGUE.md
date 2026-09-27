# Informe de Estado de Despliegue - Plasma 3D

Este informe resume el estado del despliegue en la máquina virtual (`192.168.0.97`) con los contenedores de compilación, levantamiento y configuración de firewall.

---

## 1. Estado de los Contenedores (Docker status)

| Contenedor | Imagen | Puertos | Propósito |
| :--- | :--- | :--- | :--- |
| **`plasma3d-api`** | build `plasma3d_api/Dockerfile.prod` | `8000 ➔ 8000` | API Django (gunicorn) |
| **`plasma3d-web`** | build `plasma3d_web/Dockerfile.prod` | `5173 ➔ 5173` | Frontend React + Vite (SPA, Nginx) |
| **`plasma3d-nginx`** | `nginx:alpine` | `80 ➔ 80` | Reverse proxy (API + SPA) |
| **`postgres`** | `postgres:17` | interno | Base de Datos PostgreSQL |

* **Frontend**: Nginx sirviendo la SPA en el puerto interno `5173`.
  ```text
  nginx ready
  ```

---

## 2. Configuración de Firewall (UFW)

Excepciones de seguridad en la máquina virtual:
* **Puerto `80/tcp`**: Entrada permitida (Nginx interno / entrada general).
* **Puerto `8000/tcp`**: Entrada permitida (Backend).
* **Puerto `5173/tcp`**: Entrada permitida (Frontend).

*Esto garantiza que Nginx Proxy Manager (desde la IP `192.168.0.210`) pueda conectarse sin restricciones a la máquina virtual `192.168.0.97`.*

---

## 3. Pruebas de Verificación Finales

1. **Prueba de Acceso General**:
   Abre un navegador en modo incógnito e ingresa a tu dominio:
   👉 **`https://<TU_DOMINIO>`**
   *Debería cargar la interfaz visual de Plasma3D (React).*

2. **Prueba de Registro de Usuario**:
   * Abre la consola de desarrollador del navegador (`F12`).
   * Rellena el formulario de registro y haz clic en Enviar.
   * **Resultado esperado**: La petición POST a `https://<TU_DOMINIO>/api/users/auth/registro/` debería responder con código `200` o `201`.

3. **Verificación de Imágenes**:
   Verifica que los logos, imágenes estáticas y planos carguen correctamente (`/media/...`).
