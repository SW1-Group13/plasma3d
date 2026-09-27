<div align="center" width="100">
  <h1>Plasma3D</h1>
</div>

## 🏗 Estructura del proyecto

Backend `plasma3d_api` desarrollado con Django <br>
Frontend `plasma3d_web` en React + TypeScript.

```
plasma3d/
├── plasma3d_api/              # Backend (Django)
│   ├── app/                   # Código principal de la API
│   ├── requirements.txt       # Dependencias Python
│   ├── Dockerfile.dev         # Imagen para desarrollo
│   └── ...
│
├── plasma3d_web/              # Frontend (React + TypeScript)
│   ├── src/                   # Código fuente del frontend
│   ├── Dockerfile.dev         # Imagen para desarrollo
│   └── ...
│
├── .env                       # Variables de entorno (desarrollo)
├── .env.sample                # Ejemplo de variables de entorno
├── docker-compose.dev.yml         # Orquestación para desarrollo
└── README.md
```


### Servicios (Docker)

| Servicio | Tecnología      | Puerto | Descripción   |
| -------- | --------------- | ------ | ------------- |
| serv-web | React + Vite    | 5173   | Interfaz web  |
| serv-api | Django          | 8000   | API REST      |
| serv-db  | PostgreSQL      | 5432   | Base de datos |

---

### 🧯 Comandos Docker
En la raíz ejecutar
```bash
cp .env.sample .env
```

```bash
# Iniciar servicios
docker compose -f docker-compose.dev.yml up --build

# Iniciar en background
docker compose -f docker-compose.dev.yml up --build -d

# Ver logs
docker compose logs -f

# Detener servicios
docker compose -f docker-compose.dev.yml down

# Resetear base de datos
docker compose -f docker-compose.dev.yml down -v

# Eliminar container, network, volumes sin uso
docker container prune
docker network prune
docker volume prune
```

## 🧯 Ejecutar DevContainer en VSCode

### ⚠️ Instalar Dev Containers en VSCODE

1. **En VSCode**
  Abrir `plasma3d_api` o `plasma3d_web`.

2. **En otra ventana ejecutar la base de datos (solo para plasma3d_api)**

  ```bash
  docker compose up --build serv-plasma3d-db
  ```

3. **Abrir el Command Palette**

  - Presiona `Ctrl + Shift + P`.
  - Busca y selecciona la opción `Dev Containers: Reopen in Container.`

4. **Ejecutar proyectos**

  - En `plasma3d_api`

    ```bash
    python manage.py migrate
    python manage.py runserver 0.0.0.0:8000
    ```

  - En `plasma3d_web`

    ```bash
    npm install
    npm run dev
    ```

  - ¡Listo!

---

## ⚙️ Configuración previa del Backend

### 1. Crear la carpeta `/weights` en la raíz del back

Dentro de `plasma3d_api/` crear la carpeta:

```
plasma3d_api/
└── weights/
```

Y pegar dentro el siguiente archivo:

🔗 [Descargar modelo desde Google Drive](https://drive.google.com/file/d/14fDV0b_sKDg0_DkQBTyO1UaT6mHrW9es/view)

### 2. Deshabilitar el chequeo de versión de HDF5 (antes de correr el back)

Es necesario quitar el chequeo de versión de HDF5 para evitar conflictos al cargar el modelo.

**Windows (PowerShell):**
```powershell
$env:HDF5_DISABLE_VERSION_CHECK = '2'
```

**Linux / macOS (bash/zsh):**
```bash
export HDF5_DISABLE_VERSION_CHECK=2
```

---


<div align="center" width="100">
  <h1>Stack</h1>
  </br>
  <h3>Languages and Frameworks</h3>
  <img
    src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/python/python-original.svg"
    width="60px"
    alt="Python">
  <img
    src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/django/django-plain.svg"
    width="60px"
    alt="Django">
  <img
    src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/react/react-original.svg"
    width="60px"
    alt="React">
  <img
    src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/typescript/typescript-original.svg"
    width="60px"
    alt="TypeScript">
  <img
    src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/vitejs/vitejs-original.svg"
    width="60px"
    alt="Vite">
  <img
    src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/postgresql/postgresql-original-wordmark.svg"
    width="60px"
    alt="PostgreSQL">
  <img
    src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/html5/html5-original-wordmark.svg"
    width="60px"
    alt="HTML5">
    &nbsp;&nbsp;&nbsp;&nbsp;
  <img
    src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/css3/css3-original-wordmark.svg"
    width="60px"
    alt="CSS3">
    &nbsp;&nbsp;&nbsp;&nbsp;
  <img
    src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/tailwindcss/tailwindcss-original.svg"
    width="60px"
    alt="Tailwind CSS">

  </br>
  </br>
  <h3>Tools</h3>
  <img
    src="https://cdn.simpleicons.org/jira/0052CC"
    width="55px"
    alt="Jira">
  <img
    src="https://cdn.simpleicons.org/github/FFFFFF"
    width="50px"
    alt="GitHub Logo White">
  <img
    src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/docker/docker-original-wordmark.svg"
    width="60px"
    alt="Docker">
    &nbsp;&nbsp;&nbsp;&nbsp;
  <img
    src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/git/git-original-wordmark.svg"
    width="65px"
    alt="Git Wordmark">
  <img
    src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/vscode/vscode-original-wordmark.svg"
    width="60px"
    alt="VS Code">
    &nbsp;&nbsp;&nbsp;&nbsp;
</div>
<hr>

last modified: 27/09/2026