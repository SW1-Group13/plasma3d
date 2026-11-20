# HTTPS con Let's Encrypt — `plasma3d.sebaces.fyi`

Dominio: **https://plasma3d.sebaces.fyi**

La configuración activa está en [`default.conf`](default.conf) y el borde
(`plasma3d-nginx`) monta:

- `/etc/letsencrypt` del host (certificados, solo lectura).
- `./nginx/certbot-www` del proyecto en `/var/www/certbot` (retos ACME).

---

## 1. Requisitos previos

1. **DNS:** el dominio `plasma3d.sebaces.fyi` debe apuntar (registro `A`) a la
   IP pública del servidor.
2. **Puertos abiertos:** 80 (HTTP/ACME) y 443 (HTTPS) en el firewall o
   Security Group.
3. **Certbot en el host:**

   ```bash
   sudo apt update
   sudo apt install certbot -y
   ```

---

## 2. Emitir el certificado por primera vez

El puerto 80 debe estar libre, así que se detiene el borde (el resto de
servicios puede seguir arriba):

```bash
docker compose -f docker-compose.prod.yml stop plasma3d-nginx

sudo certbot certonly --standalone -d plasma3d.sebaces.fyi
```

Certbot pedirá un email y aceptar los términos. Los archivos quedan en:

```text
/etc/letsencrypt/live/plasma3d.sebaces.fyi/fullchain.pem
/etc/letsencrypt/live/plasma3d.sebaces.fyi/privkey.pem
```

---

## 3. Levantar el despliegue con HTTPS

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Comprueba:

```bash
curl -I https://plasma3d.sebaces.fyi
openssl s_client -connect plasma3d.sebaces.fyi:443 -servername plasma3d.sebaces.fyi </dev/null 2>/dev/null | openssl x509 -noout -subject -dates
```

---

## 4. Cambiar la renovación a `webroot` (sin cortar el servicio)

La emisión inicial usa `standalone`, que necesita el puerto 80 libre. Para que
las **renovaciones automáticas** funcionen con nginx en marcha, vuelve a emitir
usando `webroot` una vez:

```bash
sudo certbot certonly --webroot \
  -w "$(pwd)/nginx/certbot-www" \
  -d plasma3d.sebaces.fyi \
  --force-renewal
```

Esto guarda el método `webroot` en la configuración de renovación de Certbot.
Comprueba el simulacro:

```bash
sudo certbot renew --dry-run
```

> El servicio `plasma3d-nginx` recarga nginx cada 6 horas para tomar el
> certificado renovado. También puedes forzar la recarga con:
>
> ```bash
> docker compose -f docker-compose.prod.yml exec plasma3d-nginx nginx -s reload
> ```

---

## 5. CORS y CSRF

En producción el dominio debe estar permitido. El `docker-compose.prod.yml` ya
lo define para la API:

```env
CORS_ALLOWED_ORIGINS=https://plasma3d.sebaces.fyi
CSRF_TRUSTED_ORIGINS=https://plasma3d.sebaces.fyi,http://plasma3d.sebaces.fyi
CSRF_COOKIE_SECURE=True
```

Si ejecutas el backend fuera de Docker, pon esos valores también en `.env`.
El `.env` local puede seguir usando `http://localhost:5173`.

---

## 6. Stripe (opcional)

Si usas webhooks, configura en el Dashboard de Stripe:

```text
https://plasma3d.sebaces.fyi/api/users/payment/webhook/
```

Y define `STRIPE_WEBHOOK_SECRET` en el entorno del backend.

---

## 7. Verificación rápida

```bash
# Redirección HTTP → HTTPS
curl -I http://plasma3d.sebaces.fyi

# Certificado y fechas
echo | openssl s_client -connect plasma3d.sebaces.fyi:443 -servername plasma3d.sebaces.fyi 2>/dev/null | openssl x509 -noout -subject -issuer -dates

# Renovación simulada
sudo certbot renew --dry-run

# Estado de contenedores
docker compose -f docker-compose.prod.yml ps
```
