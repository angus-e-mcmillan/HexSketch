import { defineConfig } from 'vite';
import { buildVersion } from '../../tools/build/version.ts';

export default defineConfig({
  server: { port: 5174, strictPort: true },
  define: { __HEXSKETCH_VERSION__: JSON.stringify(buildVersion()) },
});
