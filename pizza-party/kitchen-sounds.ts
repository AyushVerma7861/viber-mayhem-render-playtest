import type { createPizzaAudio } from './audio.ts';
import { BOX_TICK, DISPATCH_TICK, idlePhase, LID_CLOSE_TICKS, TOPPING_TRANSFER_TICKS } from './chef-pose.ts';
import type { FoleyCue } from './foley.ts';
import { COUNTERS, SOLIDS, SUPPLY_POINTS } from './layout.ts';
import type { Vec } from './layout.ts';
import { BAKE_TICKS, START_TICKS } from './simulation.ts';
import type { PizzaEvent } from './simulation.ts';
import type { PizzaDisplay, PizzaTimedEvent } from './network-state.ts';

export type RunnerStride = { previous: number; current: number };
const stepLength = 0.515;
const idleSounds: readonly (FoleyCue | undefined)[] = [undefined, 'tongs', 'cardboard', 'wipe'];

export function createKitchenSounds(audio: ReturnType<typeof createPizzaAudio>, seat = 0) {
  const strides = COUNTERS.map(() => ({ previous: 0, current: 0 }));
  const direction = COUNTERS.map(() => ({ x: 0, z: 0, pace: 0, lastGrip: -100 }));
  const landings: { tick: number; id: number }[] = [];

  function near(cue: FoleyCue, listener: Vec, source: Vec, volume: number, radius: number) {
    const dx = source.x - listener.x;
    const distance = Math.hypot(dx, source.z - listener.z);
    if (distance >= radius) return;
    const falloff = 1 - (distance / radius) ** 1.45;
    audio.play(cue, volume * falloff / (1 + distance * 0.33), dx / 4.4);
  }

  function station(cue: FoleyCue, match: PizzaDisplay, id: number, volume: number) {
    near(cue, match.players[seat].position, COUNTERS[id].center, volume, 4.05);
  }

  return {
    strides,
    reset() {
      for (const stride of strides) stride.previous = stride.current = 0;
      for (const step of direction) {
        step.x = step.z = step.pace = 0;
        step.lastGrip = -100;
      }
      landings.length = 0;
    },
    event(match: PizzaDisplay, event: PizzaEvent & Partial<PizzaTimedEvent>) {
      const player = match.players[event.player], listener = match.players[seat].position;
      switch (event.type) {
        case 'refill':
          if (event.station !== undefined) near('tray', listener, SUPPLY_POINTS[event.station], 0.38, 3.15);
          break;
        case 'pickup':
        case 'swap': {
          const food = event.station === undefined ? player.carried : match.supplies[event.station];
          if (food) near('pickup-' + food as FoleyCue, listener, player.position, player.id === seat ? 0.93 : 0.40, 3.7);
          if (event.type === 'swap' && player.id === seat) audio.play('grip', 0.31);
          break;
        }
        case 'deliver':
          if (event.counter === undefined) break;
          station('plate', match, event.counter, player.id === seat ? 1 : 0.65);
          landings.push({ tick: (event.tick ?? match.tick) + TOPPING_TRANSFER_TICKS - 1, id: event.counter });
          break;
        case 'bump':
          near('bump', listener, player.position, player.id === seat ? 0.92 : 0.67, 3.3);
          break;
        case 'score':
          if (event.player === seat) audio.play('score', 0.86);
          break;
        case 'finish':
          audio.play('finish', 0.94);
          break;
      }
    },
    step(match: PizzaDisplay, span = 1) {
      if (match.phase !== 'playing') return;
      if (match.tick >= START_TICKS && match.tick < START_TICKS + span) audio.play('start', 0.81);
      const listener = match.players[seat].position;
      for (const player of match.players) {
        const stride = strides[player.id], move = direction[player.id];
        const dx = (player.position.x - player.previous.x) / span, dz = (player.position.z - player.previous.z) / span;
        const pace = Math.hypot(dx, dz);
        stride.previous = stride.current;
        if (pace > 0.008) {
          stride.current += pace * span / stepLength;
          if (Math.floor(stride.current) !== Math.floor(stride.previous)) {
            near('footstep', listener, player.position, player.id === seat ? 0.58 : 0.37, 2.85);
          }
          const turning = move.pace > 0.019 && pace > 0.021 &&
            (dx * move.x + dz * move.z) < -0.25 * move.pace * pace;
          if (turning && match.tick - move.lastGrip >= 23) {
            near('grip', listener, player.position, player.id === seat ? 0.47 : 0.24, 2.55);
            move.lastGrip = match.tick;
          }
        }
        move.x = dx; move.z = dz; move.pace = pace;
        for (let tick = match.tick + 1 - span; tick <= match.tick; tick++) {
          const age = player.serviceAt < 0 ? -1 : tick - player.serviceAt;
          switch (age) {
            case TOPPING_TRANSFER_TICKS + 2: station('prep', match, player.id, 0.73); break;
            case BAKE_TICKS: station('bake', match, player.id, 1); break;
            case DISPATCH_TICK: station('peel', match, player.id, 0.86); break;
            case BOX_TICK + LID_CLOSE_TICKS: station('box', match, player.id, 0.86); break;
            case -1: {
              const cue = idleSounds[player.id];
              if (cue && idlePhase(player.id, tick) === 28 && !landings.some(entry => entry.id === player.id)) {
                near(cue, listener, COUNTERS[player.id].center, 0.43, 2.72);
              }
            }
          }
        }
      }
      while (landings.length && landings[0].tick <= match.tick) {
        const { id } = landings.shift()!;
        station('tray', match, id, 0.85);
      }
      if ((match.tick + match.seed % 39 + 63) % 143 < span) near('warmer', listener, SOLIDS[1].center, 0.53, 2.75);
    },
  };
}
