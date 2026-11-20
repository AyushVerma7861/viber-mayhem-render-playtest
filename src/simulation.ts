import { FREIGHT_ARENA, routeHeading } from './arena.ts';
import type { Arena, Vec } from './arena.ts';

export type { Vec } from './arena.ts';

export const HZ = 60;
export const STEP = 1 / HZ;
export const FUSE_TICKS = 630;
export const PASS_TICKS = 60;
export const STUN_TICKS = 120;
export const READY_TICKS = 120;
export const OFFLINE_SEAT = 0;
export const LIMIT = FREIGHT_ARENA.bounds;
export const PLAYER_RADIUS = 0.47;
export const CART_BODY_LENGTH = 2.58;
export const CART_BODY_WIDTH = 1.0;
export const CART_HUB_OFFSET = 0.58;
export const CART_HUB_DEPTH = 0.03;
const CART_HALF_LENGTH = CART_BODY_LENGTH / 2;
const CART_HALF_WIDTH = CART_HUB_OFFSET + CART_HUB_DEPTH / 2;
const CART_SKIN = 0.002;
const CONTACT_RADIUS = PLAYER_RADIUS * 2;
const MAX_SPEED = 5.8;
const CART_WARNING = 45;
const CART_SIGHT_RADIUS = 3.8;
const CART_REACTION_TICKS = 12;
const CHASE_COMMIT_TICKS = 20;

export const CAST = [
  { name: 'Bolt', color: '#c9fb67', role: 'You' },
  { name: 'Nova', color: '#69dff2', role: 'Bot' },
  { name: 'Jinx', color: '#c296ff', role: 'Bot' },
  { name: 'Ember', color: '#ffad64', role: 'Bot' },
] as const;

export interface Player {
  id: number;
  position: Vec;
  previous: Vec;
  drive: Vec;
  impulse: Vec;
  heading: number;
  alive: boolean;
  stunnedUntil: number;
  eliminatedAt: number;
}

export type PlayerMotion = Pick<Player, 'id' | 'position' | 'drive' | 'impulse' | 'heading'>;

export interface Cart {
  lane: number;
  start: number;
  position: Vec;
  previous: Vec;
  heading: number;
  contacts: number;
}

type GameEvent =
  | { type: 'assign' | 'pass' | 'blast' | 'hit' | 'win'; player: number }
  | { type: 'horn'; lane: number };

export type Phase = 'lobby' | 'ready' | 'play' | 'result';
export type ChasePolicy = 'nearest' | 'clear-route';
export type MovementProfile = 'classic' | 'responsive';
type Lane = { next: number; warned: boolean; random: () => number };
type CartForecast = { near: Vec; far: Vec };

export type SeatInputs = Readonly<Partial<Record<number, Vec>>>;
export interface MatchView {
  readonly tick: number;
  readonly phase: Phase;
  readonly playAt: number;
  readonly holder: number | null;
  readonly passAt: number;
  readonly remaining: number;
  readonly winner: number | null;
  readonly players: readonly Readonly<Player>[];
  readonly carts: readonly Readonly<Cart>[];
  readonly lanes: readonly { readonly warned: boolean }[];
  readonly events: readonly GameEvent[];
}

const length = (v: Vec) => Math.hypot(v.x, v.z);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, z: a.z - b.z });
const dot = (a: Vec, b: Vec) => a.x * b.x + a.z * b.z;
const scale = (v: Vec, n: number): Vec => ({ x: v.x * n, z: v.z * n });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, z: a.z + b.z });
const unit = (v: Vec): Vec => scale(v, 1 / (length(v) || 1));
const zero = (): Vec => ({ x: 0, z: 0 });
const noInput: Vec = { x: 0, z: 0 };

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let bits = Math.imul(state ^ (state >>> 15), state | 1);
    bits ^= bits + Math.imul(bits ^ (bits >>> 7), bits | 61);
    return ((bits ^ (bits >>> 14)) >>> 0) / 4294967296;
  };
}

export const ROUTES = FREIGHT_ARENA.routes;

export function routePoint(lane: number, progress: number): Vec {
  return FREIGHT_ARENA.point(lane, progress);
}

