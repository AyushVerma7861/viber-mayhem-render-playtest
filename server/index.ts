import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_TYPE } from '../src/online-protocol.ts';
import { parseRegionDirectory } from '../src/online-regions.ts';
import { MayhemRoom } from './mayhem-room.ts';

const output = new URL('../online-dist/', import.meta.url);
const html = readFileSync(new URL('index.html', output), 'utf8').replace('<html ', '<html data-online ');
const outputPath = fileURLToPath(output);
const assets = fileURLToPath(new URL('assets/', output));
const pizzaHtml = readFileSync(new URL('pizza/index.html', output), 'utf8');
const pizzaAssets = fileURLToPath(new URL('pizza/assets/', output));
const directory = process.env.MAYHEM_REGIONS
  ? parseRegionDirectory(JSON.parse(process.env.MAYHEM_REGIONS))
  : undefined;
if (process.env.MAYHEM_REGIONS && !directory) throw new Error('Invalid MAYHEM_REGIONS directory.');
const connections = directory?.regions.flatMap(({ origin }) => [origin, origin.replace(/^http/, 'ws')]) ?? [];
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  ["connect-src 'self'", ...connections].join(' '),
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');
export const server = new Server({
  transport: new WebSocketTransport({ maxPayload: 4096 }),
  express(app) {
    app.disable('x-powered-by');
    app.use((_request, response, next) => {
      response.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      next();
    });
    app.get('/', (_request, response) => response.set({
      'Cache-Control': 'no-store', 'Content-Security-Policy': contentSecurityPolicy,
    }).type('html').send(html));
    app.get('/pizza/', (_request, response) => response.set({
      'Cache-Control': 'no-store', 'Content-Security-Policy': contentSecurityPolicy,
    }).type('html').send(pizzaHtml));
    app.get('/favicon.ico', (_request, response) => response.sendFile('favicon.png', { root: outputPath, maxAge: '1d' }));
    app.get('/health', (_request, response) => response.json({ ok: true }));
    app.get('/regions.json', (_request, response) => response.set('Cache-Control', 'no-store').json(directory ?? null));
    app.get('/third-party-notices', (_request, response) =>
      response.type('text/plain').sendFile('THIRD-PARTY-NOTICES.md', { root: outputPath }));
    app.get('/assets/:name', (request, response) => {
      const name = request.params.name;
      if (!/^[\w.-]+\.(js|css|png|webp)$/.test(name)) {
        response.sendStatus(404);
        return;
      }
      response.sendFile(name, { root: assets, maxAge: '1y', immutable: true });
    });
    app.get('/pizza/assets/:name', (request, response) => {
      const name = request.params.name;
      if (!/^[\w.-]+\.(js|css|png|webp|flac|mp3)$/.test(name)) {
        response.sendStatus(404);
        return;
      }
      response.sendFile(name, { root: pizzaAssets, maxAge: '1y', immutable: true });
    });
  },
});
server.define(ROOM_TYPE, MayhemRoom);
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 2567);
  await server.listen(port, host);
  console.log('Viber Mayhem listening on http://' + host + ':' + port);
}
