import test from 'node:test';
import assert from 'node:assert/strict';
import { PizzaMatch, START_TICKS, ROUND_TICKS, SERVICE_TICKS, TRAY_REFILL_TICKS, HOMES, SUPPLY_POINTS, RECIPES } from './simulation.ts';
import type { Player, RefillPriority, Vec } from './simulation.ts';
import { APPROACHES, COUNTERS, COUNTER_GOALS, CROSSINGS, PLATE_RADIUS, PLATE_REACH, PLAYER_RADIUS, SOLIDS, SUPPLY_GOALS, SUPPLY_RECTS, crossingAt } from './layout.ts';
import { circleRect, clear, inside, walkable } from './geometry.ts';
import { routeCosts } from './navigation.ts';
import { platePosition } from './simulation.ts';

function playing(seed = 17, priority: RefillPriority = 'closest'): PizzaMatch {
  const match = new PizzaMatch(seed, priority);
  match.reset(seed);
  for (let t = 0; t < START_TICKS; t++) match.step();
  return match;
}

function parkBots(match: PizzaMatch) {
  const parking = [{ x: -4.84, z: -2.68 }, { x: 4.8, z: -2.68 }, { x: 4.8, z: 2.65 }];
  match.players.slice(1).forEach((other, index) => {
    other.position = { ...parking[index] };
    other.previous = { ...parking[index] };
    other.target = { ...parking[index] };
    other.progressPosition = { ...parking[index] };
    other.targetAt = Infinity;
  });
}

function enter(match: PizzaMatch, point: Vec, seat = 0, targetGoal?: number): void {
  parkBots(match);
  const player = match.players[seat];
  const home = HOMES.indexOf(point), supply = SUPPLY_POINTS.indexOf(point);
  const goal = home >= 0 ? COUNTER_GOALS[home][0] : supply >= 0 ? SUPPLY_GOALS[supply][0] : -1;
  const pose = APPROACHES[goal];
  const body = pose?.position ?? point, aim = pose?.face ?? { x: body.x, z: body.z + 1 };
  player.position = { ...body };
  player.previous = { ...body };
  player.heading = Math.atan2(aim.x - body.x, aim.z - body.z);
  if (seat > 0 && pose) {
    player.goal = targetGoal ?? goal;
    player.target = { ...body };
  }
  player.homeContact = false;
  player.supplyContact = -1;
  match.step();
}



test('1.2 second ready and exact 85 second deadline freeze the result', () => {
  const match = new PizzaMatch(17);
  match.reset();
  for (let i = 0; i < START_TICKS - 1; i++) match.step();
  assert.equal(match.phase, 'ready');
  match.step();
  assert.equal(match.phase, 'playing');
  assert.equal(match.remaining, 5100);
  for (let i = 0; i < ROUND_TICKS - 1; i++) match.step();
  assert.equal(match.phase, 'playing');
  assert.equal(match.remaining, 1);
  match.step();
  assert.equal(match.phase, 'over');
  const result = JSON.stringify(match.players);
  match.step({ x: 1, z: 1 });
  assert.equal(JSON.stringify(match.players), result);
});

test('two opposed serving pairs are connected by two narrow crossings and two edge routes', () => {
  assert.deepEqual(COUNTERS.map(({ inward }) => inward), [{ x: 0, z: -1 }, { x: 0, z: 1 }, { x: 0, z: -1 }, { x: 0, z: 1 }]);
  for (const { center, trigger } of COUNTERS) {
    assert(!walkable(center), 'windows should block the body like the prep stations do');
    assert(walkable(trigger, 0), 'plates should reach the serving front from inside the arena');
  }
  assert.equal(SOLIDS.length, 3);
  assert.equal(CROSSINGS.length, 2);
  for (const crossing of CROSSINGS) {
    assert(crossing.width > 4 * PLAYER_RADIUS && crossing.width < 1.5);
    assert(clear({ x: crossing.x, z: -2.15 }, { x: crossing.x, z: 2.15 }));
  }
  for (const x of [-5.23, 5.21]) {
    assert(clear({ x, z: -2.15 }, { x, z: 2.15 }), 'both edge routes should be playable');
  }
  for (const { center } of SOLIDS) {
    assert(!clear({ x: center.x, z: -2.15 }, { x: center.x, z: 2.15 }), 'chefs must go around the equipment');
  }
});

