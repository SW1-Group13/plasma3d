export const env = {
  // Base de la API. Por defecto relativa ('/'), servida por el proxy de Vite
  // en desarrollo y por Nginx en produccion.
  apiUrl: import.meta.env.VITE_API_BASE ?? '/',
  stripePk: import.meta.env.VITE_STRIPE_PK ?? '',
};
