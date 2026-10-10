import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Local live mode: run the backend on :4000, then `VITE_LIVE=true npm run dev`.
    proxy: { '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:4000' },
  },
});
