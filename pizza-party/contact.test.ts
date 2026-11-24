import test from 'node:test';
import assert from 'node:assert/strict';
import { APPROACHES, CROSSINGS } from './layout.ts';
import { distance, walkable } from './geometry.ts';
import { HZ, MOVE_SPEED, PizzaMatch, START_TICKS } from './simulation.ts';
import type { Player, Vec } from './simulation.ts';

const idle = { x: 0, z: 0 };
const east = { x: 1, z: 0 };
const west = { x: -1, z: 0 };
const north = { x: 0, z: -1 };
const south = { x: 0, z: 1 };
const parking = [{ x: -4.84, z: -2.68 }, { x: 4.8, z: -2.68 }, { x: 4.8, z: 2.65 }, { x: -5.65, z: 1.92 }];

function pose(player: Player, position: Vec, heading: number) {
  assert(walkable(position));
  player.position = { ...position };
  player.heading = heading;
}

function stagedMatch(): PizzaMatch {
  const match = new PizzaMatch(17);
  match.reset();
  match.tick = START_TICKS;
  match.phase = 'playing';
  match.trayReadyAt.fill(Infinity);
  match.players.forEach((player, seat) => pose(player, parking[seat], 0));
  return match;
}

test('each bot seat matches full player speed on a straight run', () => {
  for (const seat of [0, 1, 2, 3]) {
    const match = stagedMatch();
    const runner = match.players[seat];
    const start = { x: -1.60, z: 1.83 };
    pose(runner, start, Math.PI / 2);
    const controls: (Vec | undefined)[] = [idle, idle, idle, idle];
    controls[seat] = seat === 0 ? east : undefined;
    const rig = match as unknown as { botInput: (player: Player) => Vec };
    rig.botInput = () => east;
    for (let tick = 0; tick < 12; tick++) match.step(controls);
    assert(Math.abs(runner.position.x - start.x - MOVE_SPEED * 12 / HZ) < 1e-6);
    assert.equal(runner.position.z, start.z);
  }
});

test('even head-on inputs stay symmetric and holding contact does not spam bumps', () => {
  const match = stagedMatch();
  const [a, b] = match.players;
  const lane = CROSSINGS[0];
  pose(a, { x: lane.x, z: lane.z - 0.95 }, 0);
  pose(b, { x: lane.x, z: lane.z + 0.95 }, Math.PI);

  let bumps = 0;
  for (let tick = 0; tick < 35; tick++) {
    match.step([south, north, idle, idle]);
    bumps += match.events.filter(event => event.type === 'bump').length;
    assert(Math.abs(a.position.z + b.position.z - 2 * lane.z) < 1e-6);
    assert(Math.abs(a.recoil.z + b.recoil.z) < 1e-6);
  }
  assert.equal(bumps, 1);
  assert(a.position.z < lane.z && b.position.z > lane.z);
});

test('a glancing contact lets loaded chefs clear either narrow crossing', () => {
  for (const lane of CROSSINGS) {
    const match = stagedMatch();
    const [a, b] = match.players;
    pose(a, { x: lane.x - 0.24, z: lane.z - 0.98 }, 0);
    pose(b, { x: lane.x + 0.24, z: lane.z + 0.98 }, Math.PI);
    a.carried = 'cheese';
    b.carried = 'tomato';

    let bumps = 0;
    for (let tick = 0; tick < 42; tick++) {
      match.step([south, north, idle, idle]);
      bumps += match.events.filter(event => event.type === 'bump').length;
      assert(walkable(a.position) && walkable(b.position));
    }
    assert.equal(bumps, 1);
    assert(a.position.z > lane.z + 0.95 && b.position.z < lane.z - 0.95);
    assert.equal(a.carried, 'cheese');
    assert.equal(b.carried, 'tomato');
  }
});

test('reassigning the same three-chef pileup to other seats preserves outcomes', () => {
  function run(seats: number[]) {
    const match = stagedMatch();
    const controls = match.players.map(() => idle);
    const actors = seats.map(seat => match.players[seat]);
    const speeds = [1, 0.38, 0];
    for (const [i, actor] of actors.entries()) {
      pose(actor, { x: -1.66 + i * 1.11, z: 1.74 }, Math.PI / 2);
      controls[actor.id] = { x: speeds[i], z: 0 };
    }
    return Array.from({ length: 40 }, () => {
      match.step(controls);
      return actors.map(p => ({ position: p.position, recoil: { ...p.recoil }, bumpAt: p.bumpAt }));
    });
  }

  const original = run([0, 1, 2]);
  assert(original.some(tick => tick.every(actor => Number.isFinite(actor.bumpAt))));
  for (const seats of [[2, 0, 3], [3, 2, 1], [1, 3, 0]]) {
    const moved = run(seats);
    for (const [tick, actors] of original.entries()) {
      for (const [i, actor] of actors.entries()) {
        assert(distance(moved[tick][i].position, actor.position) < 1e-6);
        assert(distance(moved[tick][i].recoil, actor.recoil) < 1e-6);
        assert.equal(moved[tick][i].bumpAt, actor.bumpAt);
      }
    }
  }
});

test('a pressured chef can back into the open floor and keeps their topping', () => {
  const match = stagedMatch();
  const [runner, first, second] = match.players;
  pose(runner, { x: 5.9685, z: 1.62 }, Math.PI / 2);
  pose(first, { x: 5.2, z: 1.34 }, Math.PI / 2);
  pose(second, { x: 5.2, z: 1.91 }, Math.PI / 2);
  runner.carried = 'cheese';
  for (let tick = 0; tick < 18; tick++) match.step([idle, east, east, idle]);
  assert(Number.isFinite(runner.bumpAt));
  const before = runner.position.x;
  for (let tick = 0; tick < 24; tick++) {
    match.step([west, east, east, idle]);
    assert(match.players.every(p => walkable(p.position)));
  }
  assert(runner.position.x < before - 0.90);
  assert.equal(runner.carried, 'cheese');
});

test('a late chef can bump sideways, turn in and win the refill while both reach', () => {
  for (const shove of [false, true]) {
    const match = stagedMatch();
    const [late, early] = match.players;
    const { x, z } = APPROACHES[0].position;
    pose(early, { x: x - 0.35, z }, Math.PI);
    pose(late, { x: x + 0.35, z: z + 0.03 }, Math.PI);
    match.step([idle, idle, idle, idle]);
    match.trayReadyAt[0] = match.tick + 4;

    let bumps = 0;
    for (let tick = 0; tick < 4; tick++) {
      const steer = shove && tick < 2 ? west : north;
      match.step([steer, idle, idle, idle]);
      bumps += match.events.filter(event => event.type === 'bump').length;
    }
    assert.equal(bumps, shove ? 1 : 0);
    assert.equal(late.supplyContact, 0);
    assert.equal(early.supplyContact, 0);
    assert(late.supplySince > early.supplySince);
    const pickups = match.events.filter(event => event.type === 'pickup' && event.station === 0);
    assert.deepEqual(pickups.map(e => e.player), [shove ? late.id : early.id]);
  }
});
