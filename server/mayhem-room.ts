import { randomBytes } from 'node:crypto';
import { Room, ServerError } from '@colyseus/core';
import type { Client } from '@colyseus/core';
import { KITCHEN_ARENA } from '../src/arena.ts';
import { HZ, Match } from '../src/simulation.ts';
import type { MatchView } from '../src/simulation.ts';
import { RECONNECT_SECONDS, ROOM_PING, ROOM_SERVER_BUSY, SEAT_COUNT, SNAPSHOT_TICKS } from '../src/online-protocol.ts';
import type { AppliedInput, OnlineInput, RoomPhase, RoomView, Snapshot } from '../src/online-protocol.ts';

type Seat = {
  viber: number;
  session: string | null;
  connected: boolean;
  ready: boolean;
  input?: OnlineInput;
  lastSequence: number;
  receivedAt: number;
  applied: AppliedInput | null;
};
const TICK_MS = 1000 / HZ;
const MAX_CATCH_UP_STEPS = 24;
const STALE_INPUT_MS = 450;
const MAX_ROOMS = Number(process.env.MAYHEM_MAX_ROOMS ?? 8);
if (!Number.isSafeInteger(MAX_ROOMS) || MAX_ROOMS < 1) throw new Error('MAYHEM_MAX_ROOMS must be a positive integer.');
const ROOM_CREATION_WINDOW_MS = 10000;
const roomCreations: number[] = [];
let activeRooms = 0;
const numberInRange = (v: unknown, max: number): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v < max;

export class MayhemRoom extends Room {
  maxClients = SEAT_COUNT;
  maxMessagesPerSecond = 120;
  private readonly match = new Match(0, 'nearest', KITCHEN_ARENA);
  private readonly seats: Seat[] = Array.from({ length: SEAT_COUNT }, (_, viber) => ({
    viber, session: null, connected: false, ready: false, lastSequence: -1, receivedAt: -Infinity, applied: null,
  }));
  private phase: RoomPhase = 'waiting';
  private round = 0;
  private roundHumans = new Set<number>();
  private host = -1;
  private elapsed = 0;
  private lastUpdate = 0;
  private lastSnapshot = 0;
  private events: MatchView['events'][number][] = [];
  private admitted = false;

  async onCreate() {
    const now = performance.now();
    while (roomCreations.length && roomCreations[0] <= now - ROOM_CREATION_WINDOW_MS) roomCreations.shift();
    if (activeRooms >= MAX_ROOMS || roomCreations.length >= MAX_ROOMS * 2) {
      throw new ServerError(ROOM_SERVER_BUSY, 'This server is busy. Try again soon or choose another region.');
    }
    activeRooms++;
    roomCreations.push(now);
    this.admitted = true;
    try {
      this.roomId = randomBytes(9).toString('base64url');
      await this.setPrivate(true);
      this.onMessage('sync', client => this.sync(client));
      this.onMessage(ROOM_PING, () => true);
      this.onMessage('viber', (client, value: unknown) => this.selectViber(client, value));
      this.onMessage('ready', (client, value: unknown) => this.ready(client, value));
      this.onMessage('start', client => this.startRound(client));
      this.onMessage('waiting', client => this.openWaitingRoom(client));
      this.onMessage('input', (client, value: unknown) => this.acceptInput(client, value));
      this.setSimulationInterval(() => this.advance(), TICK_MS);
    } catch (error) {
      this.releaseAdmission();
      throw error;
    }
  }

  onDispose() {
    this.releaseAdmission();
  }

  private releaseAdmission() {
    if (!this.admitted) return;
    this.admitted = false;
    activeRooms--;
  }

  onAuth() {
    return this.phase === 'waiting';
  }

  onJoin(client: Client, options: { viber?: unknown } = {}) {
    const seat = this.seats.findIndex(item => item.session === null);
    if (seat < 0 || this.phase !== 'waiting') {
      client.leave();
      return;
    }
    const item = this.seats[seat];
    item.session = client.sessionId;
    item.connected = true;
    item.ready = false;
    if (this.host < 0) this.host = seat;
    if (numberInRange(options.viber, SEAT_COUNT)) this.assignViber(seat, options.viber);
    this.publishRoom();
  }

  onDrop(client: Client) {
    const index = this.indexOf(client);
    if (index < 0) return;
    const seat = this.seats[index];
    seat.connected = seat.ready = false;
    seat.input = undefined;
    this.publishRoom();
    void this.allowReconnection(client, RECONNECT_SECONDS).catch(() => {
      if (seat.session === client.sessionId && !seat.connected) this.release(index);
    });
  }

  onReconnect(client: Client) {
    const index = this.indexOf(client);
    if (index < 0) return;
    this.seats[index].connected = true;
    this.seats[index].input = undefined;
    this.publishRoom();
  }

  onLeave(client: Client) {
    const index = this.indexOf(client);
    if (index >= 0) this.release(index);
  }

  private indexOf(client: Client) {
    return this.seats.findIndex(seat => seat.session === client.sessionId);
  }

  private release(index: number) {
    const seat = this.seats[index];
    seat.connected = seat.ready = false;
    seat.input = undefined;
    seat.session = null;
    if (index === this.host) {
      this.host = this.seats.findIndex(item => item.connected);
      if (this.host < 0) this.host = this.seats.findIndex(item => item.session !== null);
    }
    this.publishRoom();
  }