test('blocking one crossing only reroutes trips that need that crossing', () => {
  for (const [id, goal] of [COUNTER_GOALS[0][0], COUNTER_GOALS[2][1]].entries()) {
    const start = { x: CROSSINGS[id].x, z: -2.15 };
    const [normal] = routeCosts(start, [goal], -1);
    const [usingOpenGap] = routeCosts(start, [goal], 1 - id);
    const [avoidingBlockedGap] = routeCosts(start, [goal], id);
    assert.equal(usingOpenGap, normal);
    assert(avoidingBlockedGap > normal + 1.5 && Number.isFinite(avoidingBlockedGap));
  }
});

test('the four ingredient bins sit in pairs on the side tables', () => {
  const binsPerTable = SOLIDS.map(({ points }) => SUPPLY_POINTS.filter(point => inside(point, points)).length);
  assert.deepEqual(binsPerTable, [2, 0, 2]);
});

test('every chef starts outside the widened pickup zones', () => {
  const match = new PizzaMatch(17);
  for (const player of match.players) {
    assert(SUPPLY_RECTS.every(rect => circleRect(platePosition(player), rect).distance > PLATE_RADIUS + 0.012));
  }
});

test('bots skip an unplanned second topping and recover after a rejected delivery', () => {
  const match = playing();
  const bot = match.players[1];
  const lettuce = match.supplies.indexOf('lettuce'), tomato = match.supplies.indexOf('tomato');
  bot.recipe = ['lettuce', 'tomato'];

  enter(match, SUPPLY_POINTS[tomato], bot.id, SUPPLY_GOALS[lettuce][0]);
  assert.equal(bot.carried, null);
  assert.equal(match.events.some(event => event.player === bot.id && event.type === 'pickup'), false);
  bot.targetAt = match.tick;
  match.step();
  assert(SUPPLY_GOALS[lettuce].includes(bot.goal));

  enter(match, SUPPLY_POINTS[lettuce], bot.id);
  assert.equal(bot.carried, 'lettuce');
  match.step();
  assert(COUNTER_GOALS[bot.id].includes(bot.goal));

  bot.recipe = ['tomato'];
  enter(match, HOMES[bot.id], bot.id);
  assert.equal(bot.carried, null);
  assert.deepEqual(bot.recipe, ['tomato']);
  assert.equal(bot.score, 0);
  match.step();
  assert(SUPPLY_GOALS[tomato].includes(bot.goal));
});

test('a bot can take its other topping when the first pickup spot is jammed', () => {
  const match = playing();
  parkBots(match);
  const bot = match.players[1];
  const station = 2;
  const [face] = SUPPLY_GOALS[station];
  const other = 3;
  bot.position = { ...APPROACHES[SUPPLY_GOALS[other][0]].position };
  bot.progressPosition = { ...bot.position };
  bot.progressAt = match.tick;
  bot.recipe = [match.supplies[station], match.supplies[other]];
  bot.goal = COUNTER_GOALS[bot.id][0];
  bot.targetAt = match.tick;

  bot.position.z -= 0.6;
  bot.progressPosition = { ...bot.position };
  match.step();
  assert.equal(bot.goal, face);

  bot.avoidGoal = face;
  bot.avoidUntil = match.tick + 120;
  bot.targetAt = match.tick;
  match.step();
  assert.equal(bot.goal, SUPPLY_GOALS[other][0]);
  enter(match, SUPPLY_POINTS[other], bot.id);
  assert.equal(bot.carried, match.supplies[other]);
});

test('every tray takes pickups at its marked long face and rejects reaches from the end', () => {
  for (let index = 0; index < SUPPLY_GOALS.length; index++) {
    const match = playing(17);
    const [front] = SUPPLY_GOALS[index].map(goal => APPROACHES[goal]);
    assert.equal(front.position.x, front.face.x);
    assert.equal(crossingAt(front.position), -1, 'a blocked crossing must leave the long-face pickup available');
    parkBots(match);
    const chef = match.players[0];
    const { center, halfWidth } = SUPPLY_RECTS[index];
    const end = index % 2 === 0 ? -1 : 1;
    chef.position = { x: center.x + end * (halfWidth + PLATE_REACH + PLATE_RADIUS - 0.008), z: center.z };
    chef.heading = -end * Math.PI / 2;
    assert(walkable(chef.position));
    assert(circleRect(platePosition(chef), SUPPLY_RECTS[index]).distance <= PLATE_RADIUS + 0.012);
    match.step();
    assert.equal(chef.carried, null);
    assert.equal(match.trayReadyAt[index], 0);
    enter(match, SUPPLY_POINTS[index]);
    assert.equal(chef.carried, match.supplies[index]);
  }
});

