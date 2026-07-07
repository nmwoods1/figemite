import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { figemiteServerPlugin } from './src/dev/figemite-server-plugin.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  plugins: [react(), figemiteServerPlugin(repoRoot)],
  server: {
    // Local-first-safe default: bind to loopback only. Matches
    // `ServerConfig.host`'s documented default in @figemite/server.
    host: '127.0.0.1',
  },
});
