import test from 'node:test';
import assert from 'node:assert/strict';
import { APPROACHES, COUNTER_GOALS, SUPPLY_GOALS, SUPPLY_RECTS } from './layout.ts';
import { routeCosts } from './navigation.ts';
import { HZ, MOVE_SPEED, PizzaMatch, RECIPES, SERVICE_TICKS, START_TICKS } from './simulation.ts';
import type { Vec } from './simulation.ts';

const idle: Vec = { x: 0, z: 0 };
const controls = [idle, idle, idle, idle];
const parking = [{ x: -4.84, z: -2.68 }, { x: 4.8, z: -2.68 }, { x: 4.8, z: 2.65 }, { x: -5.65, z: 1.92 }];

function stage() {
  const match = new PizzaMatch(17, 'closest', true);
  match.reset();
  match.tick = START_TICKS;
  match.phase = 'playing';
  for (const [seat, player] of match.players.entries()) player.position = { ...parking[seat] };
  const { station, seats } = match.openingPair!;
  const { side } = SUPPLY_RECTS[station];
  const { position, face } = APPROACHES[SUPPLY_GOALS[station][0]];
  const place = (seat: number, offset: number, setback = 0) => {
    match.players[seat].position = { x: position.x + offset, z: position.z + side * setback };
    match.players[seat].heading = Math.atan2(0, face.z - position.z);
  };
  const pickups = () => match.events.filter(event => event.type === 'pickup' && event.station === station).map(e => e.player);
  return { match, station, seats, side, place, pickups };
}

test('the opening sends two chefs with comparable routes after the same topping', () => {
  const trays = new Set<number>();
  for (let seed = 1; seed <= 32; seed++) {
    const standard = new PizzaMatch(seed);
    const shared = new PizzaMatch(seed, 'closest', true);
    assert.equal(standard.openingPair, null);
    assert.deepEqual(shared.supplies, standard.supplies);
    const { station, seats } = shared.openingPair!;
    trays.add(station);
    assert.equal(seats[0], 0);
    assert.notEqual(seats[0], seats[1]);
    for (const [id, player] of shared.players.entries()) {
      assert(RECIPES.some(order => order.every(food => player.recipe.includes(food))));
      if (id === seats[0] || id === seats[1]) assert.equal(player.recipe[0], shared.supplies[station]);
      else assert.notEqual(player.recipe[0], shared.supplies[station]);
    }
    const [near, far] = seats.map(id => routeCosts(shared.players[id].position, SUPPLY_GOALS[station], -1)[0]);
    assert(Math.abs(near - far) / MOVE_SPEED <= 0.55);
    assert.equal(shared.trayReadyAt[station], 0);
  }
  assert.equal(trays.size, 2);
});

test('each chef gets one near and one far topping per ticket and visits all four across two', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const match = new PizzaMatch(seed, 'closest', true);
    match.reset();
    match.tick = START_TICKS + SERVICE_TICKS;
    match.phase = 'playing';
    match.trayReadyAt.fill(Infinity);
    const nearest = COUNTER_GOALS.map(goals => SUPPLY_GOALS.map(([goal], station) => ({
      station, length: Math.min(...routeCosts(APPROACHES[goal].position, goals, -1)),
    })).sort((a, b) => a.length - b.length).slice(0, 2).map(tray => match.supplies[tray.station]));
    const previous = match.players.map(p => [...p.recipe]);
    for (let ticket = 0; ticket < 6; ticket++) {
      for (const player of match.players) {
        assert.equal(player.recipe.length, 2);
        assert.equal(player.recipe.filter(food => nearest[player.id].includes(food)).length, 1);
        if (ticket % 2 === 1) assert.equal(new Set([...previous[player.id], ...player.recipe]).size, 4);
        previous[player.id] = [...player.recipe];
        player.serviceAt = match.tick + 1 - SERVICE_TICKS;
        player.recipe = [];
      }
      match.step(controls);
    }
  }
});

