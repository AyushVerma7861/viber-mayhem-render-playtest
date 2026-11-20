import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_FRAME_GAP, planFrame } from '../src/frame-clock.ts';
import { FUSE_TICKS, HZ, Match, STEP } from '../src/simulation.ts';
import { KITCHEN_ARENA } from '../src/arena.ts';

function replay(intervals: number[], frames: number) {
  const match = new Match(17, 'nearest', KITCHEN_ARENA);
  match.start();
  let remainder = 0;
  const events: unknown[] = [];
  for (let frame = 0; frame < frames; frame++) {
    const timing = planFrame(remainder, intervals[frame % intervals.length]);
    assert.equal(timing.interrupted, false);
    remainder = timing.remainder;
    for (let step = 0; step < timing.steps; step++) {
      match.step({ x: Math.cos(match.tick / 39), z: Math.sin(match.tick / 39) });
      events.push(...match.events.map(event => ({ tick: match.tick, ...event })));
    }
  }
  return { tick: match.tick, players: match.players, carts: match.carts,
    winner: match.winner, deadline: match.deadline, events };
}

test('full kitchen matches have identical states and events at 5–144 rendered fps', () => {
  const baseline = replay([1 / 60], 45 * 60);
  for (const fps of [5, 10, 15, 30, 120, 144]) {
    assert.deepEqual(replay([1 / fps], 45 * fps), baseline, 'render fps ' + fps);
  }
  assert.deepEqual(replay([0.05, 0.15], 450), baseline, 'alternating slow frames');
});

test('the fuse expires after 10.5 active seconds within one rendered frame at each fps', () => {
  for (const fps of [5, 10, 15, 30, 60, 144]) {
    const match = new Match(17, 'nearest', KITCHEN_ARENA);
    match.start(); match.phase = 'play'; match.holder = 0;
    match.deadline = FUSE_TICKS; match.passAt = Infinity; match.assignAt = Infinity;
    match.lanes.forEach(lane => { lane.next = Infinity; });
    match.players.forEach(player => { player.stunnedUntil = Infinity; });
    let remainder = 0, frames = 0, expiredAt = -1;
    while (expiredAt < 0 && frames < 12 * fps) {
      const timing = planFrame(remainder, 1 / fps);
      remainder = timing.remainder; frames++;
      for (let step = 0; step < timing.steps; step++) {
        match.step({ x: 0, z: 0 });
        if (match.events.some(event => event.type === 'blast' && event.player === 0)) expiredAt = match.tick;
      }
    }
    assert.equal(expiredAt, FUSE_TICKS);
    assert(frames / fps >= FUSE_TICKS / HZ - 1e-9);
    assert(frames / fps <= FUSE_TICKS / HZ + 1 / fps + 1e-9);
  }
});

test('a long interruption consumes no ticks and discards pending fractional time', () => {
  const interrupted = planFrame(STEP / 2, MAX_FRAME_GAP + 0.01);
  assert.deepEqual(interrupted, { steps: 0, remainder: 0, interrupted: true });
  const resumed = planFrame(interrupted.remainder, STEP);
  assert.deepEqual(resumed, { steps: 1, remainder: 0, interrupted: false });
  assert.equal(planFrame(0, MAX_FRAME_GAP).steps, 15);
});

test('fractional high refresh frames accumulate without dropping time', () => {
  const half = planFrame(0, STEP / 2);
  assert.equal(half.steps, 0);
  assert.deepEqual(planFrame(half.remainder, STEP / 2), { steps: 1, remainder: 0, interrupted: false });
  assert.equal(planFrame(0, -1).steps, 0);
  assert.equal(planFrame(0, NaN).interrupted, true);
});
