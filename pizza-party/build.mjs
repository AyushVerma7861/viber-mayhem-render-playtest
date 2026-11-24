import { build } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./', import.meta.url));
const out = resolve(process.argv[2] ?? fileURLToPath(new URL('./dist/', import.meta.url)));
await build({
  root,
  configFile: false,
  mode: process.argv[3] ?? 'production',
  build: { outDir: out, emptyOutDir: false, assetsInlineLimit: Number.MAX_SAFE_INTEGER },
});
const output = pathToFileURL(out + sep);
const html = readFileSync(new URL('index.html', output), 'utf8');
const file = path => readFileSync(new URL(path.replace(/^\//, ''), output), 'utf8');
const standalone = html
  .replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g,
    (_, path) => '<script type="module">' + file(path).replace(/<\/script/gi, '<\\/script') + '</script>')
  .replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
    (_, path) => '<style>' + file(path) + '</style>');
if (/<script[^>]+src=|<link[^>]+rel="stylesheet"/.test(standalone)) throw new Error('Standalone assets were not embedded.');
const entry = new URL('Play Pizza Party - Kitchen Playtest.html', output);
writeFileSync(entry, standalone);
console.log(fileURLToPath(entry));
