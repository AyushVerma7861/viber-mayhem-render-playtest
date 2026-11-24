import { HZ } from './simulation.ts';
import type { PizzaEvent, PizzaMatch, Player, Vec } from './simulation.ts';

export const PIZZA_TICK_MS = 1000 / HZ;
export const PIZZA_INPUT_LEAD = 5;
export const MAX_PIZZA_INPUT_LEAD = 9;
export const PIZZA_IDLE: Vec = { x: 0, z: 0 };

export type PizzaPlayerView = Pick<Player, 'id' | 'position' | 'previous' | 'heading' | 'previousHeading' |
  'recoil' | 'carried' | 'recipe' | 'delivered' | 'score' | 'serviceAt' | 'bumpAt'>;
export type PizzaDisplay = Pick<PizzaMatch, 'seed' | 'tick' | 'phase' | 'remaining' | 'winners' |
  'supplies' | 'trayReadyAt' | 'openingPair'> & { players: PizzaPlayerView[] };
export type PizzaTimedEvent = PizzaEvent & { tick: number; plate?: Vec };

export interface PizzaSnapshot {
  round: number;
  view: PizzaDisplay;
  spawnSeats: number[];
  acknowledgments: number[];
  directions: Vec[];
  events: PizzaTimedEvent[];
}

export type PizzaClock = { tick: number; at: number };
type Ping = number | 'checking' | 'no-reply' | 'reconnecting';
export type PizzaHostMessage =
  | { type: 'state'; snapshot: PizzaSnapshot; at: number; clock?: PizzaClock }
  | { type: 'room'; blocked: boolean; connected: boolean; message: string; ping: Ping;
      rematch: string; canRematch: boolean }
  | { type: 'fullscreen'; active: boolean }
  | { type: 'start'; music: number; effects: number };
export type PizzaFrameMessage =
  | { type: 'ready' | 'back' | 'room' | 'rematch' | 'fullscreen' }
  | { type: 'loaded'; round: number }
  | { type: 'volume'; channel: 'music' | 'effects'; level: number }
  | { type: 'input'; round: number; tick: number; direction: Vec };
