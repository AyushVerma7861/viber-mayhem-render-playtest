import { KITCHEN_ARENA } from './arena.ts';
import { HZ, STEP, stepPlayerMotion, withinArena } from './simulation.ts';
import type { PlayerMotion, Vec } from './simulation.ts';
import type { Snapshot } from './online-protocol.ts';

const MAX_PREDICTION_TICKS = 15;
const MAX_SNAPSHOT_AGE_MS = MAX_PREDICTION_TICKS * 1000 / HZ;
const MAX_SENT_INPUTS = 32;
const SNAP_DISTANCE = 0.75;
const CORRECTION_RATE = 18;
const zero: Vec = { x: 0, z: 0 };

export type LocalPose = Pick<PlayerMotion, 'id' | 'position' | 'drive' | 'heading'>;
type MotionStep = { tick: number; input: Vec };
type SentInput = { sequence: number; tick: number; time: number };

export class OnlineMovement {
  private pose?: PlayerMotion;
  private steps: MotionStep[] = [];
  private sent: SentInput[] = [];
  private round = -1;
  private tick = 0;
  private lead = 0;
  private serverTick = 0;
  private alignedTick = 0;
  private snapshotAt = 0;
  private frameAt = 0;
  private remainder = 0;
  private correction = zero;
  private correctionAt = 0;
  confirmationMs?: number;
  correctionDistance = 0;

  reset(): void {
    this.pose = undefined;
    this.steps = [];
    this.sent = [];
    this.correction = zero;
    this.confirmationMs = undefined;
    this.correctionDistance = 0;
    this.tick = this.lead = this.remainder = 0;
  }

  reconcile(snapshot: Snapshot, seat: number, now: number): void {
    const { view, round } = snapshot;
    const player = view.players[seat];
    if (view.phase !== 'play' || !player?.alive || view.tick < player.stunnedUntil) {
      this.reset();
      return;
    }
    const next: PlayerMotion = { ...player };
    if (!this.pose || this.round !== round || this.pose.id !== seat || now - this.snapshotAt > MAX_SNAPSHOT_AGE_MS) {
      this.reset();
      this.pose = next;
      this.round = round;
      this.serverTick = view.tick;
      this.alignedTick = 0;
      this.frameAt = this.snapshotAt = this.correctionAt = now;
      return;
    }
    if (view.tick <= this.serverTick) return;

    const applied = snapshot.appliedInputs?.[seat];
    const anchor = this.sent.find(item => item.sequence === applied?.sequence);
    const pending = this.sent.find(item => item.sequence > (applied?.sequence ?? -1));
    let aligned = anchor && applied
      ? anchor.tick + view.tick - applied.tick
      : this.alignedTick + view.tick - this.serverTick;
    if (pending) aligned = Math.min(aligned, pending.tick - 1);
    this.alignedTick = Math.min(this.tick, Math.max(this.tick - MAX_PREDICTION_TICKS, aligned));

    this.lead = 0;
    for (const step of this.steps) {
      if (step.tick <= this.alignedTick) continue;
      stepPlayerMotion(next, step.input, KITCHEN_ARENA, false);
      this.lead++;
    }

    const previous = this.renderPosition(this.pose.position);
    const correction = { x: previous.x - next.position.x, z: previous.z - next.position.z };
    this.correctionDistance = Math.hypot(correction.x, correction.z);
    this.correction = this.correctionDistance <= SNAP_DISTANCE ? correction : zero;
    this.correctionAt = now;
    if (anchor && applied) {
      this.confirmationMs = now - anchor.time;
      this.sent = this.sent.filter(item => item.sequence > applied.sequence);
    }
    this.pose = next;
    this.serverTick = view.tick;
    this.snapshotAt = now;
  }

  advance(now: number, input: Vec, sequence?: number): LocalPose | undefined {
    const pose = this.pose;
    if (!pose) return;
    const elapsed = Math.max(0, now - this.frameAt) / 1000;
    this.frameAt = now;
    const ease = Math.exp(-Math.max(0, now - this.correctionAt) / 1000 * CORRECTION_RATE);
    this.correctionAt = now;
    this.correction = { x: this.correction.x * ease, z: this.correction.z * ease };
    if (now - this.snapshotAt > MAX_SNAPSHOT_AGE_MS) {
      return { ...pose, position: this.renderPosition(pose.position), drive: zero };
    }

    if (sequence !== undefined) {
      this.sent.push({ sequence, tick: this.tick + 1, time: now });
      if (this.sent.length > MAX_SENT_INPUTS) this.sent.shift();
    }
    this.remainder += Math.min(elapsed, 4 * STEP);
    while (this.remainder + 1e-9 >= STEP) {
      this.remainder = Math.max(0, this.remainder - STEP);
      this.steps.push({ tick: ++this.tick, input });
      if (this.steps.length > MAX_PREDICTION_TICKS) this.steps.shift();
      if (this.lead < MAX_PREDICTION_TICKS) {
        stepPlayerMotion(pose, input, KITCHEN_ARENA, false);
        this.lead++;
      }
    }
    return { ...pose, position: this.renderPosition(pose.position) };
  }

  private renderPosition(position: Vec): Vec {
    return withinArena({ x: position.x + this.correction.x, z: position.z + this.correction.z }, KITCHEN_ARENA);
  }
}
