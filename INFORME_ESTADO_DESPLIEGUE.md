# Informe de Estado de Despliegue - Plan Risk 3D

Este informe resume el estado actual del despliegue en tu máquina virtual (`192.168.0.97`) tras la ejecución de las tareas de compilación, levantamiento y configuración del firewall.

---

## 1. Estado de los Contenedores (Docker status)

Todos los contenedores del ecosistema de Plan Risk 3D se encuentran **activos y estables (Up 3 minutes)**:

| Contenedor | Imagen | Estado | Puertos Mapeados | Propósito |
| :--- | :--- | :--- | :--- | :--- |
| **`django_backend`** | `software1-web` | **Up 3 minutes** | `8000 ➔ 8000` | Servidor API de Django |
| **`angular_frontend`** | `software1-angular-app` | **Up 3 minutes** | `4000 ➔ 4000` | Frontend SSR (Angular) |
| **`postgres_db`** | `postgres:17` | **Up 56 min (healthy)** | `5432 ➔ 5432` | Base de Datos PostgreSQL |
| **`pgadmin`** | `dpage/pgadmin4` | **Up 56 minutes** | `5050 ➔ 80` | Panel de Control DB |

* **Logs de Angular**: El frontend está en ejecución y escuchando solicitudes en el puerto interno:
  ```text
  Node Express server listening on http://localhost:4000
  ```

---

## 2. Configuración de Firewall (UFW)

Se añadieron correctamente las excepciones de seguridad en la máquina virtual:
* **Puerto `8000/tcp`**: Habilitado (Entrada permitida para el Backend).
* **Puerto `4000/tcp`**: Habilitado (Entrada permitida para el Frontend).

*Esto garantiza que Nginx Proxy Manager (desde la IP `192.168.0.210`) pueda conectarse sin restricciones a la máquina virtual `192.168.0.97`.*

---

## 3. Pruebas de Verificación Finales (Siguientes Pasos)

Ahora que los contenedores están arriba y el firewall está configurado:

1. **Prueba de Acceso General**:
   Abre un navegador en modo incógnito e ingresa a tu dominio:
   👉 **`https://app.bratox.me`**
   *Debería cargar la interfaz visual de Angular sin problemas.*

2. **Prueba de Registro de Usuario**:
   Intenta registrar un nuevo usuario en la aplicación:
   * Abre la consola de desarrollador del navegador (`F12`).
   * Rellena el formulario de registro y haz clic en Enviar.
   * **Resultado esperado**: La petición POST a `https://app.bratox.me/api/users/auth/registro/` debería responder con código `200` o `201` y redireccionar correctamente.

3. **Verificación de Imágenes**:
   Verifica que los logos, imágenes estáticas y planos carguen correctamente.