test('refill takes exactly one second and a lined-up runner collects without leaving', () => {
  const match = playing();
  match.players[1].recipe = [match.supplies[0]];
  enter(match, SUPPLY_POINTS[0], 1);
  assert.equal(match.players[1].carried, match.supplies[0]);
  const deadline = match.tick + TRAY_REFILL_TICKS;
  assert.equal(deadline - match.tick, 60);
  assert.equal(match.trayReadyAt[0], deadline);
  assert.equal(match.trayReadyAt[1], 0);

  enter(match, SUPPLY_POINTS[0]);
  while (match.tick < deadline - 1) match.step();
  assert.equal(match.players[0].supplyContact, 0);
  assert.equal(match.players[0].carried, null);
  match.step();
  assert.equal(match.tick, deadline);
  assert.equal(match.players[0].carried, match.supplies[0]);
  assert.deepEqual(match.events.filter(event => event.station === 0).map(event => event.type), ['refill', 'pickup']);
  match.reset();
  assert.deepEqual(match.trayReadyAt, [0, 0, 0, 0]);
});

test('a bot inches forward when its plate stops just short of the only pickup spot', () => {
  const match = playing(42);
  parkBots(match);
  const bot = match.players[3];
  const [goal] = SUPPLY_GOALS[3];
  const { position, face } = APPROACHES[goal];
  bot.recipe = [match.supplies[3]];
  bot.goal = goal;
  bot.target = { ...position };
  bot.position = { x: position.x, z: position.z - 0.024 };
  bot.heading = Math.atan2(0, face.z - position.z);
  for (let tick = 0; tick < 4 && !bot.carried; tick++) match.step();
  assert.equal(bot.carried, match.supplies[3]);
});

test('equal plate reach at refill is broken by earlier arrival', () => {
  const match = playing();
  parkBots(match);
  const [human, bot] = match.players;
  const { position, face } = APPROACHES[SUPPLY_GOALS[0][0]];
  const pose = (runner: Player, x: number) => {
    runner.position = { x: position.x + x, z: position.z };
    runner.heading = Math.atan2(0, face.z - position.z);
  };
  pose(human, -0.15);
  pose(bot, 0.15);
  bot.recipe = [match.supplies[0]];
  bot.supplyContact = 0;
  bot.supplySince = match.tick - 3;
  match.trayReadyAt[0] = match.tick;
  // Collect together after movement. Test arbitration separately from collision separation.
  (match as unknown as { collectToppings(): void }).collectToppings();
  assert.equal(human.carried, null);
  assert.equal(bot.carried, match.supplies[0]);
  assert.equal(match.events.filter(event => event.type === 'pickup').length, 1);
  assert.equal(match.trayReadyAt[0], match.tick + TRAY_REFILL_TICKS);
});

test('a later but closer plate wins the refill race in a real simulation step', () => {
  for (const rule of ['arrival', 'closest'] as const) {
    const match = playing(17, rule);
    parkBots(match);
    const [late, early] = match.players;
    const [goal] = SUPPLY_GOALS[0];
    const { position, face } = APPROACHES[goal];
    early.position = { x: position.x + 0.42, z: position.z };
    early.target = { ...early.position };
    early.goal = goal;
    early.recipe = [match.supplies[0]];
    early.supplyContact = 0;
    early.supplySince = match.tick - 10;
    late.position = { x: position.x - 0.19, z: position.z };
    late.heading = early.heading = Math.atan2(0, face.z - position.z);
    match.trayReadyAt[0] = match.tick + 1;

    match.step();
    assert.equal(late.supplyContact, 0);
    assert.equal(early.supplyContact, 0);
    const pickup = match.events.filter(event => event.type === 'pickup' && event.station === 0);
    assert.deepEqual(pickup.map(event => event.player), [rule === 'closest' ? late.id : early.id]);
  }
});



test('a forward plate can collect while its body stays outside the solid bench', () => {
  const match = playing();
  enter(match, SUPPLY_POINTS[0]);
  const player = match.players[0];
  assert(walkable(player.position));
  assert.equal(player.carried, match.supplies[0]);
  assert(Math.abs(Math.hypot(platePosition(player).x - player.position.x, platePosition(player).z - player.position.z) - PLATE_REACH) < 0.00001);
  player.carried = null;
  player.supplyContact = -1;
  player.heading += Math.PI;
  match.step();
  assert.equal(player.carried, null, 'turning away must move the plate away from the topping');
});