  private roomView(you: number): RoomView {
    return {
      code: this.roomId, phase: this.phase, round: this.round, host: this.host, you,
      seats: this.seats.map((seat, index) => ({
        viber: seat.viber, ready: seat.ready,
        kind: seat.connected ? 'human' : seat.session !== null ? 'away' :
          this.phase === 'playing' && this.roundHumans.has(index) ? 'left' : 'bot',
      })),
    };
  }

  private publishRoom() {
    for (const client of this.clients) {
      const seat = this.indexOf(client);
      if (seat >= 0) client.send('room', this.roomView(seat));
    }
  }

  private sync(client: Client) {
    const index = this.indexOf(client);
    if (index < 0) return;
    client.send('room', this.roomView(index));
    if (this.phase !== 'waiting') client.send('snapshot', this.snapshot([]));
  }

  private assignViber(index: number, viber: number) {
    const other = this.seats.findIndex(item => item.viber === viber);
    if (other === index) return;
    if (this.seats[other].session !== null) return;
    this.seats[other].viber = this.seats[index].viber;
    this.seats[index].viber = viber;
  }

  private selectViber(client: Client, value: unknown) {
    const index = this.indexOf(client);
    if (index < 0 || this.phase !== 'waiting' || !numberInRange(value, SEAT_COUNT)) return;
    this.assignViber(index, value);
    this.publishRoom();
  }

  private ready(client: Client, value: unknown) {
    const index = this.indexOf(client);
    if (index < 0 || this.phase === 'playing' || typeof value !== 'boolean') return;
    this.seats[index].ready = value;
    this.publishRoom();
  }

  private notice(client: Client, message: string) {
    client.send('notice', message);
  }

  private startRound(client: Client) {
    if (this.indexOf(client) !== this.host || this.phase === 'playing') return;
    if (this.seats.some((seat, index) => index !== this.host && seat.connected && !seat.ready)) {
      this.notice(client, 'Waiting for everyone to ready up.');
      return;
    }
    if (this.seats.some(seat => seat.session !== null && !seat.connected)) {
      this.notice(client, 'A player is reconnecting. Their seat is held briefly.');
      return;
    }
    const humans = this.seats.flatMap((seat, index) => seat.connected ? [index] : []);
    this.roundHumans = new Set(humans);
    this.round++;
    this.phase = 'playing';
    this.elapsed = this.lastSnapshot = 0;
    this.lastUpdate = performance.now();
    this.events = [];
    for (const seat of this.seats) {
      seat.ready = false;
      seat.lastSequence = -1;
      seat.input = undefined;
      seat.receivedAt = -Infinity;
      seat.applied = null;
    }
    this.match.start(randomBytes(4).readUInt32LE(), humans);
    void this.lock();
    this.publishRoom();
    this.broadcast('snapshot', this.snapshot([]));
  }

  private openWaitingRoom(client: Client) {
    if (this.indexOf(client) !== this.host || this.phase !== 'results') return;
    this.phase = 'waiting';
    this.seats.forEach(seat => { seat.ready = false; });
    void this.unlock();
    this.publishRoom();
  }

  private acceptInput(client: Client, value: unknown) {
    const index = this.indexOf(client);
    if (index < 0 || this.phase !== 'playing' || !value || typeof value !== 'object') return;
    const input = value as Partial<OnlineInput>;
    const seat = this.seats[index];
    if (!seat.connected || input.round !== this.round || !numberInRange(input.sequence, Number.MAX_SAFE_INTEGER) ||
      input.sequence <= seat.lastSequence || typeof input.x !== 'number' || typeof input.z !== 'number' ||
      !Number.isFinite(input.x) || !Number.isFinite(input.z)) return;
    seat.lastSequence = input.sequence;
    seat.receivedAt = performance.now();
    seat.input = {
      round: this.round, sequence: input.sequence,
      x: Math.max(-1, Math.min(1, input.x)), z: Math.max(-1, Math.min(1, input.z)),
    };
  }

  private snapshot(events: MatchView['events']): Snapshot {
    const match = this.match;
    return {
      round: this.round,
      acknowledgments: this.seats.map(seat => seat.lastSequence),
      appliedInputs: this.seats.map(seat => seat.applied),
      view: {
        tick: match.tick, phase: match.phase, playAt: match.playAt, holder: match.holder, passAt: match.passAt,
        remaining: match.remaining, winner: match.winner, players: match.players, carts: match.carts,
        lanes: match.lanes.map(({ warned }) => ({ warned })), events,
      },
    };
  }

  private advance() {
    if (this.phase !== 'playing') return;
    const now = performance.now();
    this.elapsed += now - this.lastUpdate;
    this.lastUpdate = now;
    const inputs = this.seats.map(seat =>
      seat.connected && now - seat.receivedAt < STALE_INPUT_MS ? seat.input : undefined);
    for (let n = 0; this.elapsed >= TICK_MS && n < MAX_CATCH_UP_STEPS; n++) {
      this.elapsed -= TICK_MS;
      this.match.stepSeats(inputs);
      this.events.push(...this.match.events);
      if (this.match.phase === 'play') {
        for (const [index, input] of inputs.entries()) {
          const seat = this.seats[index];
          if (input && this.match.players[index].alive && seat.applied?.sequence !== input.sequence) {
            seat.applied = { sequence: input.sequence, tick: this.match.tick };
          }
        }
      }
      if (this.match.phase === 'result') {
        this.phase = 'results';
        this.publishRoom();
        break;
      }
    }
    if (this.phase === 'results' || this.match.tick - this.lastSnapshot >= SNAPSHOT_TICKS) {
      this.lastSnapshot = this.match.tick;
      this.broadcast('snapshot', this.snapshot(this.events));
      this.events = [];
    }
  }
}
