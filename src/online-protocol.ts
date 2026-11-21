import type { MatchView, Vec } from './simulation.ts';

export const ROOM_TYPE = 'let_them_cook';
export const ROOM_PING = 'latency';
export const ROOM_SERVER_BUSY = 503;
export const SEAT_COUNT = 4;
export const RECONNECT_SECONDS = 20;
export const SNAPSHOT_TICKS = 3;
export const ROOM_CODE = /^[A-Za-z0-9_-]{12}$/;

export type RoomPhase = 'waiting' | 'playing' | 'results';
export interface RoomSeat {
  viber: number;
  kind: 'human' | 'bot' | 'away' | 'left';
  ready: boolean;
}
export interface RoomView {
  code: string;
  phase: RoomPhase;
  round: number;
  host: number;
  you: number;
  seats: RoomSeat[];
}
export interface Snapshot {
  round: number;
  view: MatchView;
  acknowledgments: number[];
  appliedInputs: (AppliedInput | null)[];
}
export interface AppliedInput {
  sequence: number;
  tick: number;
}
export interface OnlineInput extends Vec {
  round: number;
  sequence: number;
}
