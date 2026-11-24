import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('./', import.meta.url));
const output = fileURLToPath(new URL('./online-dist/', import.meta.url));
const pizza = fileURLToPath(new URL('./pizza-party/', import.meta.url));

await build({ root, mode: 'online', build: { outDir: output } });
await copyFile(new URL('./src/assets/chef-mark.png', import.meta.url), new URL('./online-dist/favicon.png', import.meta.url));
await build({
  root: pizza,
  base: '/pizza/',
  mode: 'shared-rush',
  configFile: false,
  build: { outDir: fileURLToPath(new URL('./online-dist/pizza/', import.meta.url)), emptyOutDir: true },
});