// Time of entry for a moving point and a stationary circle over one tick.
function sweepCircle(from: Vec, to: Vec, radius: number): number {
  const c = dot(from, from) - radius * radius;
  if (c <= 0) return 0;
  const move = sub(to, from);
  const a = dot(move, move);
  const b = dot(from, move);
  const discriminant = b * b - a * c;
  if (a === 0 || b >= 0 || discriminant < 0) return Infinity;
  const t = (-b - Math.sqrt(discriminant)) / a;
  return t <= 1 ? t : Infinity;
}

function sweepBox(from: Vec, to: Vec, halfX: number, halfZ: number): number {
  let entry = 0;
  let exit = 1;
  for (const [axis, half] of [['x', halfX], ['z', halfZ]] as const) {
    const move = to[axis] - from[axis];
    if (Math.abs(move) < 1e-8) {
      if (Math.abs(from[axis]) > half) return Infinity;
      continue;
    }
    const a = (-half - from[axis]) / move;
    const b = (half - from[axis]) / move;
    entry = Math.max(entry, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (entry > exit) return Infinity;
  }
  return entry;
}

export function withinArena(target: Vec, arena: Arena): Vec {
  const limit = arena.bounds;
  return {
    x: clamp(target.x, -limit.x + PLAYER_RADIUS, limit.x - PLAYER_RADIUS),
    z: clamp(target.z, -limit.z + PLAYER_RADIUS, limit.z - PLAYER_RADIUS),
  };
}

export function stepPlayerMotion(player: PlayerMotion, input: Vec, arena: Arena, stunned: boolean,
  human = true, movement: MovementProfile = 'classic'): void {
  const speed = MAX_SPEED * (human ? 1 : 0.955 - player.id * 0.012);
  const target = scale(input, speed / Math.max(1, length(input)));
  if (stunned) {
    player.drive = zero();
  } else {
    let response = 0.29;
    if (movement === 'responsive' && human) {
      const moving = length(player.drive);
      const desired = length(target);
      if (desired < 0.08 || dot(player.drive, target) < moving * desired * 0.70) response = 0.56;
    }
    player.drive = add(player.drive, scale(sub(target, player.drive), response));
    if (length(input) > 0.08) player.heading = Math.atan2(input.x, input.z);
  }
  player.position = withinArena(add(player.position, scale(add(player.drive, player.impulse), STEP)), arena);
  player.impulse = scale(player.impulse, 0.91);
}

const CART_CORNERS = [-1, 1].flatMap(end =>
  [-1, 1].map(side => ({ x: end * CART_HALF_LENGTH, z: side * CART_HALF_WIDTH })),
);

function cartSurface(point: Vec): { normal: Vec; gap: number } {
  const outside = {
    x: point.x - clamp(point.x, -CART_HALF_LENGTH, CART_HALF_LENGTH),
    z: point.z - clamp(point.z, -CART_HALF_WIDTH, CART_HALF_WIDTH),
  };
  const distance = length(outside);
  if (distance > 0) return { normal: scale(outside, 1 / distance), gap: distance - PLAYER_RADIUS };

  const end = CART_HALF_LENGTH - Math.abs(point.x);
  const side = CART_HALF_WIDTH - Math.abs(point.z);
  return end < side
    ? { normal: { x: Math.sign(point.x) || 1, z: 0 }, gap: -end - PLAYER_RADIUS }
    : { normal: { x: 0, z: Math.sign(point.z) || 1 }, gap: -side - PLAYER_RADIUS };
}

function slideAlong(velocity: Vec, outward: Vec): Vec {
  return sub(velocity, scale(outward, Math.min(0, dot(velocity, outward))));
}

function cartContact(player: Player, cart: Cart, arena: Arena): {
  touching: boolean;
  impact?: { position: Vec; outward: Vec; travel: Vec };
} {
  const axis = { x: Math.cos(cart.heading), z: Math.sin(cart.heading) };
  const side = { x: -axis.z, z: axis.x };
  const local = (v: Vec): Vec => ({ x: dot(v, axis), z: dot(v, side) });
  const world = (v: Vec): Vec => add(scale(axis, v.x), scale(side, v.z));
  const from = local(sub(player.previous, cart.previous));
  const to = local(sub(player.position, cart.position));
  const touching = cartSurface(to).gap <= 0.025;
  if (sweepBox(from, to, CART_HALF_LENGTH + PLAYER_RADIUS, CART_HALF_WIDTH + PLAYER_RADIUS) === Infinity) {
    return { touching };
  }

  // Sweep the player circle against the full chassis and wheel footprint.
  let entry = Math.min(
    sweepBox(from, to, CART_HALF_LENGTH + PLAYER_RADIUS, CART_HALF_WIDTH),
    sweepBox(from, to, CART_HALF_LENGTH, CART_HALF_WIDTH + PLAYER_RADIUS),
  );
  for (const corner of CART_CORNERS) {
    entry = Math.min(entry, sweepCircle(sub(from, corner), sub(to, corner), PLAYER_RADIUS));
  }
  if (entry === Infinity) return { touching };

  const impact = add(from, scale(sub(to, from), entry));
  const { normal, gap } = cartSurface(impact);
  const surface = add(impact, scale(normal, Math.max(0, -gap) + CART_SKIN));
  const resolved = add(surface, slideAlong(sub(to, impact), normal));
  let position = withinArena(add(cart.position, world(resolved)), arena);
  let outward = world(normal);
  const clipped = local(sub(position, cart.position));
  if (cartSurface(clipped).gap < 0) {
    // Slide along the wall to the open side, including north/south cart entrances.
    const sign = Math.sign(clipped.z || from.z) || 1;
    const lateral = Math.abs(side.z) >= Math.abs(side.x) ? 'z' : 'x';
    for (const sideSign of [sign, -sign]) {
      const edge = sideSign * (CART_HALF_WIDTH + PLAYER_RADIUS + CART_SKIN);
      const slid = { ...position, [lateral]: position[lateral] + (edge - clipped.z) / side[lateral] };
      const candidate = withinArena(slid, arena);
      if (cartSurface(local(sub(candidate, cart.position))).gap < 0) continue;
      position = candidate;
      outward = scale(side, sideSign);
      break;
    }
  }
  return { touching: true, impact: { position, outward, travel: axis } };
}

const BOT_DIRECTIONS = Array.from({ length: 12 }, (_, i) => {
  const angle = i * Math.PI / 6;
  return { x: Math.cos(angle), z: Math.sin(angle) };
});

export class Match implements MatchView {
  tick = 0;
  phase: Phase = 'lobby';
  playAt = 0;
  holder: number | null = null;
  passAt = 0;
  deadline = 0;
  assignAt = 0;
  winner: number | null = null;
  seed: number;
  players: Player[];
  carts: Cart[] = [];
  lanes: Lane[] = [];
  events: GameEvent[] = [];
  private random: () => number;
  private readonly chasePolicy: ChasePolicy;
  private readonly movement: MovementProfile;
  readonly arena: Arena;
  private touching = new Set<number>();
  private chaseTarget: { id: number; until: number } | null = null;
  private botPlans: Vec[];
  private cartSight: Map<Cart, number>[];
  private humanSeats = new Set<number>([OFFLINE_SEAT]);

  constructor(seed: number, chasePolicy: ChasePolicy = 'nearest', arena: Arena = FREIGHT_ARENA,
    movement: MovementProfile = 'classic') {
    this.seed = seed >>> 0;
    this.chasePolicy = chasePolicy;
    this.movement = movement;
    this.arena = arena;
    this.random = rng(this.seed);
    this.players = this.createPlayers();
    this.botPlans = this.players.map(zero);
    this.cartSight = this.players.map(() => new Map<Cart, number>());
  }

  start(seed = this.seed, humanSeats: Iterable<number> = this.humanSeats): void {
    const seats = new Set(humanSeats);
    for (const seat of seats) {
      if (!Number.isInteger(seat) || seat < 0 || seat >= this.arena.spawns.length) {
        throw new RangeError('Invalid human seat: ' + seat);
      }
    }
    this.humanSeats = seats;
    this.seed = seed >>> 0;
    this.random = rng(this.seed);
    this.tick = 0;
    this.phase = 'ready';
    this.playAt = READY_TICKS;
    this.players = this.createPlayers();
    this.carts = [];
    this.lanes = this.arena.routes.map((route, lane) => ({
      next: this.playAt + route.first,
      warned: false,
      random: rng(this.seed ^ (lane === 0 ? 0x3ad152b7 : 0xb71f38da)),
    }));
    this.holder = null;
    this.deadline = this.passAt = 0;
    this.assignAt = this.playAt + 30;
    this.winner = null;
    this.events = [];
    this.touching.clear();
    this.chaseTarget = null;
    this.botPlans = this.players.map(zero);
    for (const sight of this.cartSight) sight.clear();
  }

  get remaining(): number {
    return this.holder === null ? 0 : Math.max(0, this.deadline - this.tick);
  }

  step(input: Vec): void {
    this.stepSeats({ [OFFLINE_SEAT]: input });
  }

  stepSeats(inputs: SeatInputs): void {
    this.events = [];
    if (this.phase === 'lobby' || this.phase === 'result') return;
    this.tick++;
    if (this.phase === 'ready' && this.tick === this.playAt) this.phase = 'play';
    if (this.phase !== 'play') return;

    if (this.holder !== null && this.tick >= this.deadline) this.detonate();
    if (this.winner !== null) return;
    if (this.holder === null && this.tick >= this.assignAt) this.assign();
    this.advanceCarts();

    if (this.tick % 5 === 0) {
      for (const bot of this.players) {
        if (bot.alive && !this.humanSeats.has(bot.id)) this.botPlans[bot.id] = this.planBot(bot);
      }
    }
    for (const player of this.players) {
      if (!player.alive) continue;
      const human = this.humanSeats.has(player.id);
      this.move(player, human ? inputs[player.id] ?? noInput : this.botPlans[player.id], human);
    }
    this.resolveContacts();
    this.resolveCarts();
  }

  private createPlayers(): Player[] {
    const spawns = this.arena.spawns;
    const offset = this.arena.rotateSpawns ? this.seed % spawns.length : 0;
    return spawns.map((_, id) => {
      const spawn = spawns[(id + offset) % spawns.length];
      return {
        id, position: { ...spawn }, previous: { ...spawn }, drive: zero(), impulse: zero(),
        heading: 0, alive: true, stunnedUntil: 0, eliminatedAt: -1,
      };
    });
  }

  private assign(): void {
    const live = this.players.filter(player => player.alive);
    this.holder = live[Math.floor(this.random() * live.length)].id;
    this.deadline = this.tick + FUSE_TICKS;
    this.passAt = this.tick + PASS_TICKS;
    this.chaseTarget = null;
    this.events.push({ type: 'assign', player: this.holder });
  }

  private advanceCarts(): void {
    for (const [lane, state] of this.lanes.entries()) {
      if (!state.warned && this.tick >= state.next - CART_WARNING) {
        state.warned = true;
        this.events.push({ type: 'horn', lane });
      }
      if (this.tick < state.next) continue;
      const position = this.arena.point(lane, 0);
      this.carts.push({
        lane, start: this.tick, position, previous: position, heading: routeHeading(this.arena, lane, 0),
        contacts: 0,
      });
      const [min, max] = this.arena.routes[lane].wait;
      state.next += Math.round(HZ * (2 * min + (max - min) * (state.random() + state.random())));
      state.warned = false;
    }
    this.carts = this.carts.filter(cart => this.tick - cart.start <= this.arena.routes[cart.lane].duration);
    for (const cart of this.carts) {
      const progress = (this.tick - cart.start) / this.arena.routes[cart.lane].duration;
      cart.previous = cart.position;
      cart.position = this.arena.point(cart.lane, progress);
      cart.heading = routeHeading(this.arena, cart.lane, progress);
    }
  }

  private move(player: Player, input: Vec, human: boolean): void {
    player.previous = player.position;
    stepPlayerMotion(player, input, this.arena, this.tick < player.stunnedUntil, human, this.movement);
  }

  private resolveContacts(): void {
    const pairs: { a: Player; b: Player; key: number; entry: number; fresh: boolean }[] = [];
    const next = new Set<number>();
    for (const a of this.players) {
      if (!a.alive) continue;
      for (const b of this.players.slice(a.id + 1)) {
        if (!b.alive) continue;
        const key = 4 * a.id + b.id;
        const entry = sweepCircle(sub(b.previous, a.previous), sub(b.position, a.position), CONTACT_RADIUS);
        const held = this.touching.has(key);
        if (entry !== Infinity) pairs.push({ a, b, key, entry, fresh: !held });
        else if (held && length(sub(b.position, a.position)) <= CONTACT_RADIUS + 0.025) next.add(key);
      }
    }
    pairs.sort((a, b) => a.entry - b.entry || a.key - b.key);
    for (const { a, b, fresh } of pairs) {
      if (!fresh) continue;
      const delta = sub(b.position, a.position);
      const normal = length(delta) > 0.0001 ? unit(delta) : { x: 1, z: 0 };
      let shove = 1.25;
      if (this.movement === 'responsive') {
        const closing = Math.max(0, dot(sub(a.drive, b.drive), normal));
        shove = Math.min(3.25, 0.90 + closing * 0.30);
        // Take some speed out of the impact direction while keeping sideways motion.
        a.drive = sub(a.drive, scale(normal, 0.42 * Math.max(0, dot(a.drive, normal))));
        b.drive = sub(b.drive, scale(normal, 0.42 * Math.min(0, dot(b.drive, normal))));
      }
      a.impulse = sub(a.impulse, scale(normal, shove));
      b.impulse = add(b.impulse, scale(normal, shove));
      if (this.holder === null || this.tick < this.passAt) continue;
      if (this.holder !== a.id && this.holder !== b.id) continue;
      this.holder = this.holder === a.id ? b.id : a.id;
      this.passAt = this.tick + PASS_TICKS;
      this.chaseTarget = null;
      this.events.push({ type: 'pass', player: this.holder });
    }
    // A short extra solve keeps multi-player contact stable against the arena wall.
    for (let iteration = 0; iteration < 3; iteration++) {
      for (const a of this.players) {
        if (!a.alive) continue;
        for (const b of this.players.slice(a.id + 1)) {
          if (!b.alive) continue;
          const delta = sub(b.position, a.position);
          const distance = length(delta);
          if (distance > CONTACT_RADIUS) continue;
          const normal = distance > 0.0001 ? unit(delta) : { x: 1, z: 0 };
          const correction = scale(normal, (CONTACT_RADIUS - distance) * 0.5);
          a.position = withinArena(sub(a.position, correction), this.arena);
          b.position = withinArena(add(b.position, correction), this.arena);
        }
      }
    }
    for (const { a, b, key } of pairs) {
      if (length(sub(b.position, a.position)) <= CONTACT_RADIUS + 0.025) next.add(key);
    }
    this.touching = next;
  }

  private resolveCarts(): void {
    for (const cart of this.carts) {
      let next = 0;
      for (const player of this.players) {
        if (!player.alive) continue;
        const { touching, impact } = cartContact(player, cart, this.arena);
        const bit = 1 << player.id;
        if (impact || (touching && (cart.contacts & bit))) next |= bit;
        if (!impact) continue;
        player.position = impact.position;
        player.drive = slideAlong(player.drive, impact.outward);
        player.impulse = slideAlong(player.impulse, impact.outward);
        if (cart.contacts & bit) continue;
        player.impulse = scale(unit(add(impact.outward, scale(impact.travel, 0.32))), 6.5);
        if (this.tick < player.stunnedUntil) continue;
        player.stunnedUntil = this.tick + STUN_TICKS;
        player.drive = zero();
        this.events.push({ type: 'hit', player: player.id });
      }
      cart.contacts = next;
    }
  }

  private detonate(): void {
    const player = this.players[this.holder!];
    player.alive = false;
    this.cartSight[player.id].clear();
    player.eliminatedAt = this.tick;
    this.events.push({ type: 'blast', player: player.id });
    this.holder = null;
    this.assignAt = this.tick + HZ;
    const live = this.players.filter(candidate => candidate.alive);
    if (live.length !== 1) return;
    this.winner = live[0].id;
    this.phase = 'result';
    this.events.push({ type: 'win', player: this.winner });
  }

  private planBot(bot: Player): Vec {
    const rivals = this.players.filter(player => player.alive && player.id !== bot.id);
    const carrier = this.holder === null ? undefined : this.players[this.holder];
    const carrying = carrier?.id === bot.id;
    const chasing = carrying && this.tick >= this.passAt;
    const hazards = this.noticedCarts(bot);
    const target = chasing ? this.selectTarget(bot, rivals, hazards) : carrying ? undefined : carrier;
    const predicted = target ? add(target.position, scale(target.drive, 0.15)) : undefined;
    const roamAngle = this.tick / 106 + bot.id * 2.1 + (this.seed % 91);
    const roam = { x: Math.cos(roamAngle), z: Math.sin(roamAngle) };
    const relative = predicted ? sub(predicted, bot.position) : zero();
    const desired = target ? scale(unit(relative), chasing ? 1 : -1) : roam;
    const urgent = chasing && this.remaining < 150;
    const urgency = chasing ? 1.9 : clamp(2.9 - length(relative) * 0.31, 0.35, 2.4);
    let best = desired;
    let bestScore = -Infinity;
    for (const direction of [desired, ...BOT_DIRECTIONS, zero()]) {
      const step = scale(direction, 1.95);
      const point = add(bot.position, step);
      let score = dot(direction, desired) * urgency + 0.19 * dot(direction, roam);
      score -= 1.35 * length(sub(point, withinArena(point, this.arena)));
      score -= Math.max(0, length(point) - 5.2) * (chasing ? 0.04 : 0.17);
      if (!chasing) {
        for (const rival of rivals) {
          score -= Math.max(0, 1.75 - length(sub(point, rival.position))) * 0.33;
        }
      }
      score -= this.cartRisk(bot.position, step, hazards) * (urgent ? 0.90 : 1.75);
      if (score > bestScore) {
        bestScore = score;
        best = direction;
      }
    }
    return best;
  }

  private selectTarget(bot: Player, rivals: Player[], hazards: CartForecast[]): Player {
    if (this.chasePolicy === 'nearest') {
      return rivals.reduce((best, candidate) => (
        length(sub(candidate.position, bot.position)) < length(sub(best.position, bot.position))
          ? candidate : best
      ));
    }

    const current = this.chaseTarget;
    if (current && this.tick < current.until && this.players[current.id].alive) {
      return this.players[current.id];
    }
    let target = rivals[0];
    let bestCost = Infinity;
    for (const rival of rivals) {
      const intercept = withinArena(add(rival.position, scale(rival.drive, 0.15)), this.arena);
      const offset = sub(intercept, bot.position);
      const distance = length(offset);
      const step = scale(offset, Math.min(1, 1.95 / (distance || 1)));
      const cost = distance + 3 * this.cartRisk(bot.position, step, hazards);
      if (cost < bestCost) {
        bestCost = cost;
        target = rival;
      }
    }
    this.chaseTarget = { id: target.id, until: this.tick + CHASE_COMMIT_TICKS };
    return target;
  }

  private cartRisk(position: Vec, step: Vec, hazards: CartForecast[]): number {
    const nearPoint = add(position, scale(step, 0.52));
    const farPoint = add(position, step);
    let risk = 0;
    for (const hazard of hazards) {
      const near = length(sub(nearPoint, hazard.near));
      const far = length(sub(farPoint, hazard.far));
      risk += Math.max(0, 2.0 - Math.min(near, far));
    }
    return risk;
  }

  private noticedCarts(bot: Player): CartForecast[] {
    const previousSight = this.cartSight[bot.id];
    const sight = new Map<Cart, number>();
    const hazards: CartForecast[] = [];
    for (const cart of this.carts) {
      const offset = sub(bot.position, cart.position);
      const distance = length(offset);
      const motion = sub(cart.position, cart.previous);
      if (distance > CART_SIGHT_RADIUS || (distance > 1.75 && dot(motion, offset) <= 0)) continue;
      const seenAt = previousSight.get(cart) ?? this.tick;
      sight.set(cart, seenAt);
      if (this.tick - seenAt < CART_REACTION_TICKS) continue;
      hazards.push({
        near: add(cart.position, scale(motion, 13)),
        far: add(cart.position, scale(motion, 21)),
      });
    }
    this.cartSight[bot.id] = sight;
    return hazards;
  }
}
