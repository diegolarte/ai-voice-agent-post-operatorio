import { defineConfig, loadEnv } from 'vite';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = env.PORT || '8787';

  return {
    root: path.resolve(process.cwd(), 'web'),
    publicDir: false,
    envDir: process.cwd(),
    server: {
      port: 5173,
      strictPort: true,
      // El navegador nunca habla directo con Google: todo pasa por el backend,
      // que es quien custodia la clave y emite tokens efímeros para la Live API.
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true },
      },
    },
    build: {
      outDir: path.resolve(process.cwd(), 'dist'),
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        '@shared': path.resolve(process.cwd(), 'shared'),
      },
    },
  };
});
