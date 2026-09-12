import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = 'http://localhost:8080';

// Proxy ONLY XHR/fetch API calls — never full-page navigations.
// Without the bypass, a browser refresh on /clients, /vendors, /routes…
// (which collide with API paths) would be forwarded to the API and render
// {"error":"missing token"} instead of the React app.
const apiProxy = (prefix: string) => ({
  target: API,
  changeOrigin: true,
  bypass: (req: { headers: Record<string, string | string[] | undefined>; xhr?: boolean }) => {
    const accept = String(req.headers.accept ?? '');
    // Browser page loads ask for HTML → serve index.html (SPA fallback).
    // fetch() calls ask for JSON (or are marked XHR) → proxy to the API.
    if (accept.includes('text/html') && !req.xhr) return '/index.html';
    return undefined;
  },
});

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth': apiProxy('/auth'),
      '/clients': apiProxy('/clients'),
      '/vendors': apiProxy('/vendors'),
      '/routes': apiProxy('/routes'),
      '/messages': apiProxy('/messages'),
      '/billing': apiProxy('/billing'),
      '/reports': apiProxy('/reports'),
      '/system': apiProxy('/system'),
      '/connectors': apiProxy('/connectors'),
      '/portal': apiProxy('/portal'),
    },
  },
});
