import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FUSE_TICKS, HZ, LIMIT, Match, PASS_TICKS, READY_TICKS, ROUTES, STUN_TICKS, routePoint,
} from '../src/simulation.ts';
import type { ChasePolicy, Vec } from '../src/simulation.ts';

const zero = { x: 0, z: 0 };
function advance(match: Match, ticks: number, input = zero): void {
  for (let i = 0; i < ticks; i++) match.step(input);
}

function fixture(seed = 17, policy: ChasePolicy = 'nearest'): Match {
  const match = new Match(seed, policy);
  match.start();
  advance(match, READY_TICKS + 30);
  for (const lane of match.lanes) lane.next = Infinity;
  for (const [id, player] of match.players.entries()) {
    place(match, id, { x: 3 + (id % 2) * 2, z: 3 - (id > 1 ? 2 : 0) });
    player.stunnedUntil = 2000;
  }
  match.holder = 0;
  return match;
}

function place(match: Match, player: number, position: Vec): void {
  Object.assign(match.players[player], { position, previous: position, drive: zero, impulse: zero });
}

test('four couriers start after ready and first assignment opens a 10.5 s fuse', () => {
  const match = new Match(17);
  match.start();
  const start = match.players[0].position;
  advance(match, READY_TICKS - 1, { x: 1, z: 0 });
  assert.equal(match.phase, 'ready');
  assert.deepEqual(match.players[0].position, start);
  advance(match, 31, { x: 1, z: 0 });
  assert.equal(match.phase, 'play');
  assert.equal(match.players.filter(player => player.alive).length, 4);
  assert.equal(match.remaining, FUSE_TICKS);
  assert.equal(match.passAt - match.tick, PASS_TICKS);
  assert.ok(match.players[0].position.x > start.x);
});

test('pass preserves the deadline and locks the recipient for an exact second', () => {
  const match = fixture();
  advance(match, PASS_TICKS - 1);
  place(match, 0, { x: 0, z: 0 });
  place(match, 1, { x: 0.87, z: 0 });
  const deadline = match.deadline;
  match.step(zero);
  assert.equal(match.holder, 1);
  assert.equal(match.deadline, deadline);
  assert.equal(match.passAt - match.tick, HZ);
  assert.deepEqual(match.events, [{ type: 'pass', player: 1 }]);
});

test('contact before unlock needs separation and a fresh entry', () => {
  const match = fixture();
  for (let i = 0; i <= PASS_TICKS; i++) {
    place(match, 0, { x: 0, z: 0 });
    place(match, 1, { x: 0.93, z: 0 });
    match.step(zero);
    assert.equal(match.holder, 0);
  }
  place(match, 1, { x: 2, z: 0 });
  match.step(zero);
  place(match, 1, { x: 0.87, z: 0 });
  match.step(zero);
  assert.equal(match.holder, 1);
});

test('a late pass eliminates the recipient, even during the pass lock', () => {
  const match = fixture();
  advance(match, PASS_TICKS);
  match.deadline = match.tick + 2;
  place(match, 0, zero);
  place(match, 1, { x: 0.9, z: 0 });
  match.step(zero);
  assert.equal(match.holder, 1);
  assert.equal(match.remaining, 1);
  match.step(zero);
  assert.equal(match.holder, null);
  assert.equal(match.players[1].alive, false);
  assert.equal(match.players[0].alive, true);
  advance(match, HZ - 1);
  assert.equal(match.holder, null);
  match.step(zero);
  assert.notEqual(match.holder, null);
  assert.equal(match.remaining, FUSE_TICKS);
});

test('expiry takes priority over contact on its exact tick', () => {
  const match = fixture();
  advance(match, PASS_TICKS);
  place(match, 0, zero);
  place(match, 1, { x: 0.9, z: 0 });
  match.deadline = match.tick + 1;
  match.step(zero);
  assert.deepEqual(match.events, [{ type: 'blast', player: 0 }]);
  assert.equal(match.players.filter(player => player.alive).length, 3);
});