test('a new ticket joins an existing request when routes match and no third chef has a head start', () => {
  for (const headStart of [false, true]) {
    const match = new PizzaMatch(1, 'closest', true);
    match.reset();
    match.tick = START_TICKS + HZ * 10;
    match.phase = 'playing';
    match.trayReadyAt.fill(Infinity);
    const start = match.tick;
    const [first, rival] = [match.players[0], match.players[3]];
    first.position = { x: -0.31, z: 1.9 };
    rival.position = { x: 0.31, z: 1.9 };
    first.recipe = [];
    rival.recipe = [];
    match.players[1].recipe = [];
    match.players[2].recipe = [];
    first.serviceAt = start + 1 - SERVICE_TICKS;
    rival.serviceAt = start + 13 - SERVICE_TICKS;

    match.step(controls);
    assert(match.events.some(e => e.type === 'ready' && e.player === first.id));
    const earlier = [...first.recipe];
    const station = match.supplies.indexOf(earlier[0]);
    if (headStart) {
      match.players[1].position = { ...APPROACHES[SUPPLY_GOALS[station][0]].position };
      match.players[1].recipe = [...earlier];
    }
    for (let elapsed = 2; elapsed < 13; elapsed++) {
      match.step(controls);
      assert.equal(rival.recipe.length, 0);
    }
    match.step(controls);
    const paired = match.events.find(e => e.type === 'ready' && e.player === rival.id);
    assert(paired);
    assert.equal(paired.rival, headStart ? undefined : first.id);
    if (!headStart) {
      assert.equal(paired.station, station);
      assert.equal(rival.recipe[0], earlier[0]);
    }
    assert.deepEqual(first.recipe, earlier);
  }
});

test('two chefs in reach get only one pickup and the loser waits for the next refill', () => {
  const { match, station, seats: [first, rival], place, pickups } = stage();
  place(first, -0.16);
  place(rival, 0.42);
  match.step(controls);
  assert(match.players[first].supplyContact === station && match.players[rival].supplyContact === station);
  assert.deepEqual(pickups(), [first]);
  assert.equal(match.players[rival].carried, null);
  assert.equal(match.trayReadyAt[station], match.tick + HZ);
  for (let i = 0; i < HZ - 1; i++) {
    match.step(controls);
    assert.deepEqual(pickups(), []);
  }
  match.step(controls);
  assert.deepEqual(pickups(), [rival]);
  assert.deepEqual(match.events.filter(event => event.station === station).map(event => event.type), ['refill', 'pickup']);

  const pair = match.openingPair;
  match.reset();
  assert.deepEqual(match.openingPair, pair);
  assert.equal(match.trayReadyAt[station], 0);
  assert(match.players.every(player => player.carried === null));
});

test('exact refill ties give every pair of seats an even split over eight windows', () => {
  for (let first = 0; first < 4; first++) {
    for (let rival = first + 1; rival < 4; rival++) {
      const winners = [];
      for (let window = 0; window < 8; window++) {
        const { match, station, place, pickups } = stage();
        match.tick = START_TICKS + window * 36 - 1;
        match.trayReadyAt[station] = match.tick + 1;
        place(first, -0.35);
        place(rival, 0.35);
        match.step(controls);
        assert.equal(pickups().length, 1);
        winners.push(pickups()[0]);
      }
      assert.deepEqual(winners.sort((a, b) => a - b), [first, first, first, first, rival, rival, rival, rival]);
    }
  }
});

test('a side bump can change who wins the single refill in a shared rush', () => {
  for (const shove of [false, true]) {
    const { match, station, seats: [late, early], side, place, pickups } = stage();
    place(early, -0.35);
    place(late, 0.35, 0.03);
    match.trayReadyAt[station] = Infinity;
    match.step(controls);
    match.trayReadyAt[station] = match.tick + 4;
    const movement = [...controls];
    let bumps = 0;
    for (let tick = 0; tick < 4; tick++) {
      movement[late] = shove && tick < 2 ? { x: -1, z: 0 } : { x: 0, z: -side };
      match.step(movement);
      bumps += match.events.filter(event => event.type === 'bump').length;
    }
    assert.equal(bumps, shove ? 1 : 0);
    assert(match.players[late].supplyContact === station && match.players[early].supplyContact === station);
    assert.deepEqual(pickups(), [shove ? late : early]);
    assert.equal(match.players[shove ? early : late].carried, null);
  }
});
