# Plasma 3D - Backend

Este es el backend del proyecto Plasma 3D, desarrollado en Django.

## Requisitos Previos

1. **Pesos del Modelo (Weights)**:
   Asegúrate de tener el archivo de pesos `maskrcnn_15_epochs.h5` en la carpeta `plasma3d_api/weights/`.
   Si no lo tienes, puedes descargarlo de este [enlace de Google Drive](https://drive.google.com/file/d/14fDV0b_sKDg0_DkQBTyO1UaT6mHrW9es/view) y guardarlo en dicha ruta.

---

## Opción 1: Ejecución con Docker (Recomendado)

Levanta la base de datos PostgreSQL, el backend Django y el frontend React + Vite.

1. **Desarrollo**:
   ```bash
   docker compose -f docker-compose.dev.yml up --build
   ```
   *Nota: Las migraciones y el arranque del servidor de desarrollo se realizan automáticamente.*
   - Backend: http://localhost:8000
   - Frontend: http://localhost:5173

2. **Producción** (incluye `plasma3d-nginx` en el puerto 80):
   ```bash
   docker compose -f docker-compose.prod.yml up --build -d
   ```

---

## Opción 2: Ejecución Local (con Conda/Pip)

Si prefieres correr el backend en tu entorno local sin usar el contenedor de Django:

1. **Crear y activar el entorno Conda**:
   ```bash
   conda env create -f environment_full.yml
   conda activate imageTo3D
   ```

2. **Instalar dependencias de Python**:
   ```bash
   pip install -r requirements.txt
   pip install djangorestframework-simplejwt
   ```

3. **Iniciar la base de datos PostgreSQL en Docker** (para evitar la instalación local de Postgres):
   ```bash
   docker compose -f docker-compose.dev.yml up -d postgres
   ```

4. **Configurar el archivo `.env`**:
   En el archivo [.env](file:///c:/Users/brayan/Documents/Chamba/Software/plasma3d/.env) de la raíz del proyecto, añade la variable `POSTGRES_HOST=localhost` para que Django se conecte localmente al puerto expuesto de PostgreSQL:
   ```env
   POSTGRES_HOST=localhost
   ```

5. **Configurar la variable HDF5 en Windows** (Evita errores de incompatibilidad de versión de HDF5):
   - **En PowerShell**:
     ```powershell
     $env:HDF5_DISABLE_VERSION_CHECK = '2'
     ```
   - **En CMD**:
     ```cmd
     set HDF5_DISABLE_VERSION_CHECK=2
     ```

6. **Ejecutar migraciones y arrancar el servidor Django**:
   ```bash
   python manage.py migrate
   python manage.py runserver
   ```