test('simultaneous contacts pick one recipient by stable ID', () => {
  const match = fixture();
  advance(match, PASS_TICKS);
  place(match, 0, zero);
  place(match, 1, { x: 0.89, z: 0 });
  place(match, 2, { x: -0.89, z: 0 });
  match.step(zero);
  assert.deepEqual(match.events, [{ type: 'pass', player: 1 }]);
});

function putCartAtCenter(match: Match, lane: number): void {
  const elapsed = Math.floor(ROUTES[lane].duration / 2);
  const position = routePoint(lane, elapsed / ROUTES[lane].duration);
  match.carts.push({ lane, start: match.tick - elapsed, position, previous: position, heading: 0, contacts: 0 });
}

test('cart hit preserves the fuse and allows impact movement during the two-second stun', () => {
  const match = fixture();
  match.players[0].stunnedUntil = 0;
  const position = routePoint(0, 0.5);
  place(match, 0, position);
  putCartAtCenter(match, 0);
  const deadline = match.deadline;
  match.step(zero);
  const recovery = match.players[0].stunnedUntil;
  assert.equal(recovery - match.tick, STUN_TICKS);
  assert.equal(match.deadline, deadline);
  assert.equal(match.holder, 0);
  assert.equal(match.players[0].alive, true);
  match.carts = [];
  match.step({ x: 1, z: 0 });
  assert.deepEqual(match.players[0].drive, zero);
  assert.notDeepEqual(match.players[0].position, position);
  advance(match, recovery - match.tick - 1, { x: 1, z: 0 });
  assert.deepEqual(match.players[0].drive, zero);
  match.step({ x: 1, z: 0 });
  assert.ok(match.players[0].drive.x > 0);
});

test('cart sweep catches a strike between endpoints', () => {
  const match = fixture();
  const lane = 0;
  const position = routePoint(lane, 0);
  match.carts.push({ lane, start: match.tick - 132, position, previous: position, heading: 0, contacts: 0 });
  match.players[0].stunnedUntil = 0;
  place(match, 0, { x: -5, z: -2.2 });
  match.step(zero);
  assert.ok(match.events.some(event => event.type === 'hit' && event.player === 0));
});

test('both carts block a courier at the rear side of the bumper', () => {
  for (const lane of [0, 1]) {
    const match = fixture();
    const pose = approachingCart(match, lane);
    const rear = offsetFromCart(pose, -1.27, 0.95);
    match.players[0].stunnedUntil = 0;
    place(match, 0, rear);
    match.step(zero);
    assert.ok(match.events.some(event => event.type === 'hit' && event.player === 0), 'the rear-side contact must register');
    const after = match.players[0].position;
    const lateralGap = (after.x - pose.center.x) * pose.side.x + (after.z - pose.center.z) * pose.side.z;
    assert.ok(lateralGap >= 0.97, 'the solid body must move the courier out of the bumper');
  }
});

test('a fast crossing stops on the entry side of the cart body', () => {
  const match = fixture();
  const pose = approachingCart(match, 0);
  match.players[0].stunnedUntil = 0;
  place(match, 0, offsetFromCart(pose, -1.1, -1.65));
  match.players[0].impulse = { x: pose.side.x * HZ * 3.3, z: pose.side.z * HZ * 3.3 };
  match.step(zero);
  const after = match.players[0].position;
  const lateralGap = (after.x - pose.center.x) * pose.side.x + (after.z - pose.center.z) * pose.side.z;
  assert.ok(lateralGap <= -0.97, 'entry from one side cannot deposit the courier on the opposite side');
  assert.equal(match.players[0].stunnedUntil, match.tick + STUN_TICKS);
});

function approachingCart(match: Match, lane: number) {
  putCartAtCenter(match, lane);
  const progress = (match.tick + 1 - match.carts[0].start) / ROUTES[lane].duration;
  const center = routePoint(lane, progress);
  const ahead = routePoint(lane, progress + 0.001);
  const angle = Math.atan2(ahead.z - center.z, ahead.x - center.x);
  return { center, axis: {x: Math.cos(angle), z: Math.sin(angle)}, side: {x: -Math.sin(angle), z: Math.cos(angle)} };
}

