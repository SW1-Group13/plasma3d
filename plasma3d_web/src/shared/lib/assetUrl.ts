import { env } from '@/shared/config/env';

/**
 * Resuelve la URL de un asset de media.
 * - Si ya es absoluta (p.ej. Cloudinary), se devuelve tal cual.
 * - Si es relativa (/media/...), se antepone el origen de la API.
 */
export function assetUrl(path?: string | null): string {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `${env.apiUrl}${path.replace(/^\/+/, '')}`;
}