test('the serving strip accepts two clean approaches and rejects a sideways plate', () => {
  const match = playing();
  const player = match.players[0], counter = COUNTERS[0];
  player.recipe = ['tomato', 'cheese'];
  player.carried = 'tomato';
  enter(match, HOMES[0]);
  assert.equal(player.carried, null);
  assert.deepEqual(player.recipe, ['cheese']);
  player.carried = 'cheese';
  player.homeContact = false;
  player.heading += Math.PI / 2;
  match.step();
  assert.equal(player.carried, 'cheese');
  assert(circleRect(platePosition(player), { center: counter.trigger, halfWidth: counter.halfWidth, halfDepth: counter.halfDepth }).distance > PLATE_RADIUS);
  const otherSide = APPROACHES[COUNTER_GOALS[0][1]];
  player.position = { ...otherSide.position };
  player.heading = Math.atan2(otherSide.face.x - player.position.x, otherSide.face.z - player.position.z);
  player.homeContact = false;
  match.step();
  assert.equal(player.carried, null);
  assert.equal(player.score, 1);
});

test('a head-on rival blocks a loaded plate and the human can clear the lane', () => {
  const match = playing();
  parkBots(match);
  const [human, rival] = match.players;
  const lane = CROSSINGS[0];
  human.position = { x: lane.x, z: lane.z + 0.80 };
  human.heading = Math.PI;
  human.recipe = ['tomato', 'lettuce']; // Retreat reaches the home window with a topping it does not need.
  human.carried = 'cheese';
  rival.position = { x: lane.x, z: lane.z - 0.80 };
  rival.heading = 0;
  const rig = match as unknown as { botInput(player: Player): Vec };
  rig.botInput = player => player.id === 1 ? { x: 0, z: 1 } : { x: 0, z: 0 };

  for (let i = 0; i < 30; i++) match.step({ x: 0, z: -1 });
  const crowdedAt = human.position.z;
  assert(crowdedAt > lane.z + 0.15, 'plates must contest the shortcut');
  assert(walkable(human.position) && walkable(rival.position));
  rig.botInput = () => ({ x: 0, z: 0 });
  for (let i = 0; i < 30; i++) match.step({ x: 0, z: 1 });
  assert(human.position.z > crowdedAt + 0.65, 'backing out must free movement');
  assert.equal(human.carried, 'cheese', 'body contact must preserve the carried topping');
});

test('a driven plate bump displaces the other chef after contact and preserves both toppings', () => {
  const match = playing();
  parkBots(match);
  const [human, rival] = match.players;
  human.position = { x: -1.60, z: 1.83 };
  rival.position = { x: -0.47, z: 1.83 };
  human.heading = rival.heading = Math.PI / 2;
  human.carried = 'cheese';
  rival.carried = 'tomato';
  const rig = match as unknown as { botInput(player: Player): Vec };
  rig.botInput = () => ({ x: 0, z: 0 });

  match.step({ x: 1, z: 0 });
  assert(match.events.some(event => event.type === 'bump' && event.player === 0));
  assert(human.recoil.x < 0 && rival.recoil.x > 0);
  const afterContact = rival.position.x;
  for (let tick = 0; tick < 12; tick++) match.step();
  assert(rival.position.x > afterContact + 0.09);
  assert.equal(human.carried, 'cheese');
  assert.equal(rival.carried, 'tomato');
  assert(walkable(rival.position));
});

test('a half turn eases the plate while the chef moves on input immediately', () => {
  const match = playing();
  parkBots(match);
  const human = match.players[0];
  human.position = { x: -5.23, z: 1.5 };
  human.heading = 0;
  for (let frame = 0; frame < 13; frame++) match.step({ x: 0, z: -1 });
  assert(Math.abs(human.heading - Math.PI) > Math.PI / 12);
  assert(human.position.z < 0.9);
  match.step({ x: 0, z: -1 });
  assert(Math.abs(human.heading - Math.PI) <= Math.PI / 12);
});



test('another supply replaces the held ingredient', () => {
  const match = playing();
  enter(match, SUPPLY_POINTS[0]);
  assert.equal(match.players[0].carried, match.supplies[0]);
  enter(match, SUPPLY_POINTS[1]);
  assert.equal(match.players[0].carried, match.supplies[1]);
});

test('partial progress persists and either ingredient can be delivered first', () => {
  const match = playing();
  const player = match.players[0];
  player.recipe = ['cheese', 'tomato'];
  player.carried = 'tomato';
  enter(match, HOMES[0]);
  assert.deepEqual(player.recipe, ['cheese']);
  assert.equal(player.carried, null);
  assert.equal(player.score, 0);
  player.carried = 'cheese';
  enter(match, HOMES[0]);
  assert.equal(player.score, 1);
  assert.equal(player.serviceAt, match.tick);
});

