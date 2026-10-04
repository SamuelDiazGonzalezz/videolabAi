import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// En RacingMonos el backend es la app Next.js (puerto 3000): sirve los
// storyboards, las escenas PNG, la narración y el vídeo base. Este dev server
// solo sirve la UI y reenvía /api y /assets para evitar problemas de CORS.
const racingMonosApi = process.env.RACINGMONOS_API_URL || 'http://localhost:3000';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) return 'firebase';
          if (id.includes('node_modules/konva') || id.includes('node_modules/react-konva')) return 'canvas';
          if (id.includes('node_modules/wavesurfer.js')) return 'audio';
          if (id.includes('node_modules/react') || id.includes('node_modules/lucide-react') || id.includes('node_modules/zustand')) return 'ui';
          return undefined;
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/assets': racingMonosApi,
      '/api': racingMonosApi
    }
  },
  // Solo cubre utilidades puras (interpolación de keyframes, etc.) — no hay
  // suite de componentes React todavía, así que 'node' basta y evita añadir
  // jsdom como dependencia.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
});
