import { MAX_PIZZA_INPUT_LEAD, PIZZA_IDLE } from '../pizza-party/network-state.ts';
import type { PizzaSnapshot, PizzaTimedEvent } from '../pizza-party/network-state.ts';
import { PizzaMatch, platePosition } from '../pizza-party/simulation.ts';
import type { Vec } from '../pizza-party/simulation.ts';

const STALE_TICKS = 27;
const SEATS = [0, 1, 2, 3];

export class PizzaRound {
  readonly match = new PizzaMatch(0, 'closest', true);
  private active = new Set<number>();
  private schedules = SEATS.map(() => new Map<number, Vec>());
  private directions = SEATS.map(() => PIZZA_IDLE);
  private lastTick = SEATS.map(() => -Infinity);
  private spawnSeats = [...SEATS];
  private events: PizzaTimedEvent[] = [];

  start(seed: number, humans: readonly number[], round: number): void {
    this.match.reset(seed);
    this.active = new Set(humans);
    this.events = [];
    this.schedules.forEach((_, seat) => this.clear(seat));

    // Keep the kitchen's seeded routes and pair the two human players for the opening rush.
    const pair = this.match.openingPair!.seats;
    const humanSpawns = humans.length >= 2 && round % 2 === 0 ? [...pair].reverse() : [...pair];
    const paired = humans.slice(0, 2);
    const assignments = new Map<number, number>(paired.map((seat, index) => [humanSpawns[index], seat]));
    const openSeats = SEATS.filter(seat => !paired.includes(seat));
    this.spawnSeats = SEATS.map(spawn => assignments.get(spawn) ?? openSeats.shift()!);
  }

  queue(seat: number, requestedTick: number, direction: Vec): void {
    const nextTick = this.match.tick + 1;
    const tick = Math.max(nextTick, Math.min(this.match.tick + MAX_PIZZA_INPUT_LEAD, requestedTick));
    this.schedules[seat].set(tick, direction);
  }

  clear(seat: number): void {
    this.schedules[seat].clear();
    this.directions[seat] = PIZZA_IDLE;
    this.lastTick[seat] = -Infinity;
  }

  step(): void {
    const tick = this.match.tick + 1;
    const inputs = this.spawnSeats.map(seat => {
      if (!this.active.has(seat)) return undefined;
      const input = this.schedules[seat].get(tick);
      if (input) {
        this.schedules[seat].delete(tick);
        this.directions[seat] = input;
        this.lastTick[seat] = tick;
      } else if (tick - this.lastTick[seat] >= STALE_TICKS) {
        this.directions[seat] = PIZZA_IDLE;
      }
      return this.directions[seat];
    });
    this.match.step(inputs);
    for (const event of this.match.events) {
      const plate = event.type === 'deliver' ? platePosition(this.match.players[event.player]) : undefined;
      this.events.push({ ...event, tick: this.match.tick, plate });
    }
  }

  snapshot(round: number, acknowledgments: number[], includeEvents: boolean): PizzaSnapshot {
    const { seed, tick, phase, remaining, winners, supplies, trayReadyAt, openingPair } = this.match;
    const events = includeEvents ? this.events.splice(0) : [];
    return {
      round, spawnSeats: this.spawnSeats,
      acknowledgments, directions: this.spawnSeats.map(seat => this.directions[seat]), events,
      view: {
        seed, tick, phase, remaining, winners, supplies, trayReadyAt, openingPair,
        players: this.match.players.map(({ id, position, previous, heading, previousHeading, recoil,
          carried, recipe, delivered, score, serviceAt, bumpAt }) => ({
          id, position, previous, heading, previousHeading, recoil, carried, recipe, delivered, score, serviceAt,
          bumpAt: Number.isFinite(bumpAt) ? bumpAt : -1e4,
        })),
      },
    };
  }
}
