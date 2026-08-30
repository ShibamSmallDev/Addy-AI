import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        // Churn from backend writes (DB flushes, browser sessions, transcripts) must not reload the UI
        ignored: [
          '**/addy-ai.db*',
          '**/memories.json*',
          '**/secrets.json',
          '**/settings.json',
          '**/custom_prompt.txt',
          '**/desktop_agent/data/**',
          '**/browser_profile*/**',
          '**/transcripts/**',
          '**/node_modules/**',
          '**/.git/**',
          '**/__pycache__/**',
          '**/*.pyc',
        ],
      },
    },
  };
});
