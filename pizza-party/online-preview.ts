import { constrain } from './geometry.ts';
import {
  MAX_PIZZA_INPUT_LEAD, PIZZA_IDLE, PIZZA_INPUT_LEAD, PIZZA_TICK_MS,
} from './network-state.ts';
import type { PizzaFrameMessage, PizzaHostMessage } from './network-state.ts';
import { predictPizzaStep } from './simulation.ts';
import type { PizzaPose, Vec } from './simulation.ts';

type State = Extract<PizzaHostMessage, { type: 'state' }>;
const sameInput = (a: Vec, b: Vec) => a.x === b.x && a.z === b.z;
const clockNow = (now: number) => performance.timeOrigin + now;

export class OnlinePizza {
  private latest: State | undefined;
  private receivedAt = 0;
  private span = PIZZA_TICK_MS;
  private sent = new Map<number, Vec>();
  private lastSentAt = -Infinity;
  private lastSentTick = 0;
  private lastInput = PIZZA_IDLE;
  private shown: PizzaPose | undefined;
  private offset = { x: 0, z: 0 };
  private predictedAt = 0;
  private baseTick = -1;

  constructor(private readonly seat: number, private readonly post: (message: PizzaFrameMessage) => void) {}

  receive(message: State) {
    const previousTick = this.latest?.snapshot.view.tick ?? message.snapshot.view.tick;
    this.latest = message;
    this.receivedAt = message.at - performance.timeOrigin;
    this.span = Math.max(1, Math.min(6, message.snapshot.view.tick - previousTick)) * PIZZA_TICK_MS;
    for (const tick of this.sent.keys()) if (tick <= message.snapshot.view.tick) this.sent.delete(tick);
  }

  release() {
    this.sent.clear();
    this.shown = undefined;
    this.offset = { x: 0, z: 0 };
  }

  blend(now: number) {
    return Math.max(0, Math.min(1, (now - this.receivedAt) / this.span));
  }

  stale(now: number): boolean {
    return !!this.latest && now - this.receivedAt > 650;
  }

  advance(now: number, input: Vec, steering: boolean): PizzaPose | undefined {
    const state = this.latest;
    if (!state || state.snapshot.view.phase !== 'playing') return;
    const { snapshot, clock } = state;
    const tick = snapshot.view.tick;
    const estimated = clock ? clock.tick + (clockNow(now) - clock.at) / PIZZA_TICK_MS : tick;
    const target = Math.max(tick + 1, Math.floor(estimated) + PIZZA_INPUT_LEAD);
    const inputTick = Math.min(tick + MAX_PIZZA_INPUT_LEAD + PIZZA_INPUT_LEAD, target);
    const direction = steering ? {
      x: Math.max(-1, Math.min(1, input.x)), z: Math.max(-1, Math.min(1, input.z)),
    } : PIZZA_IDLE;
    const changed = !sameInput(direction, this.lastInput);
    const releasing = changed && sameInput(direction, PIZZA_IDLE);

    if (releasing || steering && now - this.lastSentAt >= (changed ? 16 : 50)) {
      const requested = Math.max(this.lastSentTick, inputTick);
      this.lastSentAt = now;
      this.lastSentTick = requested;
      this.lastInput = direction;
      this.sent.set(requested, direction);
      this.post({ type: 'input', round: snapshot.round, tick: requested, direction });
    }
    if (!steering || now - this.receivedAt > 300) return;

    const player = snapshot.view.players[this.seat];
    const pose = { position: { ...player.position }, heading: player.heading, recoil: { ...player.recoil } };
    let active = snapshot.directions[this.seat];
    for (let step = tick + 1; step <= Math.max(inputTick, this.lastSentTick) && step <= tick + 15; step++) {
      active = this.sent.get(step) ?? active;
      if (step === inputTick) active = direction;
      predictPizzaStep(pose, active);
    }
    const age = Math.max(0, now - this.predictedAt);
    this.predictedAt = now;
    if (this.shown && this.baseTick !== tick) {
      const dx = this.shown.position.x - pose.position.x;
      const dz = this.shown.position.z - pose.position.z;
      if (Math.hypot(dx, dz) < 0.45) this.offset = { x: dx, z: dz };
      else this.offset = { x: 0, z: 0 };
    }
    this.baseTick = tick;
    const decay = Math.exp(-age / 50);
    this.offset.x *= decay;
    this.offset.z *= decay;
    pose.position = constrain({ x: pose.position.x + this.offset.x, z: pose.position.z + this.offset.z }, pose.position);
    this.shown = pose;
    return pose;
  }
}
