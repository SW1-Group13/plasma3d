const baseUrl = import.meta.env.VITE_BASE_URL ?? '/';

export const env = {
  // Base de la API usada por el navegador. Si VITE_BASE_URL es absoluta
  // (p.ej. el host interno del backend para el proxy de Vite), la app usa
  // '/' para pasar por el proxy de Vite (dev) o por Nginx (prod).
  apiUrl: baseUrl.startsWith('/') ? baseUrl : '/',
};
