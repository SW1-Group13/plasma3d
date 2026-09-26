# Informe de Análisis: Error 502 Bad Gateway en `/api/users/auth/registro/`

Este informe detalla las causas del error **`502 Bad Gateway`** al intentar realizar peticiones POST a la ruta del backend y describe los pasos necesarios para diagnosticarlo y corregirlo en tu servidor.

---

## 1. ¿Qué significa un error "502 Bad Gateway"?

En tu arquitectura, Nginx Proxy Manager (NPM) es el intermediario (Gateway) entre internet y tus contenedores. El error 502 significa:

> **"Nginx Proxy Manager recibió tu petición correctamente, pero al intentar redirigirla a la máquina virtual (`http://192.168.0.97:8000`), el servidor del backend no respondió o está apagado."**

```text
[Cliente en Internet]
        │
        ▼ (POST a https://app.bratox.me/api/users/auth/registro/)
[Nginx Proxy Manager (192.168.0.210)]
        │
        ▼ (Intenta conectar a http://192.168.0.97:8000)
    [ ERROR 502: El backend no responde / está apagado ]
```

---

## 2. Causas más probables del fallo de Django

Dado que el error es en el puerto `8000`, el contenedor de Django en tu VM (`192.168.0.97`) probablemente se ha detenido o ha fallado al iniciar. Las tres causas más comunes son:

### A. Fallo en las Migraciones de la Base de Datos
En tu [docker-compose.app.yml](file:///c:/Users/brayan/Documents/Chamba/Software/Plan_Risk_3D/docker-compose.app.yml), el comando de inicio ejecuta las migraciones antes de arrancar el servidor:
```bash
python manage.py makemigrations && python manage.py migrate && python manage.py runserver
```
Si la base de datos PostgreSQL no estaba lista aún para recibir conexiones cuando se inició Django, el comando `migrate` falló y provocó que el contenedor de Django **se apagara de forma inmediata**.

### B. El contenedor de Django no está corriendo
Si hubo algún error de dependencias, falta de archivo de pesos, o variables en el `.env`, el contenedor se habrá cerrado.

### C. Bloqueo de Firewall en la VM
El firewall del sistema operativo de tu VM (`192.168.0.97`) no permite conexiones externas al puerto `8000` desde el exterior (Nginx Proxy Manager).

---

## 3. Guía Paso a Paso para Diagnosticar y Solucionar

Para resolver el problema, conéctate por SSH a tu máquina virtual (`192.168.0.97`) y ejecuta los siguientes comandos de diagnóstico:

### Paso A: Verificar si el contenedor de Django está corriendo
Ejecuta:
```bash
docker ps
```
* **Si `django_backend` no aparece en la lista**: Significa que el contenedor se detuvo debido a un error de arranque.
* **Si aparece**: Pasa directamente al Paso C.

### Paso B: Leer los logs de error de Django
Si el contenedor se detuvo, puedes ver el motivo exacto de la caída leyendo los últimos logs del contenedor:
```bash
docker logs django_backend
```
*(Aquí verás si falló la conexión a la base de datos, si falta una variable de entorno en el `.env`, o si hay un error de sintaxis en Python).*

### Paso C: Forzar reinicio y recreación
Si el error fue debido a la base de datos no estando lista en el primer arranque, un reinicio del contenedor resolverá el problema ya con la base de datos en línea:
```bash
docker compose -f docker-compose.app.yml restart web
```
Si realizaste modificaciones en el `.env` del backend, es mejor reconstruir los contenedores:
```bash
docker compose -f docker-compose.app.yml up --build -d
```

### Paso D: Verificar el firewall de la VM
Asegúrate de que la VM acepte peticiones desde tu red local en el puerto `8000`. Si usas Ubuntu, puedes habilitarlo con:
```bash
sudo ufw allow 8000/tcp
sudo ufw allow 4000/tcp
```
