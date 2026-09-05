import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readAllowedHosts } from './shared/site-hosts';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    allowedHosts: readAllowedHosts(loadEnv(mode, process.cwd(), 'ALLOWED_HOSTS').ALLOWED_HOSTS),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          markdown: ['react-markdown', 'remark-gfm', 'remark-math'],
          math: ['rehype-katex', 'katex'],
          highlight: ['rehype-highlight'],
        },
      },
    },
  },
}));
