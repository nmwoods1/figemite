import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { easelServerPlugin } from './src/dev/easel-server-plugin.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  plugins: [react(), easelServerPlugin(repoRoot)],
  server: {
    // Local-first-safe default: bind to loopback only. Matches
    // `ServerConfig.host`'s documented default in @easel/server.
    host: '127.0.0.1',
  },
});