test('wrong or repeated ingredients cannot score', () => {
  const match = playing();
  const player = match.players[0];
  player.recipe = ['cheese', 'tomato'];
  player.carried = 'lettuce';
  enter(match, HOMES[0]);
  assert.equal(player.carried, 'lettuce');
  assert.deepEqual(player.recipe, ['cheese', 'tomato']);
  player.carried = 'cheese';
  enter(match, HOMES[0]);
  player.carried = 'cheese';
  enter(match, HOMES[0]);
  assert.equal(player.score, 0);
  assert.deepEqual(player.recipe, ['tomato']);
});

test('a needed delivery to another counter advances that counter and credits its owner', () => {
  const match = playing();
  const runner = match.players[0];
  const recipient = match.players[1];
  recipient.recipe = ['tomato'];
  runner.carried = 'tomato';
  enter(match, HOMES[1]);
  assert.equal(recipient.score, 1);
  assert.equal(runner.score, 0);
  assert.equal(runner.carried, null);
});

test('one score per pizza and the service deadline reopens the counter', () => {
  const match = playing();
  const player = match.players[0];
  player.recipe = ['cheese'];
  player.carried = 'cheese';
  enter(match, HOMES[0]);
  const serviceAt = player.serviceAt;
  for (let i = 0; i < SERVICE_TICKS - 1; i++) match.step();
  assert.equal(player.serviceAt, serviceAt);
  assert.equal(player.recipe.length, 0);
  match.step();
  assert.equal(player.serviceAt, -1);
  assert.equal(player.recipe.length, 2);
  assert.equal(player.score, 1);
});

test('exact expiry prevents an extra pizza on that tick', () => {
  const match = playing();
  match.tick = START_TICKS + ROUND_TICKS - 1;
  match.players[0].recipe = ['tomato'];
  match.players[0].carried = 'tomato';
  enter(match, HOMES[0]);
  assert.equal(match.players[0].score, 0);
  assert.equal(match.phase, 'over');
});

test('reset reproduces seed, supplies, orders and fresh scores', () => {
  const match = playing(42);
  for (let i = 0; i < 1000; i++) match.step();
  match.reset(42);
  const fresh = new PizzaMatch(42);
  fresh.reset(42);
  assert.deepEqual(match.players, fresh.players);
  assert.deepEqual(match.supplies, fresh.supplies);
});

test('complete seeded matches reproduce and all bots cook', () => {
  for (const seed of [1, 17, 42, 88, 2026]) {
    const a = playing(seed);
    const b = playing(seed);
    for (let i = 0; i < ROUND_TICKS; i++) { a.step(); b.step(); }
    assert.deepEqual(a.players, b.players);
    assert(a.players.slice(1).every(player => player.score > 0), 'bot stopped at seed ' + seed);
    for (const player of a.players) {
      assert(Number.isFinite(player.position.x) && Number.isFinite(player.position.z));
    }
  }
});

test('all generated orders belong to the five verified recipe combinations', () => {
  const combinations = new Set<string>();
  for (let seed = 1; seed < 100; seed++) {
    for (const player of new PizzaMatch(seed).players) {
      assert(RECIPES.some(pair => pair.join() === player.recipe.join()));
      combinations.add(player.recipe.join());
    }
  }
  assert.equal(combinations.size, 5);
});

test('seed 9 approach regression releases and all bots keep serving late in the round', () => {
  const match = playing(9);
  const deliveredAt = [0, 0, 0, 0];
  for (let i = 0; i < ROUND_TICKS; i++) {
    match.step();
    for (const event of match.events) if (event.type === 'deliver') deliveredAt[event.player] = match.tick - START_TICKS;
  }
  for (const player of match.players.slice(1)) {
    assert(deliveredAt[player.id] > 70 * 60, 'a bot remained stuck after the crossing became crowded');
  }
});

test('bots keep serving late when either crossing stays blocked', () => {
  for (const [blocked, seed] of [17, 42].entries()) {
    const match = playing(seed);
    const human = match.players[0];
    const { x, z } = CROSSINGS[blocked];
    const deliveredAt = [0, 0, 0, 0];
    for (let i = 0; i < ROUND_TICKS; i++) {
      // Hold position against collision pushes to sustain the blockage for the entire round.
      human.position = { x, z };
      match.step();
      for (const event of match.events) if (event.type === 'deliver') deliveredAt[event.player] = match.tick - START_TICKS;
    }
    assert(match.players.slice(1).every(player => player.score > 0 && deliveredAt[player.id] > 70 * 60));
  }
});
