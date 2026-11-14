# Plasma3D en el celular

Hay **tres formas** de usar Plasma3D en un teléfono. Todas hablan con el mismo
backend; elige la que prefieras en cada celular.

| Forma | Qué necesitas | Cuándo conviene |
|---|---|---|
| **Web en el navegador** | Chrome/Safari/Firefox | Probar rápido, sin instalar nada |
| **Web instalada (PWA)** | La web servida por **HTTPS** | Icono propio, pantalla completa, sin tienda |
| **App Flutter (APK / iOS)** | `plasma_mobile` compilada | Cámara, AR y funciones nativas |

---

## 1. Web en el navegador del celular (misma Wi-Fi)

1. Levanta el proyecto en la PC:
   ```powershell
   docker compose -f docker-compose.dev.yml up -d
   ```
2. Averigua la IP de la PC: `ipconfig` → "Dirección IPv4" (ej. `192.168.1.50`).
3. En el celular (misma Wi-Fi) abre: `http://192.168.1.50:5173`
4. Si no carga: Firewall de Windows → permitir el puerto **5173** (TCP, red privada).

La web ya se adapta al celular:
- **Menú ☰** arriba a la izquierda (Dashboard, Perfil, Pagos, Cerrar sesión).
- **Editor 3D**:
  - Las barras de arriba se **deslizan con el dedo**.
  - Las herramientas (muro, puerta, ventana, piso, techo, borrar) están en la **barra de abajo**.
  - **Propiedades** se abre como hoja inferior al tocar una pieza.
  - **Gestos**:
    - 1 dedo: rotar (3D) o mover el plano (Planta/Alzado/Perfil).
    - 2 dedos: zoom y desplazar.
  - **Botones táctiles en lugar de teclas**:
    - **Cancelar** reemplaza a Esc mientras dibujas.
    - **Multi** reemplaza a Ctrl+clic (multiselección).
    - **Bloq. Y** reemplaza a mantener Shift.

## 2. Instalar la web como app (PWA)

El navegador solo ofrece "Instalar" si la página llega por **HTTPS**
(`http://192.168.x.x` no alcanza).

### Opción rápida para probar: túnel HTTPS gratuito (sin tocar el router)
1. Instala cloudflared: `winget install --id Cloudflare.cloudflared`
2. Con el proyecto levantado:
   ```powershell
   cloudflared tunnel --url http://localhost:5173
   ```
3. Copia la URL `https://xxxx.trycloudflare.com` que aparece y ábrela en el celular.
4. Instalar:
   - **Android (Chrome):** menú ⋮ → **Instalar app** / "Agregar a pantalla principal".
   - **iPhone (Safari):** Compartir → **Agregar a inicio**.

La URL cambia cada vez que reinicias el túnel. Otros dominios de túnel se
agregan con `VITE_ALLOWED_HOSTS=mi.dominio.com` en `.env`.

### Producción (servidor con dominio)
Usa `nginx/https.conf.example` (instrucciones dentro): certificado de
Let's Encrypt, puerto 443 y redirección de HTTP a HTTPS.

**Actualizaciones:** cuando publicas una versión nueva, la app instalada
muestra "Hay una versión nueva → **Actualizar**". Los datos (`/api`) nunca se
guardan en caché; los modelos `.glb` siempre se piden primero al servidor.

## 3. App Flutter (APK / iOS)
Ver `plasma_mobile/README.md` → "Generar el APK". Resumen (Android):
```bash
cd plasma_mobile
flutter build apk --release \
  --dart-define=API_BASE_URL=http://192.168.1.50:8000/ \
  --dart-define=API_MEDIA_URL=http://192.168.1.50:8000
```
Instala `build/app/outputs/flutter-apk/app-release.apk` en el celular.
iOS se compila solo desde una Mac (`flutter build ipa`).
