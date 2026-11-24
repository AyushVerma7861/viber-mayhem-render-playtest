import { APPROACHES, COUNTERS, COUNTER_GOALS, HOMES, PLATE_RADIUS, PLATE_REACH, PLAYER_RADIUS, SPAWNS, SUPPLY_GOALS, SUPPLY_POINTS, SUPPLY_RECTS, crossingAt } from './layout.ts';
import { circleRect, clear, constrain, distance, walkable } from './geometry.ts';
import { routeCosts, waypoint } from './navigation.ts';
import { createSharedOrders } from './shared-orders.ts';
export { HOMES, SUPPLY_POINTS } from './layout.ts';
export type { Vec } from './layout.ts';
import type { Vec } from './layout.ts';

export const HZ = 60;
export const TRAY_REFILL_TICKS = HZ;
export type RefillPriority = 'arrival' | 'closest';
export const ROUND_TICKS = 85 * HZ;
export const START_TICKS = 72;
export const BAKE_TICKS = 30;
export const COOK_WAIT_TICKS = 30;
// The reference cook travels 1.99 units each way at 4 units/s.
export const COOK_TRAVEL_TICKS = 30;
export const SERVICE_TICKS = BAKE_TICKS + COOK_WAIT_TICKS + COOK_TRAVEL_TICKS * 2;
export const MOVE_SPEED = 3;
export const RADIUS = PLAYER_RADIUS;
const BOT_MIN_TURN_PACE = 0.55;
const RECOIL_DECAY = 0.85;
const MAX_RECOIL = 2.25;
const BUMP_COOLDOWN_TICKS = 12;
const CONTACT_RELEASE_MARGIN = 0.012;
const SEPARATION_PASSES = 6;
const MAX_SEPARATION_STEP = 0.09;
const SHAPE_RADII = [RADIUS, PLATE_RADIUS] as const;
const IDLE_INPUT: Vec = { x: 0, z: 0 };
const SOLO_INPUTS = [IDLE_INPUT] as const;
const PICKUP_TIE_ROTATION_TICKS = 36;
export type Food = 'cheese' | 'tomato' | 'meat' | 'lettuce';
export const FOODS: readonly Food[] = ['cheese', 'tomato', 'meat', 'lettuce'];
export const FOOD_INFO: Record<Food, { name: string; icon: string; color: string }> = {
  cheese: { name: 'Cheese', icon: '🧀', color: '#f6c64e' },
  tomato: { name: 'Tomato', icon: '🍅', color: '#e65e45' },
  meat: { name: 'Meat', icon: '🥩', color: '#ab514e' },
  lettuce: { name: 'Lettuce', icon: '🥬', color: '#73b950' },
};
export const RECIPES: readonly (readonly [Food, Food])[] = [
  ['tomato', 'cheese'], ['lettuce', 'meat'], ['lettuce', 'tomato'],
  ['meat', 'tomato'], ['lettuce', 'cheese'],
];
type SharedOrders = ReturnType<typeof createSharedOrders>;
export type Player = {
  id: number; position: Vec; previous: Vec; heading: number; previousHeading: number;
  recoil: Vec;
  carried: Food | null; recipe: Food[]; delivered: Food[]; score: number;
  serviceAt: number; targetAt: number; target: Vec; homeContact: boolean;
  supplyContact: number; supplySince: number; goal: number;
  progressAt: number; progressPosition: Vec; yieldUntil: number; yieldTarget: Vec; yieldCount: number;
  avoidGoal: number; avoidUntil: number; blockedCrossing: number; detourUntil: number; bumpAt: number;
};
export type PizzaEvent = { type: 'pickup' | 'swap' | 'refill' | 'deliver' | 'score' | 'bump' | 'ready' | 'finish'; player: number; counter?: number; station?: number; rival?: number };
export function platePosition(player: Pick<Player, 'position' | 'heading'>): Vec {
  return { x: player.position.x + Math.sin(player.heading) * PLATE_REACH,
    z: player.position.z + Math.cos(player.heading) * PLATE_REACH };
}

export type PizzaPose = Pick<Player, 'position' | 'heading' | 'recoil'>;

function moveBody(player: PizzaPose, x: number, z: number, speed: number): void {
  player.position = constrain({
    x: player.position.x + (x * speed + player.recoil.x) / HZ,
    z: player.position.z + (z * speed + player.recoil.z) / HZ,
  }, player.position);
  player.recoil.x *= RECOIL_DECAY;
  player.recoil.z *= RECOIL_DECAY;
}

