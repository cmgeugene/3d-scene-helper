import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { companionDevSessionPlugin } from './companion/viteDevSessionPlugin';

export default defineConfig({
  plugins: [react(), companionDevSessionPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  preview: {
    headers: {
      'X-I2V-Preview': 'production',
    },
  },
  test: {
    environment: 'jsdom',
    include: ['companion/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
