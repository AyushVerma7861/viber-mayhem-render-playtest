import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_TYPE } from '../src/online-protocol.ts';
import { parseRegionDirectory } from '../src/online-regions.ts';
import { MayhemRoom } from './mayhem-room.ts';

const output = new URL('../online-dist/', import.meta.url);
const html = readFileSync(new URL('index.html', output), 'utf8').replace('<html ', '<html data-online ');
const assets = fileURLToPath(new URL('assets/', output));
const directory = process.env.MAYHEM_REGIONS
  ? parseRegionDirectory(JSON.parse(process.env.MAYHEM_REGIONS))
  : undefined;
if (process.env.MAYHEM_REGIONS && !directory) throw new Error('Invalid MAYHEM_REGIONS directory.');
const server = new Server({
  transport: new WebSocketTransport({ maxPayload: 4096 }),
  express(app) {
    app.get('/', (_request, response) => response.set('Cache-Control', 'no-store').type('html').send(html));
    app.get('/health', (_request, response) => response.json({ ok: true }));
    app.get('/regions.json', (_request, response) => response.set('Cache-Control', 'no-store').json(directory ?? null));
    app.get('/assets/:name', (request, response) => {
      const name = request.params.name;
      if (!/^[\w.-]+\.(js|css)$/.test(name)) {
        response.sendStatus(404);
        return;
      }
      response.sendFile(name, { root: assets, maxAge: '1y', immutable: true });
    });
  },
});
server.define(ROOM_TYPE, MayhemRoom);
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 2567);
await server.listen(port, host);
console.log('Viber Mayhem online preview listening on http://' + host + ':' + port);
