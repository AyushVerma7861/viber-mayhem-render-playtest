import assert from 'node:assert/strict';
import test from 'node:test';
import { KITCHEN_ARENA } from '../src/arena.ts';
import { HZ, PLAYER_RADIUS, stepPlayerMotion } from '../src/simulation.ts';
import type { Player, Vec } from '../src/simulation.ts';
import type { AppliedInput, Snapshot } from '../src/online-protocol.ts';
import { OnlineMovement } from '../src/online-movement.ts';

const stepMs = 1000 / HZ;
const idle = { x: 0, z: 0 };
const right = { x: 1, z: 0 };
const left = { x: -1, z: 0 };

function player(position: Vec = idle): Player {
  return { id: 0, position, previous: position, drive: idle, impulse: idle, heading: 0,
    alive: true, stunnedUntil: 0, eliminatedAt: -1 };
}

function snapshot(tick: number, motion: Player = player(), applied: AppliedInput | null = null,
  round = 1, acknowledged = applied?.sequence ?? -1): Snapshot {
  return {
    round, acknowledgments: [acknowledged], appliedInputs: [applied],
    view: {
      tick, phase: 'play', playAt: 120, holder: 1, passAt: 250, remaining: 600, winner: null,
      players: [motion], carts: [], lanes: [], events: [],
    },
  };
}

test('local steering moves on the first simulation step ahead of any input confirmation', () => {
  const predictor = new OnlineMovement();
  const initial = snapshot(180);
  predictor.reconcile(initial, 0, 0);
  const pose = predictor.advance(stepMs, right, 0);
  assert.ok(pose && pose.position.x > 0);
  assert.equal(predictor.confirmationMs, undefined);
  assert.equal(initial.view.players[0].position.x, 0);
  assert.equal(initial.view.holder, 1);
});

test('reconciliation replays inputs newer than the applied tick even when the network accepted them already', () => {
  const predictor = new OnlineMovement();
  predictor.reconcile(snapshot(180), 0, 0);
  const authoritative = player();
  for (let tick = 1; tick <= 4; tick++) {
    predictor.advance(tick * stepMs, right, tick === 1 ? 0 : undefined);
    stepPlayerMotion(authoritative, right, KITCHEN_ARENA, false);
  }
  predictor.advance(5 * stepMs, left, 1);
  const local = predictor.advance(6 * stepMs, left)!;
  predictor.reconcile(snapshot(184, authoritative, { sequence: 0, tick: 181 }, 1, 1), 0, 6 * stepMs);
  assert.deepEqual(predictor.advance(6 * stepMs, left), local);
  assert.equal(predictor.correctionDistance, 0);
  assert.ok(predictor.confirmationMs! > 0);
});

test('small authoritative corrections ease in and larger corrections snap', () => {
  const predictor = new OnlineMovement();
  predictor.reconcile(snapshot(180), 0, 0);
  predictor.reconcile(snapshot(183, player({ x: 0.3, z: 0 })), 0, 50);
  assert.equal(predictor.advance(50, idle)!.position.x, 0);
  const eased = predictor.advance(85, idle)!.position.x;
  assert.ok(eased > 0 && eased < 0.3);
  predictor.reconcile(snapshot(186, player({ x: 3, z: 0 })), 0, 100);
  assert.equal(predictor.advance(100, idle)!.position.x, 3);
});

test('a confirmed stun or elimination clears prediction and a new round starts from its own pose', () => {
  const predictor = new OnlineMovement();
  predictor.reconcile(snapshot(180), 0, 0);
  predictor.advance(stepMs, right, 0);
  predictor.reconcile(snapshot(183, { ...player(), stunnedUntil: 300 }), 0, 50);
  assert.equal(predictor.advance(60, right, 1), undefined);
  predictor.reconcile(snapshot(300, player({ x: 2, z: 0 })), 0, 70);
  assert.equal(predictor.advance(70, idle)!.position.x, 2);
  predictor.reconcile(snapshot(303, { ...player(), alive: false }), 0, 80);
  assert.equal(predictor.advance(90, right, 2), undefined);
  predictor.reconcile(snapshot(180, player({ x: -2, z: 0 }), null, 2), 0, 100);
  assert.equal(predictor.advance(100, idle)!.position.x, -2);
});

test('prediction stays inside arena walls and stops advancing during a snapshot interruption', () => {
  const predictor = new OnlineMovement();
  const wall = KITCHEN_ARENA.bounds.x - PLAYER_RADIUS;
  predictor.reconcile(snapshot(180, player({ x: wall - 0.04, z: 0 })), 0, 0);
  for (let tick = 1; tick <= 20; tick++) predictor.advance(tick * stepMs, right);
  const stalled = predictor.advance(600, right)!;
  assert.equal(stalled.position.x, wall);
  assert.deepEqual(stalled.drive, idle);
  assert.deepEqual(predictor.advance(800, left), stalled);
  predictor.reconcile(snapshot(240, player({ x: 1, z: 0 })), 0, 900);
  assert.equal(predictor.advance(900, idle)!.position.x, 1);
});
