# Informe de Análisis: Duplicación del Prefijo `/api/` en Entorno de Producción

Este informe detalla el origen técnico del error `404 (Not Found)` al intentar realizar peticiones al backend (como el registro de usuarios) y explica exactamente en qué puntos del código se estaba añadiendo el prefijo `/api/`.

---

## 1. El Origen de la Duplicación

La duplicación del path `api/api/` ocurría por una superposición entre la configuración global del entorno (**environment**) y la concatenación manual de rutas en los **servicios** de Angular.

### Punto A: Configuración del Entorno (`.env.ts` / `environment.ts`)
En el archivo de configuración de producción, el endpoint estaba definido incluyendo `/api/` al final:
```typescript
// Archivo: plasma3d_web/.env.ts (ANTERIOR)
export const environment = {
  endpoint: 'https://app.bratox.me/api/', // <-- Aquí ya se incluía /api/
  cloudinary: 'https://api.cloudinary.com/v1_1'
}
```

### Punto B: Concatenación en los Servicios de Angular (`auth.service.ts`, etc.)
En los archivos de servicio, Angular realiza peticiones concatenando la variable `this.API` (que toma el valor de `environment.endpoint`) con la ruta del recurso, añadiendo manualmente `"api/"`:
```typescript
// Archivo: plasma3d_web/src/app/features/auth/services/auth.service.ts
public register(user: UserRegister): Observable<any> {
  // Se concatena: endpoint + "api/users/auth/registro/"
  return this.http.post<any>(`${this.API}api/users/auth/registro/`, { ... });
}
```

### El Resultado Duplicado:
Al sumar ambas partes:
$$\text{https://app.bratox.me/api/} + \text{api/users/auth/registro/} = \text{https://app.bratox.me/api/api/users/auth/registro/}$$

Esto hacía que el navegador web del cliente buscara una ruta inexistente, retornando un error **`404 Not Found`**.

---

## 2. La Solución Aplicada

Se corrigió la URL base en el archivo de entorno eliminando el prefijo `/api/` para que la concatenación de los servicios sea la que defina la ruta de forma limpia.

### Configuración Corregida:
```typescript
// Archivo: plasma3d_web/.env.ts (CORREGIDO)
export const environment = {
  endpoint: 'https://app.bratox.me/', // <-- Sin /api/ al final
  cloudinary: 'https://api.cloudinary.com/v1_1'
}
```

### Nueva Evaluación de la Ruta:
$$\text{https://app.bratox.me/} + \text{api/users/auth/registro/} = \text{https://app.bratox.me/api/users/auth/registro/}$$

---

## 3. Relación con Nginx Proxy Manager (NPM)

Con la ruta corregida (`https://app.bratox.me/api/users/...`), el flujo de red con NPM funciona de forma transparente:

1. El navegador del cliente solicita: `https://app.bratox.me/api/users/auth/registro/`
2. **Nginx Proxy Manager** intercepta la petición en el puerto `80/443`.
3. NPM detecta la regla de **Custom Location** para `/api/` y redirige el tráfico a la máquina virtual en el puerto `8000`:
   `http://192.168.0.97:8000/api/users/auth/registro/`
4. **Django** recibe la ruta `/api/users/auth/registro/` que coincide exactamente con sus patrones URL en el backend.
