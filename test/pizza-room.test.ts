import assert from 'node:assert/strict';
import test from 'node:test';
import { APPROACHES } from '../pizza-party/layout.ts';
import { PIZZA_IDLE, PIZZA_INPUT_LEAD, PIZZA_TICK_MS } from '../pizza-party/network-state.ts';
import { START_TICKS, ROUND_TICKS } from '../pizza-party/simulation.ts';
import { PizzaRound } from '../server/pizza-round.ts';

test('the connected pair shares the seeded tray and swaps spawn assignments on rematch', () => {
  const round = new PizzaRound();
  for (const seed of [1, 2, 17, 42, 110]) {
    const positions = [1, 2].map(number => {
      round.start(seed, [0, 1], number);
      const snapshot = round.snapshot(number, [], false);
      const { seats, station } = round.match.openingPair!;
      assert(seats.every(spawn => round.match.players[spawn].recipe[0] === round.match.supplies[station]));
      assert.equal(new Set(snapshot.spawnSeats).size, 4);
      return seats.map(spawn => snapshot.spawnSeats[spawn]);
    });
    assert.deepEqual(positions, [[0, 1], [1, 0]]);
  }
});

test('a disconnected human stops and the unclaimed seats remain bots', () => {
  const round = new PizzaRound();
  round.start(1, [0, 1], 1);
  for (let tick = 1; tick <= START_TICKS + 4; tick++) {
    round.queue(0, tick, { x: 1, z: 0 });
    round.step();
  }
  const { spawnSeats } = round.snapshot(1, [], false);
  const actor = round.match.players[spawnSeats.indexOf(0)];
  const bot = round.match.players[spawnSeats.indexOf(2)];
  const before = { ...actor.position }, botBefore = { ...bot.position };
  round.queue(0, round.match.tick + 6, { x: 1, z: 0 });
  round.clear(0);
  for (let step = 0; step < 8; step++) round.step();
  assert.deepEqual(actor.position, before);
  assert.notDeepEqual(bot.position, botBefore);
});

const jitter = [0, 5, -5, 2, -2, 3, -3];

function refillRace(rtt: readonly number[], enter: number, defend: boolean, jittered: boolean) {
  const round = new PizzaRound();
  round.start(17, [0, 1, 2, 3], 1);
  const match = round.match;
  match.phase = 'playing';
  match.tick = START_TICKS;
  match.trayReadyAt.fill(START_TICKS + ROUND_TICKS);
  const { x, z } = APPROACHES[0].position;
  const positions = [{ x: x + 0.35, z: z + 0.03 }, { x: x - 0.35, z: z },
    { x: 4.8, z: 2.65 }, { x: -5.65, z: 1.92 }];
  match.players.forEach((player, index) => {
    player.position = positions[index];
    player.heading = Math.PI;
  });
  round.step();
  const base = match.tick;
  match.trayReadyAt[0] = base + 16;
  const { spawnSeats } = round.snapshot(1, [], false);
  const submissions = [];
  for (let frame = 1; frame <= 16; frame++) {
    const controls = [
      frame < enter ? PIZZA_IDLE : frame < enter + 2 ? { x: -1, z: 0 } : { x: 0, z: -1 },
      !defend || frame < 11 ? PIZZA_IDLE : frame < 13 ? { x: 1, z: 0 } : { x: 0, z: -1 },
    ];
    for (const [seat, input] of controls.entries()) {
      const arrival = (frame - PIZZA_INPUT_LEAD) * PIZZA_TICK_MS + rtt[seat] / 2
        + (jittered ? jitter[(frame + seat * 3) % jitter.length] : 0);
      submissions.push({ arrival, input, seat: spawnSeats[seat], target: base + frame });
    }
  }
  submissions.sort((a, b) => a.arrival - b.arrival);
  for (let frame = 1; frame <= 16; frame++) {
    while (submissions.length && submissions[0].arrival <= frame * PIZZA_TICK_MS) {
      const command = submissions.shift()!;
      round.queue(command.seat, command.target, command.input);
    }
    round.step();
  }
  const snapshot = round.snapshot(1, [], true);
  const awards = snapshot.events.filter(event => event.type === 'pickup' && event.station === 0);
  assert(awards.length <= 1);
  if (awards.length) assert.equal(awards[0].tick, base + 16);
  assert.deepEqual(snapshot.view.players.filter(player => player.carried === snapshot.view.supplies[0]).map(player => player.id),
    awards.map(award => award.player));
  assert.equal(round.snapshot(1, [], true).events.length, 0);
  return awards[0]?.player;
}

test('44 contested refills give identical results with 30 and 120 ms RTT swapped', t => {
  const winners = new Set<number>();
  let awards = 0;
  for (let enter = 5; enter <= 15; enter++) {
    for (const defend of [false, true]) {
      for (const jittered of [false, true]) {
        const winner = refillRace([30, 120], enter, defend, jittered);
        assert.equal(winner, refillRace([120, 30], enter, defend, jittered));
        if (winner !== undefined) {
          winners.add(winner);
          awards++;
        }
      }
    }
  }
  assert(winners.size > 1, 'different moves can win the race');
  t.diagnostic(awards + ' single awards and ' + (44 - awards) + ' refills with no eligible plate in each lag assignment');
});
