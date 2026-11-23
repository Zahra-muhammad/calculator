import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Relative base so the built app also works when opened from a folder or a file share.
export default defineConfig({
  base: './',
  plugins: [react()],
  // SheetJS and jsPDF are large; the app is meant to run offline, so one bigger file is fine.
  build: { chunkSizeWarningLimit: 1500 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