function offsetFromCart(pose: ReturnType<typeof approachingCart>, lengthwise: number, lateral: number): Vec {
  return {
    x: pose.center.x + pose.axis.x * lengthwise + pose.side.x * lateral,
    z: pose.center.z + pose.axis.z * lengthwise + pose.side.z * lateral,
  };
}

test('a second cart strike does not extend stun and a stunned player can pass', () => {
  const match = fixture();
  advance(match, PASS_TICKS);
  match.players[0].stunnedUntil = 0;
  place(match, 0, routePoint(0, 0.5));
  putCartAtCenter(match, 0);
  match.step(zero);
  const recovery = match.players[0].stunnedUntil;
  assert.equal(recovery, match.tick + STUN_TICKS);
  match.carts = [];
  place(match, 0, routePoint(1, 0.5));
  putCartAtCenter(match, 1);
  match.step(zero);
  assert.equal(match.players[0].stunnedUntil, recovery);
  assert.ok(Math.hypot(match.players[0].impulse.x, match.players[0].impulse.z) > 5);
  assert.deepEqual(match.events, []);
  place(match, 1, { ...match.players[0].position, x: match.players[0].position.x + 0.85 });
  match.step(zero);
  assert.equal(match.holder, 1);
});

test('both routes overlap in time and keep distinct seeded schedules', () => {
  const match = new Match(18);
  match.start();
  const starts = [new Set<number>(), new Set<number>()];
  let overlapping = false;
  for (let i = 0; i < HZ * 10; i++) {
    match.step(zero);
    for (const cart of match.carts) starts[cart.lane].add(cart.start);
    overlapping ||= new Set(match.carts.map(cart => cart.lane)).size === 2;
  }
  assert.ok(overlapping);
  for (const [lane, values] of starts.entries()) {
    const times = [...values];
    assert.ok(times.length >= 2);
    const [min, max] = ROUTES[lane].wait.map(seconds => Math.round(seconds * 2 * HZ));
    assert.ok(times.slice(1).every((time, i) => time - times[i] >= min && time - times[i] <= max));
  }
  assert.notDeepEqual([...starts[0]], [...starts[1]]);
});

test('a bot repositions after receiving the core and starts chasing when the lock ends', () => {
  const match = fixture();
  advance(match, 4);
  place(match, 0, { x: 0.9, z: 0 });
  place(match, 1, zero);
  match.passAt = match.tick;
  match.step(zero);
  assert.equal(match.holder, 1);

  place(match, 0, { x: 2.2, z: 0 });
  place(match, 1, zero);
  advance(match, PASS_TICKS - 5);
  match.players[1].stunnedUntil = 0;
  advance(match, 4);
  assert.equal(match.tick, match.passAt - 1);
  assert.ok(match.players[1].drive.x < -1, 'the locked bot can move and takes space away from the nearby player');

  advance(match, 5);
  assert.ok(match.players[1].drive.x > 2, 'the unlocked bot pursues the nearby player');
});

test('eligible bot carriers chase while other bots evade', () => {
  const match = fixture();
  advance(match, 10);
  for (const id of [1, 2, 3]) match.players[id].stunnedUntil = 0;
  match.holder = 1;
  match.passAt = match.tick;
  place(match, 0, { x: 1.8, z: 0 });
  place(match, 1, zero);
  place(match, 2, { x: -2.5, z: 0 });
  place(match, 3, { x: -4, z: 4 });
  advance(match, 10);
  assert.ok(match.players[1].drive.x > 2);
  assert.ok(match.players[2].drive.x < -1);
});

