import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // WSL2 forwards Windows' localhost to this IPv4 loopback, so the Windows
    // browser can open http://localhost:5173 — a secure context, which
    // getUserMedia requires. (Binding explicitly to IPv4 avoids ::1 ambiguity.)
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
