export const env = {
  // Base de la API. Por defecto relativa ('/'), servida por el proxy de Vite
  // en desarrollo y por Nginx en produccion.
  apiUrl: import.meta.env.VITE_API_BASE ?? '/',
  cloudinary: import.meta.env.VITE_CLOUDINARY ?? 'https://api.cloudinary.com/v1_1',
  cloudinaryCloudName: import.meta.env.VITE_CLOUDINARY_CLOUD_NAME ?? 'diqqfka6g',
  cloudinaryUploadPreset: import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET ?? 'profiles',
  stripePk: import.meta.env.VITE_STRIPE_PK ?? '',
};