test('a bot notices a nearby cart and steers clear after its reaction delay', () => {
  function driveAfter(ticks: number): Vec {
    const match = fixture();
    advance(match, 10);
    match.holder = 1;
    match.passAt = match.tick;
    place(match, 0, { x: 0.3, z: -3.9 });
    place(match, 1, { x: 0.3, z: -0.5 });
    place(match, 2, { x: 5, z: 3 });
    place(match, 3, { x: -5, z: 3 });
    const elapsed = 106;
    const position = routePoint(0, elapsed / ROUTES[0].duration);
    match.carts.push({ lane: 0, start: match.tick - elapsed, position, previous: position, heading: 0, contacts: 0 });

    // Keep the bot in place while it sees the approaching cart, then sample its first step.
    advance(match, ticks - 1);
    match.players[1].stunnedUntil = 0;
    match.step(zero);
    assert.equal(match.players[1].stunnedUntil, 0);
    return match.players[1].drive;
  }
  const beforeReaction = driveAfter(15);
  const afterReaction = driveAfter(20);
  assert.ok(beforeReaction.z < -1 && Math.abs(beforeReaction.x) < 0.01);
  assert.ok(afterReaction.x < -1 && afterReaction.z > beforeReaction.z);
});

test('route-test carrier chooses the clearer chase and keeps it for a short interval', () => {
  function atCrossing(policy: ChasePolicy): Match {
    const match = fixture(17, policy);
    advance(match, 10);
    match.holder = 1;
    match.passAt = match.tick + 20;
    place(match, 0, { x: 0.3, z: -3.3 });
    place(match, 1, { x: 0.3, z: -0.5 });
    place(match, 2, { x: 3.2, z: -0.5 });
    place(match, 3, { x: -6, z: 3 });
    const elapsed = 106;
    const position = routePoint(0, elapsed / ROUTES[0].duration);
    match.carts.push({ lane: 0, start: match.tick - elapsed, position, previous: position, heading: 0, contacts: 0 });
    advance(match, 19);
    match.players[1].stunnedUntil = 0;
    match.step(zero);
    return match;
  }

  const nearest = atCrossing('nearest');
  const route = atCrossing('clear-route');
  assert.ok(nearest.players[1].drive.x < -1);
  assert.ok(route.players[1].drive.x > 1);

  route.carts = [];
  place(route, 0, { x: -1.4, z: -0.5 });
  advance(route, 5);
  assert.ok(route.players[1].drive.x > 2);

  route.players[1].stunnedUntil = route.tick + 15;
  advance(route, 15);
  assert.ok(route.players[1].drive.x < -1);
});

test('50 four-player runs finish with three eliminations; seeded replay and reset agree', () => {
  function run(seed: number, match = new Match(seed)): string[] {
    match.start(seed);
    const log: string[] = [];
    while (match.phase !== 'result' && match.tick < HZ * 45) {
      const input = { x: Math.sin(match.tick / 66), z: Math.cos(match.tick / 121) };
      match.step(input);
      for (const event of match.events) log.push(JSON.stringify([match.tick, event]));
      for (const player of match.players) {
        assert.ok(Math.abs(player.position.x) <= LIMIT.x && Math.abs(player.position.z) <= LIMIT.z);
      }
    }
    assert.equal(match.phase, 'result');
    assert.equal(match.players.filter(player => player.alive).length, 1);
    assert.ok(match.winner !== null && match.players[match.winner].alive);
    assert.equal(log.filter(line => line.includes('"blast"')).length, 3);
    return log;
  }
  const statistics = Array.from({ length: 50 }, (_, seed) => run(seed));
  assert.ok(statistics.filter(log => log.some(line => line.includes('"pass"'))).length >= 30);
  assert.ok(statistics.filter(log => log.some(line => line.includes('"hit"'))).length >= 30);
  const reused = new Match(0);
  const first = run(0, reused);
  assert.deepEqual(run(0, reused), first);
  reused.start(0);
  assert.equal(reused.tick, 0);
  assert.equal(reused.phase, 'ready');
  assert.equal(reused.holder, null);
  assert.equal(reused.winner, null);
  assert.equal(reused.carts.length, 0);
  assert.ok(reused.players.every(player => player.alive && !player.stunnedUntil));
});
