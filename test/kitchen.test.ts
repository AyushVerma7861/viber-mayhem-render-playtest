import assert from 'node:assert/strict';
import test from 'node:test';
import { KITCHEN_ARENA, routeHeading } from '../src/arena.ts';
import type { Vec } from '../src/arena.ts';
import {
  CART_BODY_LENGTH, CART_HUB_DEPTH, CART_HUB_OFFSET, FUSE_TICKS, Match, PLAYER_RADIUS, STUN_TICKS,
} from '../src/simulation.ts';
import type { MovementProfile } from '../src/simulation.ts';

const kitchen = KITCHEN_ARENA;
const zero = { x: 0, z: 0 };
const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.z - b.z);
const cartHalfLength = CART_BODY_LENGTH / 2;
const cartHalfWidth = CART_HUB_OFFSET + CART_HUB_DEPTH / 2;
const cartRadius = Math.hypot(cartHalfLength, cartHalfWidth);
const tracks = [0, 1].map(lane => Array.from({ length: 401 }, (_, n) => kitchen.point(lane, n / 400)));

function fixture(movement: MovementProfile = 'classic', humanSeats: readonly number[] = [0]): Match {
  const match = new Match(17, 'nearest', kitchen, movement);
  match.start(match.seed, humanSeats);
  match.phase = 'play';
  match.tick = 121;
  match.assignAt = Infinity;
  match.lanes.forEach(lane => { lane.next = Infinity; });
  return match;
}

function place(match: Match, id: number, position: Vec): void {
  Object.assign(match.players[id], { position, previous: position, drive: zero, impulse: zero });
}

test('two nonzero human seats steer independently while bots ignore supplied input', () => {
  const match = fixture('classic', [1, 3]);
  const control = fixture('classic', [1, 3]);
  const right = { x: 1, z: 0 };
  const left = { x: -1, z: 0 };
  for (let tick = 0; tick < 4; tick++) {
    match.stepSeats({ 0: right, 1: right, 2: left, 3: left });
    control.stepSeats({ 1: right, 3: left });
  }
  assert.ok(match.players[1].drive.x > 0);
  assert.equal(match.players[1].drive.x, -match.players[3].drive.x);
  assert.deepEqual(match.players, control.players);
  assert.notDeepEqual(match.players[0].drive, zero);
  assert.notDeepEqual(match.players[2].drive, zero);
});

test('a missing human input lets movement settle while the cooker fuse keeps running', () => {
  const match = fixture('classic', [0, 1, 2, 3]);
  place(match, 2, zero);
  match.holder = 2;
  match.deadline = match.tick + FUSE_TICKS;
  match.passAt = match.deadline;
  match.stepSeats({ 2: { x: 1, z: 0 } });
  assert.ok(match.players[2].drive.x > 0);
  for (let tick = 0; tick < 60; tick++) match.stepSeats({});
  assert.ok(Math.hypot(match.players[2].drive.x, match.players[2].drive.z) < 0.00001);
  assert.equal(match.holder, 2);
  assert.equal(match.remaining, FUSE_TICKS - 61);
});

test('movement review reduces drift on a sharp turn or release', () => {
  for (const next of [{ x: 0, z: -1 }, zero]) {
    const slides = (['classic', 'responsive'] as const).map(profile => {
      const match = fixture(profile);
      for (const rival of match.players.slice(1)) rival.alive = false;
      place(match, 0, zero);
      for (let i = 0; i < 30; i++) match.step({ x: 1, z: 0 });
      const start = match.players[0].position.x;
      for (let i = 0; i < 6; i++) match.step(next);
      return match.players[0].position.x - start;
    });
    assert.ok(slides[1] < slides[0] * 0.7, JSON.stringify({ next, slides }));
  }
});

test('movement review gives a hard bump more shove and maintains the shared timer', () => {
  function bump(profile: MovementProfile, speed: number) {
    const match = fixture(profile);
    match.players[2].alive = match.players[3].alive = false;
    place(match, 0, zero);
    place(match, 1, { x: PLAYER_RADIUS * 2 - 0.002, z: 0 });
    match.players[0].drive = { x: speed, z: 0 };
    match.players[1].stunnedUntil = Infinity;
    match.holder = 0;
    match.deadline = match.tick + FUSE_TICKS;
    const deadline = match.deadline;
    match.step({ x: speed > 0 ? 1 : 0, z: 0 });
    assert.equal(match.holder, 1);
    assert.equal(match.deadline, deadline);
    assert.equal(match.events.filter(event => event.type === 'pass').length, 1);
    return match.players[1].impulse.x;
  }
  assert.ok(bump('responsive', 5) > bump('classic', 5) * 1.6);
  assert.ok(bump('responsive', 0) < bump('classic', 0));
});

test('kitchen trolleys enter from opposite ends and have room for players between their footprints', () => {
  for (const [lane, track] of tracks.entries()) {
    assert.ok(Math.abs(track[0].z) > kitchen.bounds.z + cartRadius, 'cart starts fully outside');
    assert.ok(Math.abs(track.at(-1)!.x) > kitchen.bounds.x + cartRadius, 'cart exits fully outside');
    assert.ok(Math.abs(Math.cos(routeHeading(kitchen, lane, 0))) < 0.04, 'entry is nearly vertical');
    assert.ok(Math.abs(Math.sin(routeHeading(kitchen, lane, 1))) < 0.04, 'exit is nearly horizontal');
    for (let i = 1; i < track.length; i++) {
      assert.ok(Math.abs(distance(track[i], track[i - 1]) / distance(track[0], track[1]) - 1) < 0.025,
        'cart speed does not lurch around the bend');
    }
  }
  for (const a of tracks[0]) {
    for (const b of tracks[1]) {
      assert.ok(distance(a, b) > 2 * cartRadius + 2 * PLAYER_RADIUS);
    }
  }
});

