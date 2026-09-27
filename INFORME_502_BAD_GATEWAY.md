# Informe de Análisis: Error 502 Bad Gateway en `/api/users/auth/registro/`

Este informe detalla las causas del error **`502 Bad Gateway`** al realizar peticiones POST a la ruta del backend y los pasos para diagnosticarlo y corregirlo.

---

## 1. ¿Qué significa un error "502 Bad Gateway"?

Nginx Proxy Manager (NPM) es el intermediario (Gateway) entre internet y los contenedores. El error 502 significa:

> **"Nginx Proxy Manager recibió la petición, pero al redirigirla a `plasma3d-nginx`/`plasma3d-api`, el backend no respondió o está apagado."**

```text
[Cliente en Internet]
        │
        ▼ (POST a https://<TU_DOMINIO>/api/users/auth/registro/)
[Nginx Proxy Manager (192.168.0.210)]
        │
        ▼ (http://192.168.0.97:80 → plasma3d-nginx)
[ plasma3d-nginx ] ──► /api/ ──► [ plasma3d-api :8000 ]
        │
        ▼ (si el backend no responde)
    [ ERROR 502 ]
```

---

## 2. Causas más probables del fallo de Django

El contenedor `plasma3d-api` en la VM (`192.168.0.97`) probablemente se detuvo o falló al iniciar. Causas comunes:

### A. Fallo en las Migraciones de la Base de Datos
En `docker-compose.prod.yml`, el comando de inicio ejecuta las migraciones antes de arrancar gunicorn:
```bash
python manage.py migrate && gunicorn plasma3d_api.wsgi:application ...
```
Si PostgreSQL no estaba listo para recibir conexiones, `migrate` falló y el contenedor se apagó.

### B. El contenedor no está corriendo
Si hubo un error de dependencias, falta del archivo de pesos o variables en el `.env`, el contenedor se habrá cerrado.

### C. Bloqueo de Firewall
El firewall de la VM no permite conexiones al puerto `80` (o `8000`) desde Nginx Proxy Manager.

---

## 3. Guía Paso a Paso para Diagnosticar y Solucionar

Conéctate por SSH a la máquina virtual (`192.168.0.97`):

### Paso A: Verificar si el contenedor está corriendo
```bash
docker ps
```
* Si `plasma3d-api` no aparece: se detuvo por un error de arranque.

### Paso B: Leer los logs de error de Django
```bash
docker logs plasma3d-api
```
*(Aquí verás si falló la conexión a la base de datos, si falta una variable en el `.env`, o un error de sintaxis en Python).*

### Paso C: Forzar reinicio y recreación
```bash
docker compose -f docker-compose.prod.yml restart plasma3d-api
```
Si modificaste el `.env`, reconstruye:
```bash
docker compose -f docker-compose.prod.yml up --build -d
```

### Paso D: Verificar el firewall de la VM
```bash
sudo ufw allow 80/tcp
sudo ufw allow 8000/tcp
sudo ufw allow 5173/tcp
```
