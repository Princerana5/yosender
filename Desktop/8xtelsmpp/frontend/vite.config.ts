import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth': 'http://localhost:8080',
      '/clients': 'http://localhost:8080',
      '/vendors': 'http://localhost:8080',
      '/routes': 'http://localhost:8080',
      '/messages': 'http://localhost:8080',
      '/billing': 'http://localhost:8080',
      '/reports': 'http://localhost:8080',
      '/system': 'http://localhost:8080',
      '/connectors': 'http://localhost:8080',
    },
  },
});
