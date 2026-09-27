import axios from 'axios';
import { env } from '@/shared/config/env';
import { getAccessToken } from '@/entities/session/store';

export const http = axios.create({
  baseURL: env.apiUrl,
});

const EXCLUDED_URLS = ['/auth/login', '/auth/registro', '/auth/register', 'cloudinary.com'];

http.interceptors.request.use((config) => {
  const url = config.url ?? '';
  const excluded = EXCLUDED_URLS.some((excludedUrl) => url.includes(excludedUrl));

  if (!excluded) {
    const token = getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }

  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(error),
);
