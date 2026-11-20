import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRegionDirectory, preferredRegion, readRoomRoute } from '../src/online-regions.ts';

const regions = [
  { id: 'sg', label: 'Singapore', origin: 'https://sg.example.test' },
  { id: 'eu', label: ' Europe ', origin: 'https://eu.example.test/' },
  { id: 'loop', label: 'Local test', origin: 'http://127.0.0.1:2567' },
];
const directory = parseRegionDirectory({ home: 'sg', regions })!;
const code = 'abcdefghAB12';

test('region directories normalize origins and require one listed home', () => {
  assert.deepEqual(directory.regions[1], { id: 'eu', label: 'Europe', origin: 'https://eu.example.test' });
  for (const bad of [
    { home: 'missing', regions },
    { home: 'sg', regions: [...regions, { ...regions[1], origin: 'https://duplicate.example.test' }] },
    { home: 'sg', regions: [...regions, { ...regions[1], id: 'duplicate' }] },
    { home: 'sg', regions: [{ ...regions[0], origin: 'http://sg.example.test' }] },
    { home: 'sg', regions: [{ ...regions[0], origin: 'https://someone:secret@sg.example.test' }] },
    { home: 'sg', regions: [{ ...regions[0], origin: 'https://sg.example.test/path' }] },
    { home: 'sg', regions: [{ ...regions[0], origin: 'wss://sg.example.test' }] },
  ]) assert.equal(parseRegionDirectory(bad), undefined);
});

test('Auto picks the fastest replying server and uses home when probes fail or tie', () => {
  assert.equal(preferredRegion(directory, new Map([['sg', 109], ['eu', 43], ['loop', null]])).id, 'eu');
  assert.equal(preferredRegion(directory, new Map([['sg', 60], ['eu', 60]])).id, 'sg');
  assert.equal(preferredRegion(directory, new Map([['sg', null], ['eu', null]])).id, 'sg');
});

test('region-prefixed codes and invites route to the same server', () => {
  const route = { code, region: directory.regions[1] };
  assert.deepEqual(readRoomRoute(' eu:' + code + ' ', directory), route);
  assert.deepEqual(readRoomRoute('https://play.example.test/?room=' + code + '&region=eu', directory), route);
});

test('legacy codes keep their origin or fall back to the known home server', () => {
  assert.equal(readRoomRoute(code, directory)?.region.id, 'sg');
  assert.equal(readRoomRoute('https://eu.example.test/?room=' + code, directory)?.region.id, 'eu');
  assert.equal(readRoomRoute('https://outside.example.test/?room=' + code, directory)?.region.origin, regions[0].origin);
});

test('unknown and conflicting region claims cannot route a client', () => {
  for (const bad of [
    'other:' + code,
    'https://play.example.test/?room=' + code + '&region=unknown',
    'https://play.example.test/?room=eu:' + code + '&region=sg',
    'https://play.example.test/?room=bad&region=eu',
  ]) assert.equal(readRoomRoute(bad, directory), undefined);
});