function face(player: PizzaPose, target: Vec): void {
  const wanted = Math.atan2(target.x - player.position.x, target.z - player.position.z);
  const delta = Math.atan2(Math.sin(wanted - player.heading), Math.cos(wanted - player.heading));
  player.heading += delta * (10 / HZ);
}

function constrainPlate(player: PizzaPose): void {
  for (const rectangle of SUPPLY_RECTS) {
    const hit = circleRect(platePosition(player), rectangle);
    if (hit.distance < PLATE_RADIUS) {
      const push = PLATE_RADIUS - hit.distance;
      player.position = constrain({ x: player.position.x + hit.push.x * push,
        z: player.position.z + hit.push.z * push }, player.position);
    }
  }
}

export function predictPizzaStep(player: PizzaPose, input: Vec): void {
  const magnitude = Math.max(1, Math.hypot(input.x, input.z));
  const x = input.x / magnitude, z = input.z / magnitude;
  moveBody(player, x, z, MOVE_SPEED);
  if (Math.hypot(x, z) > 0.05) face(player, { x: player.position.x + x, z: player.position.z + z });
  constrainPlate(player);
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export class PizzaMatch {
  seed: number;
  tick = 0;
  phase: 'menu' | 'ready' | 'playing' | 'over' = 'menu';
  players: Player[] = [];
  supplies: Food[] = [];
  trayReadyAt: number[] = [];
  openingPair: ReturnType<SharedOrders['open']> | null = null;
  events: PizzaEvent[] = [];
  private readonly refillPriority: RefillPriority;
  private readonly sharedRush: boolean;
  private sharedOrders: SharedOrders | null = null;
  private draw: () => number;
  private contacts = new Set<number>();
  private lastImpact = new Map<number, number>();

  constructor(seed = 17, refillPriority: RefillPriority = 'closest', sharedRush = false) {
    this.seed = seed;
    this.refillPriority = refillPriority;
    this.sharedRush = sharedRush;
    this.draw = random(seed);
    this.reset(seed);
    this.phase = 'menu';
  }

  reset(seed = this.seed): void {
    this.seed = seed >>> 0;
    this.draw = random(this.seed);
    this.tick = 0;
    this.phase = 'ready';
    this.events = [];
    this.contacts.clear();
    this.lastImpact.clear();
    this.supplies = [...FOODS];
    this.trayReadyAt = this.supplies.map(() => 0);
    for (let i = this.supplies.length - 1; i > 0; i--) {
      const next = Math.floor(this.draw() * (i + 1));
      [this.supplies[i], this.supplies[next]] = [this.supplies[next], this.supplies[i]];
    }
    this.players = SPAWNS.map((home, id) => {
      const { inward } = COUNTERS[id];
      const heading = Math.atan2(inward.x, inward.z);
      return {
        id, position: { ...home }, previous: { ...home }, heading, previousHeading: heading, recoil: { x: 0, z: 0 },
        carried: null, recipe: this.sharedRush ? [] : this.nextRecipe(), delivered: [], score: 0,
        serviceAt: -1, targetAt: 0, target: { ...home }, homeContact: false,
        supplyContact: -1, supplySince: -1, goal: COUNTER_GOALS[id][0],
        progressAt: START_TICKS, progressPosition: { ...home }, yieldUntil: -1, yieldTarget: { ...home }, yieldCount: 0,
        avoidGoal: -1, avoidUntil: -1, blockedCrossing: -1, detourUntil: -1, bumpAt: -Infinity,
      };
    });
    this.sharedOrders = this.sharedRush ? createSharedOrders(this.supplies, RECIPES, this.draw, HZ, MOVE_SPEED) : null;
    this.openingPair = this.sharedOrders?.open(this.players, START_TICKS, random(this.seed ^ 0x71d2f09b)()) ?? null;
  }

  get remaining(): number { return Math.max(0, ROUND_TICKS - Math.max(0, this.tick - START_TICKS)); }
  get winners(): number[] {
    const best = Math.max(...this.players.map(player => player.score));
    return this.players.filter(player => player.score === best).map(player => player.id);
  }

  private nextRecipe(): Food[] { return [...RECIPES[Math.floor(this.draw() * RECIPES.length)]]; }

  step(input: Vec | readonly (Vec | undefined)[] = IDLE_INPUT): void {
    const controls = 'x' in input ? [input] : input;
    this.events = [];
    if (this.phase === 'menu' || this.phase === 'over') return;
    this.tick++;
    for (const player of this.players) {
      player.previous = { ...player.position };
      player.previousHeading = player.heading;
    }
    if (this.tick < START_TICKS) return;
    this.phase = 'playing';
    // Expiry wins exact tick ties, so the displayed 85-second deadline is authoritative.
    if (this.tick >= START_TICKS + ROUND_TICKS) {
      this.phase = 'over';
      this.events.push({ type: 'finish', player: -1 });
      return;
    }
    for (const player of this.players) {
      if (player.serviceAt >= 0 && this.tick >= player.serviceAt + SERVICE_TICKS) {
        const order = this.sharedOrders?.next(player, this.players, this.tick);
        player.serviceAt = -1;
        player.recipe = order?.recipe ?? this.nextRecipe();
        player.delivered = [];
        this.events.push({ type: 'ready', player: player.id, ...order?.rush });
      }
      const control = controls[player.id];
      this.move(player, control ?? this.botInput(player), control === undefined);
    }
    this.collidePlayers();
    this.collectToppings(controls);
    for (const player of this.players) this.serveTopping(player, controls[player.id] === undefined);
  }

  private move(player: Player, input: Vec, isBot: boolean): void {
    const magnitude = Math.max(1, Math.hypot(input.x, input.z));
    const x = input.x / magnitude;
    const z = input.z / magnitude;
    let speed = MOVE_SPEED;
    const inputLength = Math.hypot(x, z);
    if (isBot && inputLength > 0.05) {
      const alignment = (x * Math.sin(player.heading) + z * Math.cos(player.heading)) / inputLength;
      speed *= Math.max(BOT_MIN_TURN_PACE, alignment);
    }
    moveBody(player, x, z, speed);
    const liningUp = isBot && this.tick >= player.yieldUntil &&
      distance(player.position, player.target) < 0.40 && clear(player.position, player.target, RADIUS);
    if (liningUp) face(player, APPROACHES[player.goal].face);
    else if (inputLength > 0.05) face(player, { x: player.position.x + x, z: player.position.z + z });
  }

  private collidePlayers(): void {
    const velocities = this.players.map(({ position, previous }) => ({
      x: (position.x - previous.x) * HZ,
      z: (position.z - previous.z) * HZ,
    }));
    const count = this.players.length;
    const touching = new Set<number>();
    const impacts = new Map<number, { x: number; z: number; speed: number }>();
    for (let pass = 0; pass < SEPARATION_PASSES; pass++) {
      const shapes = this.players.map(player => {
        constrainPlate(player);
        return [player.position, platePosition(player)] as const;
      });
      const shifts = this.players.map(() => ({ x: 0, z: 0 }));
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          const pair = i * count + j;
          let correctionX = 0, correctionZ = 0, shapeContacts = 0;
          for (const [a, pa] of shapes[i].entries()) {
            for (const [b, pb] of shapes[j].entries()) {
              const dx = pb.x - pa.x, dz = pb.z - pa.z;
              const d = Math.hypot(dx, dz);
              const overlap = SHAPE_RADII[a] + SHAPE_RADII[b] - d;
              if (overlap <= 0) {
                if (overlap > -CONTACT_RELEASE_MARGIN && this.contacts.has(pair)) touching.add(pair);
                continue;
              }
              touching.add(pair);
              const fallbackX = this.players[j].previous.x - this.players[i].previous.x;
              const fallbackZ = this.players[j].previous.z - this.players[i].previous.z;
              const fallbackLength = Math.hypot(fallbackX, fallbackZ);
              const nx = d > 1e-7 ? dx / d : fallbackLength > 1e-7 ? fallbackX / fallbackLength : 1;
              const nz = d > 1e-7 ? dz / d : fallbackLength > 1e-7 ? fallbackZ / fallbackLength : 0;
              correctionX += nx * overlap;
              correctionZ += nz * overlap;
              shapeContacts++;
              const va = velocities[i], vb = velocities[j];
              const speed = (va.x - vb.x) * nx + (va.z - vb.z) * nz;
              const current = impacts.get(pair);
              if (!current || speed > current.speed + 1e-7) impacts.set(pair, { x: nx, z: nz, speed });
              else if (Math.abs(speed - current.speed) <= 1e-7) {
                current.x += nx;
                current.z += nz;
              }
            }
          }
          if (!shapeContacts) continue;
          const dx = correctionX / (2 * shapeContacts);
          const dz = correctionZ / (2 * shapeContacts);
          shifts[i].x -= dx;
          shifts[i].z -= dz;
          shifts[j].x += dx;
          shifts[j].z += dz;
        }
      }
      // Apply to everyone together so one pair cannot pre-empt another in a pileup.
      if (shifts.every(shift => Math.hypot(shift.x, shift.z) < 1e-5)) break;
      for (const [i, p] of this.players.entries()) {
        const shift = shifts[i];
        const length = Math.hypot(shift.x, shift.z);
        if (length < 1e-5) continue;
        const scale = Math.min(1, MAX_SEPARATION_STEP / length);
        p.position = constrain({ x: p.position.x + shift.x * scale, z: p.position.z + shift.z * scale }, p.position);
      }
    }
    for (const player of this.players) constrainPlate(player);
    const kicks = this.players.map(() => ({ x: 0, z: 0 }));
    for (const [contact, { x, z, speed }] of impacts) {
      const power = Math.min(MAX_RECOIL, (speed - 0.60) * 0.68);
      const length = Math.hypot(x, z);
      if (power <= 0 || length < 1e-7 || this.contacts.has(contact) ||
          this.tick - (this.lastImpact.get(contact) ?? -Infinity) < BUMP_COOLDOWN_TICKS) continue;
      const i = Math.floor(contact / count), j = contact % count;
      const dx = x * power / length, dz = z * power / length;
      kicks[i].x -= dx;
      kicks[i].z -= dz;
      kicks[j].x += dx;
      kicks[j].z += dz;
      this.lastImpact.set(contact, this.tick);
      this.players[i].bumpAt = this.players[j].bumpAt = this.tick;
      this.events.push({ type: 'bump', player: i });
    }
    for (const [i, kick] of kicks.entries()) {
      if (kick.x || kick.z) this.addRecoil(this.players[i], kick.x, kick.z);
    }
    this.contacts = touching;
  }

  private addRecoil(player: Player, x: number, z: number): void {
    const rx = player.recoil.x + x, rz = player.recoil.z + z;
    const scale = Math.max(1, Math.hypot(rx, rz) / MAX_RECOIL);
    player.recoil = { x: rx / scale, z: rz / scale };
  }

  private collectToppings(controls: readonly (Vec | undefined)[] = SOLO_INPUTS): void {
    const winners: (Player | undefined)[] = [];
    const reaches: number[] = [];
    const tieWindow = Math.floor(this.tick / PICKUP_TIE_ROTATION_TICKS);
    const priority = (id: number, station: number) => {
      const seat = (id + station + Math.floor(tieWindow / 2)) % this.players.length;
      // Reverse each rotation on the next window to balance every pair of seats.
      return tieWindow % 2 === 0 ? seat : this.players.length - 1 - seat;
    };
    for (const player of this.players) {
      const plate = platePosition(player);
      const station = SUPPLY_RECTS.findIndex(rect => Math.abs(player.position.x - rect.center.x) <= rect.halfWidth &&
        (player.position.z - rect.center.z) * rect.side > rect.halfDepth + PLAYER_RADIUS &&
        Math.cos(player.heading) * rect.side <= -0.5 && circleRect(plate, rect).distance <= PLATE_RADIUS + 0.012);
      if (station !== player.supplyContact) player.supplySince = this.tick;
      player.supplyContact = station;
      if (station < 0 || this.trayReadyAt[station] > this.tick) continue;
      const food = this.supplies[station];
      if (player.carried === food) continue;
      if (controls[player.id] === undefined && (player.carried ||
        (player.recipe[0] !== food && !(player.recipe.includes(food) && player.goal === SUPPLY_GOALS[station][0])))) continue;

      const leader = winners[station];
      const reach = distance(plate, SUPPLY_POINTS[station]);
      if (leader) {
        const arrivalGap = player.supplySince - leader.supplySince;
        const reachGap = reach - reaches[station];
        const distanceOrder = Math.abs(reachGap) > 1e-6 ? Math.sign(reachGap) : 0;
        const closestOnRefill = this.refillPriority === 'closest' && this.trayReadyAt[station] === this.tick;
        const order = closestOnRefill ? distanceOrder || arrivalGap : arrivalGap || distanceOrder;
        if (order > 0 || (order === 0 && priority(player.id, station) >= priority(leader.id, station))) continue;
      }
      winners[station] = player;
      reaches[station] = reach;
    }
    for (const [station, readyAt] of this.trayReadyAt.entries()) {
      if (readyAt === this.tick) this.events.push({ type: 'refill', player: -1, station });
      const player = winners[station];
      if (!player) continue;
      this.events.push({ type: player.carried ? 'swap' : 'pickup', player: player.id, station });
      player.carried = this.supplies[station];
      this.trayReadyAt[station] = this.tick + TRAY_REFILL_TICKS;
      if (controls[player.id] === undefined) player.targetAt = this.tick;
    }
  }

  private serveTopping(player: Player, isBot: boolean): void {
    const plate = platePosition(player);
    const tableIndex = COUNTERS.findIndex(counter => circleRect(plate, {
      center: counter.trigger, halfWidth: counter.halfWidth, halfDepth: counter.halfDepth,
    }).distance <= PLATE_RADIUS + 0.01);
    const home = tableIndex >= 0;
    const table = this.players[tableIndex];
    // The native Finish trigger accepts a needed ingredient at any counter.
    // Its MyNum determines which counter's score increases.
    if (table && !player.homeContact && player.carried && table.serviceAt < 0) {
      const required = table.recipe.indexOf(player.carried);
      if (required >= 0) {
        table.recipe.splice(required, 1);
        table.delivered.push(player.carried);
        this.events.push({ type: 'deliver', player: player.id, counter: table.id });
        if (table.recipe.length === 0) {
          table.score++;
          table.serviceAt = this.tick;
          this.events.push({ type: 'score', player: table.id });
        }
      }
      if (required >= 0 || isBot) player.carried = null;
      if (isBot) player.targetAt = this.tick;
    }
    player.homeContact = home;
  }

  private chooseApproach(player: Player): void {
    const [needed] = player.recipe;
    const supplying = !player.carried && needed !== undefined;
    const blocked = this.tick < player.detourUntil ? player.blockedCrossing : -1;
    let available: readonly number[] = COUNTER_GOALS[player.id];
    if (supplying) {
      const station = this.supplies.indexOf(needed);
      const primary = SUPPLY_GOALS[station][0];
      available = [primary];
      // Give a short refill a chance. Consider the other topping when a rival holds the spot.
      if (player.recipe.length > 1) {
        const spot = APPROACHES[primary].position;
        const retrying = this.tick < player.avoidUntil && player.avoidGoal === primary;
        const queued = distance(player.position, spot) < 1.35 &&
          this.tick - player.progressAt >= 34 &&
          this.players.some(other => other !== player && distance(other.position, spot) < 0.64);
        const takingAlternate = player.goal === SUPPLY_GOALS[this.supplies.indexOf(player.recipe[1])][0];
        if (retrying || queued || takingAlternate) available = [...available, SUPPLY_GOALS[this.supplies.indexOf(player.recipe[1])][0]];
      }
    }
    const filtered = blocked < 0 ? available : available.filter(goal => crossingAt(APPROACHES[goal].position) !== blocked);
    const reachable = filtered.length ? filtered : available;
    const goals = this.tick < player.avoidUntil && reachable.length > 1
      ? reachable.filter(goal => goal !== player.avoidGoal) : reachable;
    const costs = routeCosts(player.position, goals, blocked);
    let winner = goals[0], best = Infinity;

    for (const [index, goal] of goals.entries()) {
      const { position: target, action, station } = APPROACHES[goal];
      let cost = costs[index] + (goal === player.goal ? -0.4 : 0);
      if (action === 'pickup') {
        cost += Math.max(0, (this.trayReadyAt[station] - this.tick) / HZ * MOVE_SPEED - costs[index]);
        if (goal !== available[0]) cost += 0.5;
      }
      for (const other of this.players) {
        if (other.id === player.id) continue;
        const queue = distance(other.position, target);
        cost += Math.max(0, 1.20 - queue) * (supplying ? 0.55 : 1.35);
      }
      if (cost < best) { best = cost; winner = goal; }
    }

    player.goal = winner;
    player.target = { ...APPROACHES[winner].position };
    player.targetAt = this.tick + 27;
  }

  private yieldSpace(player: Player, nearby: readonly Player[]): boolean {
    const choices: Vec[] = [];
    for (const radius of [0.75, 1.1]) {
      for (let i = 0; i < 12; i++) {
        const angle = i * Math.PI / 6;
        choices.push({ x: player.position.x + Math.cos(angle) * radius, z: player.position.z + Math.sin(angle) * radius });
      }
    }
    let best = -Infinity;
    let escape: Vec | undefined;
    for (const point of choices) {
      const travel = distance(point, player.position);
      if (travel < 0.40 || travel > 1.45 || !walkable(point, RADIUS + 0.02) ||
          !clear(player.position, point, RADIUS - 0.001)) continue;
      const clearance = Math.min(...nearby.map(other => distance(point, other.position)));
      if (clearance < RADIUS * 2 + 0.09) continue;
      const score = clearance - travel * 0.12 - distance(point, player.target) * 0.10;
      if (score > best) { best = score; escape = point; }
    }
    if (!escape) return false;

    player.yieldTarget = escape;
    player.yieldUntil = this.tick + 44;
    player.progressAt = this.tick;
    player.progressPosition = { ...player.position };
    player.yieldCount++;
    return true;
  }

  private botInput(player: Player): Vec {
    if (distance(player.position, player.progressPosition) > 0.26) {
      player.progressAt = this.tick;
      player.progressPosition = { ...player.position };
    }
    const nearby = this.players.filter(other => other.id !== player.id && distance(player.position, other.position) < 1.70);
    const stalled = this.tick - player.progressAt;
    const priority = (id: number) => (id + Math.floor(this.tick / (HZ * 3))) % this.players.length;
    const liveOrder = player.recipe.length > 0;
    const waitingForRefill = !player.carried && player.supplyContact >= 0 && this.trayReadyAt[player.supplyContact] >= this.tick;
    if (liveOrder && !waitingForRefill && this.tick >= player.yieldUntil && stalled > 51 && player.targetAt !== Infinity) {
      const blocked = nearby.map(other => crossingAt(other.position)).find(crossing => crossing >= 0) ?? -1;
      const canYield = nearby.length && (stalled > 90 || nearby.some(other => priority(player.id) > priority(other.id)));
      if (blocked >= 0 && this.tick >= player.detourUntil) {
        player.blockedCrossing = blocked;
        player.detourUntil = this.tick + 9 * HZ;
        player.progressAt = this.tick;
        player.targetAt = this.tick;
      } else if (canYield && this.yieldSpace(player, nearby)) {
        player.avoidGoal = player.goal;
        player.avoidUntil = this.tick + 135;
        player.targetAt = player.yieldUntil;
      } else if (stalled > 78 && (!nearby.length || stalled > 110)) {
        player.avoidGoal = player.goal;
        player.avoidUntil = this.tick + 122;
        player.targetAt = this.tick;
        player.progressAt = this.tick;
      }
    }

    if (this.tick < player.yieldUntil) {
      const dx = player.yieldTarget.x - player.position.x, dz = player.yieldTarget.z - player.position.z;
      const length = Math.hypot(dx, dz);
      return length < 0.07 ? { x: 0, z: 0 } : { x: dx / length, z: dz / length };
    }
    if (this.tick >= player.targetAt) this.chooseApproach(player);
    const remaining = distance(player.position, player.target);
    // Ease into the approach and keep moving until the physical plate can reach.
    const stopDistance = APPROACHES[player.goal].action === 'pickup' ? 0.008 : 0.026;
    if (remaining < stopDistance) return { x: 0, z: 0 };
    if (remaining < 0.54 && clear(player.position, player.target, RADIUS)) {
      const speed = Math.min(Math.max(0.30, remaining / 0.54), remaining * HZ / MOVE_SPEED);
      return { x: (player.target.x - player.position.x) * speed / remaining,
        z: (player.target.z - player.position.z) * speed / remaining };
    }

    const target = waypoint(player.position, player.goal, this.tick < player.detourUntil ? player.blockedCrossing : -1);
    const dx = target.x - player.position.x, dz = target.z - player.position.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.001) return { x: 0, z: 0 };
    let x = dx / length, z = dz / length;

    // Keep each chef's route local. Sidestep only where the actual floor has clearance.
    for (const other of nearby) {
      const rx = other.position.x - player.position.x, rz = other.position.z - player.position.z;
      const d = Math.hypot(rx, rz);
      if (d < 0.001 || rx * x + rz * z < 0.08) continue;
      const right = { x: -z, z: x };
      const canLean = (side: number) => walkable({
        x: player.position.x + right.x * side * 0.24, z: player.position.z + right.z * side * 0.24,
      }, RADIUS + 0.02);
      const side = canLean(1) ? 1 : canLean(-1) ? -1 : 0;
      const bias = Math.max(0, 1.25 - d) * 0.45 * side;
      x += right.x * bias;
      z += right.z * bias;
    }
    const norm = Math.hypot(x, z);
    return { x: x / norm, z: z / norm };
  }
}
