import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, setupFiles: ['./test/setup.js'], include: ['test/**/*.test.{js,jsx}'] },
  server: { host: true, port: 5174, proxy: { '/api': 'http://localhost:3001' } },
});
