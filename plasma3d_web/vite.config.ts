import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * PWA: la web se puede instalar en el celular ("Agregar a pantalla de inicio").
 * El service worker cachea solo la app (JS/CSS/íconos/texturas); los datos de
 * /api nunca se cachean y los modelos .glb van siempre a la red primero.
 */
const pwa = VitePWA({
  registerType: 'prompt',
  injectRegister: false, // se registra en src/app/pwa.ts (con aviso de actualización)
  includeAssets: ['favicon/favicon.svg', 'pwa/apple-touch-icon.png'],
  manifest: {
    name: 'Plasma3D – De planos 2D a modelos 3D',
    short_name: 'Plasma3D',
    description: 'Convierte planos 2D en modelos 3D, mide, presupuesta y analiza con IA.',
    lang: 'es',
    start_url: '/private/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0a0e1a',
    theme_color: '#0a0e1a',
    icons: [
      { src: '/pwa/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/pwa/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
      { src: '/pwa/maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,woff2}', 'pwa/*.png'],
    maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // el chunk de three.js es grande
    navigateFallback: '/index.html',
    navigateFallbackDenylist: [/^\/api/, /^\/media/, /^\/static/, /^\/ws/, /^\/admin/],
    runtimeCaching: [
      {
        // Texturas: casi no cambian
        urlPattern: ({ url }) => url.pathname.startsWith('/static/textures/'),
        handler: 'CacheFirst',
        options: { cacheName: 'texturas', expiration: { maxEntries: 60, maxAgeSeconds: 30 * 24 * 3600 } },
      },
      {
        // Modelos 3D: siempre la versión del servidor; sin red, la última vista
        urlPattern: ({ url }) => url.pathname.startsWith('/media/') && url.pathname.endsWith('.glb'),
        handler: 'NetworkFirst',
        options: { cacheName: 'modelos-glb', expiration: { maxEntries: 30 } },
      },
    ],
  },
  // También en `npm run dev`, para poder instalarla al probar por un túnel HTTPS.
  devOptions: {
    enabled: true,
    type: 'module',
    navigateFallbackAllowlist: [/^\/(?!api|media|static|ws|admin).*/],
  },
});

// El .env vive en la raiz del proyecto (un nivel arriba de plasma3d_web)
const envDir = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '');

  const frontendPort = parseInt(env.FRONTEND_PORT || env.PORT || '5173', 10);
  const apiTarget = env.VITE_BASE_URL || 'http://localhost:8000';
  const wsTarget = env.VITE_WS_URL || 'ws://localhost:8000';

  const proxy = {
    '/api': { target: apiTarget, changeOrigin: true },
    '/media': { target: apiTarget, changeOrigin: true },
    '/static': { target: apiTarget, changeOrigin: true },
    '/ws': { target: wsTarget, ws: true, changeOrigin: true },
  };

  return {
    envDir,
    plugins: [react(), tailwindcss(), pwa],
    define: {
      global: 'globalThis',
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: true,
      port: frontendPort,
      // Celular por IP de la LAN (IPs se permiten siempre) o por un túnel HTTPS
      // (cloudflared / ngrok) para poder instalar la PWA. Más hosts: VITE_ALLOWED_HOSTS=a.com,b.com
      allowedHosts: [
        '.trycloudflare.com',
        '.ngrok-free.app',
        '.ngrok.app',
        ...(env.VITE_ALLOWED_HOSTS ? env.VITE_ALLOWED_HOSTS.split(',').map((h) => h.trim()) : []),
      ],
      watch: {
        // Polling: necesario para HMR dentro de Docker en Windows/macOS.
        usePolling: true,
        interval: 800,
      },
      proxy,
    },
    preview: {
      host: true,
      port: frontendPort,
      allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.app'],
      proxy,
    },
    build: {
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          manualChunks(id) {
            // El helper de import() de Vite lo usan todos: que no caiga en un
            // bloque de exportación (si no, ese bloque se precarga al inicio).
            if (id.includes('vite/preload-helper')) return 'vendor';
            if (id.includes('node_modules/three')) return 'three';
            // Exportar presupuestos: se cargan solo al exportar (import dinámico).
            if (id.includes('node_modules/exceljs')) return 'export-xlsx';
            if (
              /node_modules\/(jspdf|jspdf-autotable|fflate|fast-png|iobuffer|pako|html2canvas|canvg|dompurify|core-js|raf|rgbcolor|stackblur-canvas|svg-pathdata)\//.test(id)
            ) {
              return 'export-pdf';
            }
            if (id.includes('node_modules')) return 'vendor';
            return undefined;
          },
        },
      },
    },
  };
});
