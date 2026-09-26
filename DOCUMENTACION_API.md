# Documentación de Endpoints de la API - Plasma 3D

Esta guía contiene la lista de todas las rutas configuradas en la API del backend para realizar pruebas desde clientes como **Postman**, **Bruno** o **Insomnia**.

## Configuración Base

* **Dominio en Producción (con SSL/Nginx Proxy Manager)**: `https://app.bratox.me`
* **Entorno de Red Local (Directo al Backend)**: `http://192.168.0.97:8000`

---

## 1. Módulo de Autenticación y Usuarios (`/api/users/`)

Este módulo gestiona la creación de cuentas, inicio de sesión (mediante tokens JWT) y suscripción mediante pasarela de Stripe.

| Método | Endpoint | Tipo de Body | Estructura / Parámetros del Body (JSON) | Descripción |
| :---: | :--- | :---: | :--- | :--- |
| **POST** | `/api/users/auth/registro/` | JSON | `{ "nombre": "...", "email": "...", "password": "...", "rol": "usuario_normal", "telefono": 123456 }` | Registra una nueva cuenta de usuario en el sistema. |
| **POST** | `/api/users/auth/login/` | JSON | `{ "email": "...", "password": "..." }` | Inicia sesión y devuelve los tokens JWT (`access` y `refresh`) junto con el perfil del usuario. |
| **POST** | `/api/users/auth/logout/` | JSON | `{ "refresh": "..." }` | Invalida el token refresh y finaliza la sesión activa. |
| **PATCH/PUT** | `/api/users/auth/usuario/update/<int:id>/` | JSON | `{ "nombre": "...", "telefono": ... }` | Actualiza los datos de perfil de un usuario específico. |
| **GET** | `/api/users/usuarios/` | - | *Requiere Token de Portador (Bearer Token)* | Lista todos los usuarios registrados (Acceso Restringido a Administradores). |
| **GET** | `/api/users/usuarios/<int:id>/` | - | *Requiere Token de Portador (Bearer Token)* | Obtiene los detalles de perfil completos de un usuario específico. |
| **POST** | `/api/users/payment/process/` | JSON | `{ "payment_method_id": "pm_...", "plan": "premium" }` | Procesa un pago de suscripción para el plan Premium a través de Stripe. |

---

## 2. Módulo de Generación e Inferencia 3D (`/api/set_plan/`)

Gestiona la subida de planos 2D para ser procesados por la red neuronal Mask R-CNN, y la generación de archivos 3D (.glb).

| Método | Endpoint | Tipo de Body | Parámetros del Body | Descripción |
| :---: | :--- | :---: | :--- | :--- |
| **POST** | `/api/set_plan/plans/` | **form-data** | `plan_file` (Archivo: PDF/DXF/PNG/JPG)<br>`usuario` (ID del usuario) | Sube un plano de construcción 2D, ejecuta la inferencia de IA, genera el GLB y guarda el trabajo. |
| **POST** | `/api/set_plan/plans_json/` | JSON | `{ "detections": { ... }, "usuario": id }` | Registra directamente los resultados de inferencia en formato JSON (omitiendo procesamiento). |
| **GET** | `/api/set_plan/lista_modelos/` | - | - | Retorna la lista de todos los trabajos y modelos 3D generados. |
| **POST** | `/api/set_plan/generate_dynamic_glb/` | JSON | `{ "detections": { ... } }` | Genera y devuelve un modelo 3D GLB al vuelo en base a un listado JSON de detecciones (paredes, puertas, etc). |
| **POST** | `/api/set_plan/validar_plano/` | **form-data** | `file` (Archivo plano 2D) | Valida si un archivo de plano tiene una extensión y formato compatible antes de cargarlo formalmente. |
| **POST** | `/api/set_plan/reemplazar_glb/` | **form-data** | `job_id` (ID del Job)<br>`glb_file` (Archivo .glb real) | Sobrescribe manualmente el modelo GLB generado por la IA con un archivo .glb local personalizado. |

---

## 3. Módulo de Carga Directa 3D (`/api/view_model/`)

Proporciona un endpoint rápido para almacenar modelos GLB en el servidor directamente.

| Método | Endpoint | Tipo de Body | Parámetros del Body | Descripción |
| :---: | :--- | :---: | :--- | :--- |
| **POST** | `/api/view_model/upload-glb/` | **form-data** | `file` (Archivo .glb)<br>`usuario` (ID de usuario) | Sube y almacena un modelo GLB en el servidor, vinculándolo a un usuario. |

---

## 4. Módulo de Presupuestos (`/api/presupuesto/`)

Calcula costos y cubicaciones basándose en las detecciones y medidas de los planos.

| Método | Endpoint | Tipo de Body | Estructura del Body (JSON) | Descripción |
| :---: | :--- | :---: | :--- | :--- |
| **GET** | `/api/presupuesto/` | - | - | Endpoint de prueba rápido para confirmar la disponibilidad del servicio. |
| **POST** | `/api/presupuesto/calcular/` | JSON | `{ "areas": [ ... ], "materiales": [ ... ] }` | Estima la cantidad y costo de materiales (cemento, ladrillos, arena) según las paredes y áreas del plano. |
| **POST** | `/api/presupuesto/materiales/cargar/` | JSON | `{ "materiales": [ { "nombre": "ladrillo", "precio_unitario": 0.50 }, ... ] }` | Configura y actualiza el listado maestro de materiales y sus costos base. |

---

## 5. Módulo de Análisis de Riesgos (`/api/suggestion_risk/`)

Evalúa los planos procesados para determinar áreas de riesgo estructurales.

| Método | Endpoint | Tipo de Body | Estructura del Body (JSON) | Descripción |
| :---: | :--- | :---: | :--- | :--- |
| **POST** | `/api/suggestion_risk/analizar/` | JSON | `{ "job_id": id }` o `{ "detections": { ... } }` | Analiza el modelo en base a reglas estructurales y devuelve sugerencias y riesgos detectados. |

---

## Guía de Pruebas en Postman / Bruno

### 1. Manejo del Bearer Token (JWT)
Muchas rutas protegidas de la API requieren que el usuario esté autenticado. Sigue estos pasos para autenticar tus peticiones:
1. Envía una petición `POST` al endpoint de login `/api/users/auth/login/` con las credenciales correspondientes.
2. Copia el valor de la clave `access` del cuerpo de la respuesta.
3. En la petición protegida en Postman o Bruno:
   * Ve a la pestaña **Headers** y añade:
     * **Key**: `Authorization`
     * **Value**: `Bearer <TU_ACCESS_TOKEN>`
   * O utiliza la pestaña **Auth** -> selecciona **Bearer Token** e ingresa el token directamente en el campo.

### 2. Configuración de Subida de Archivos (`form-data`)
Para los endpoints que reciben archivos (como planos o modelos GLB):
1. En Postman o Bruno, ve a la pestaña **Body** y selecciona **form-data**.
2. Añade los nombres de los parámetros en la columna **Key** (ejemplo: `plan_file`).
3. Cambia el tipo del campo de **Text** a **File** (en Postman esto se hace posicionando el cursor a la derecha del campo Key; en Bruno, seleccionando el selector de tipo de variable).
4. En el campo **Value**, haz clic en el botón para explorar archivos y selecciona el plano desde tu almacenamiento local.
