import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// El .env vive en la raiz del proyecto (un nivel arriba de plasma3d_web)
const envDir = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '');

  const frontendPort = parseInt(env.FRONTEND_PORT || env.PORT || '5173', 10);
  const apiTarget = env.VITE_API_URL || 'http://localhost:8000';
  const wsTarget = env.VITE_WS_URL || 'ws://localhost:8000';

  const proxy = {
    '/api': { target: apiTarget, changeOrigin: true },
    '/media': { target: apiTarget, changeOrigin: true },
    '/static': { target: apiTarget, changeOrigin: true },
    '/ws': { target: wsTarget, ws: true, changeOrigin: true },
  };

  return {
    envDir,
    plugins: [react(), tailwindcss()],
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
      proxy,
    },
    preview: {
      host: true,
      port: frontendPort,
      proxy,
    },
    build: {
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/three')) return 'three';
            if (id.includes('node_modules')) return 'vendor';
            return undefined;
          },
        },
      },
    },
  };
});
