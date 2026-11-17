import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        '__APP_BUILD__': JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA || 'local')
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        chunkSizeWarningLimit: 900,
        modulePreload: {
          resolveDependencies(_filename, deps, context) {
            if (context.hostType !== 'html') return deps;
            return deps.filter(dep =>
              !/vendor-(pdf-export|pdf-viewer|spreadsheets|ocr|charts|motion)/.test(dep),
            );
          },
        },
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (!id.includes('node_modules')) return undefined;
              if (id.includes('pdfjs-dist')) return 'vendor-pdf-viewer';
              if (id.includes('jspdf') || id.includes('qrcode')) return 'vendor-pdf-export';
              if (id.includes('exceljs') || id.includes('/xlsx/')) return 'vendor-spreadsheets';
              if (id.includes('tesseract.js')) return 'vendor-ocr';
              if (id.includes('recharts')) return 'vendor-charts';
              if (id.includes('/motion/')) return 'vendor-motion';
              if (id.includes('@supabase')) return 'vendor-supabase';
              return undefined;
            },
          },
        },
      }
    };
});