test('four seeded start slots rotate without putting anyone in a trolley lane', () => {
  const used = new Set<string>();
  for (let seed = 0; seed < 4; seed++) {
    const match = new Match(seed, 'nearest', kitchen);
    match.start();
    used.add(JSON.stringify(match.players[0].position));
    for (const player of match.players) {
      assert.ok(tracks.every(track => track.every(p => distance(player.position, p) > cartRadius + PLAYER_RADIUS)));
    }
    match.start();
    assert.equal(JSON.stringify(match.players[0].position), JSON.stringify(kitchen.spawns[seed]));
  }
  assert.equal(used.size, 4);
});

test('a player can run straight through the center along either axis', () => {
  const match = fixture();
  for (const bot of match.players.slice(1)) bot.alive = false;
  place(match, 0, { x: 0, z: -1.8 });
  for (let i = 0; i < 45; i++) match.step({ x: 0, z: 1 });
  assert.ok(match.players[0].position.z > 1.8);
  place(match, 0, { x: -2.2, z: 0 });
  for (let i = 0; i < 52; i++) match.step({ x: 1, z: 0 });
  assert.ok(match.players[0].position.x > 2.2);
});

test('a carrier can tag a rival by chasing directly across the open center', () => {
  const match = fixture();
  place(match, 0, { x: 0, z: 1.20 });
  place(match, 1, { x: 0, z: -1.34 });
  match.players[2].alive = match.players[3].alive = false;
  match.holder = 1;
  match.deadline = match.tick + FUSE_TICKS;
  for (let i = 0; i < 35 && match.holder === 1; i++) match.step(zero);
  assert.equal(match.holder, 0);
  assert.ok(Math.abs(match.players[1].position.x) < 0.40);
});

test('a trolley at either bent entry stays solid and preserves the stun and fuse rules', () => {
  for (const lane of [0, 1]) {
    const match = fixture();
    const duration = kitchen.routes[lane].duration;
    const elapsed = Math.round(duration * 0.145);
    const position = kitchen.point(lane, elapsed / duration);
    const heading = routeHeading(kitchen, lane, elapsed / duration);
    match.carts.push({ lane, start: match.tick - elapsed, position, previous: position, heading, contacts: 0 });
    place(match, 0, { x: position.x, z: lane === 0 ? -kitchen.bounds.z + PLAYER_RADIUS : kitchen.bounds.z - PLAYER_RADIUS });
    match.holder = 0;
    match.deadline = match.tick + FUSE_TICKS;
    const deadline = match.deadline;
    match.passAt = deadline;
    match.step(zero);
    assert.ok(match.events.some(event => event.type === 'hit' && event.player === 0));
    assert.equal(match.players[0].stunnedUntil, match.tick + STUN_TICKS);
    assert.equal(match.deadline, deadline);
    assert.ok(Math.abs(match.players[0].position.z) <= kitchen.bounds.z - PLAYER_RADIUS);
    const cart = match.carts[0];
    const x = match.players[0].position.x - cart.position.x;
    const z = match.players[0].position.z - cart.position.z;
    const along = Math.abs(x * Math.cos(cart.heading) + z * Math.sin(cart.heading));
    const side = Math.abs(z * Math.cos(cart.heading) - x * Math.sin(cart.heading));
    assert.ok(Math.hypot(Math.max(0, along - cartHalfLength), Math.max(0, side - cartHalfWidth)) >= PLAYER_RADIUS);
  }
});

test('50 kitchen seeds finish with all three knockouts and see bot passes and trolley hits', () => {
  let botPasses = 0;
  let botHits = 0;
  let playerHits = 0;
  for (let seed = 0; seed < 50; seed++) {
    const match = new Match(seed, 'nearest', kitchen);
    match.start();
    let blasts = 0;
    for (let tick = 0; tick < 2400 && match.winner === null; tick++) {
      const priorHolder = match.holder;
      match.step({ x: Math.cos(tick / 39), z: Math.sin(tick / 39) });
      for (const event of match.events) {
        if (event.type === 'blast') blasts++;
        if (event.type === 'pass' && priorHolder !== null && priorHolder !== 0 && event.player !== 0) botPasses++;
        if (event.type === 'hit' && event.player !== 0) botHits++;
        if (event.type === 'hit' && event.player === 0) playerHits++;
      }
      for (const { position, alive } of match.players) {
        if (!alive) continue;
        assert.ok(Math.abs(position.x) <= kitchen.bounds.x && Math.abs(position.z) <= kitchen.bounds.z,
          'players stay on the play floor');
      }
    }
    assert.equal(blasts, 3, 'seed ' + seed);
    assert.notEqual(match.winner, null);
  }
  assert.ok(botPasses > 0 && botHits > 0 && playerHits > 0);
});
