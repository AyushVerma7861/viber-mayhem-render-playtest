import { noiseBuffer, noiseHit } from './music.ts';
import type { Food } from './simulation.ts';

export const FOLEY_CUES = [
  'footstep', 'grip', 'pickup-cheese', 'pickup-tomato', 'pickup-meat', 'pickup-lettuce',
  'plate', 'tray', 'bump', 'prep', 'tongs', 'wipe', 'cardboard', 'bake',
  'peel', 'box', 'warmer', 'start', 'score', 'finish',
] as const;
export type FoleyCue = typeof FOLEY_CUES[number];
export const FOLEY_SLOT = 0.74;
const sampleRate = 32000;

const pickups: Record<Food, { rattle: number; body: number; scrape: number }> = {
  cheese: { rattle: 1100, body: 165, scrape: 0.18 },
  tomato: { rattle: 550, body: 190, scrape: 0.14 },
  meat: { rattle: 850, body: 146, scrape: 0.16 },
  lettuce: { rattle: 2850, body: 224, scrape: 0.25 },
};

function cookCue(ctx: OfflineAudioContext, noise: AudioBuffer, cue: FoleyCue, offset: number) {
  const tone = (time: number, hz: number, duration: number, level: number, end = hz, shape: OscillatorType = 'sine') => {
    const at = offset + time, voice = ctx.createOscillator(), gain = ctx.createGain();
    voice.type = shape;
    voice.frequency.setValueAtTime(hz, at);
    if (end !== hz) voice.frequency.exponentialRampToValueAtTime(end, at + duration * 0.86);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    voice.connect(gain).connect(ctx.destination);
    voice.start(at);
    voice.stop(at + duration + 0.009);
  };
  const air = (time: number, hz: number, duration: number, gain: number, type?: BiquadFilterType) =>
    noiseHit(ctx, ctx.destination, noise, offset + time, hz, duration, gain, type);
  if (cue.startsWith('pickup-')) {
    const { rattle, body, scrape } = pickups[cue.slice(7) as Food];
    air(0, rattle, cue === 'pickup-lettuce' ? 0.109 : 0.065, scrape);
    tone(0.005, body, 0.069, 0.116, body * 0.65, 'triangle');
    tone(0.015, 1137, 0.109, 0.057);
    tone(0.017, 2137, 0.045, 0.019);
    return;
  }
  switch (cue) {
    case 'footstep':
      tone(0.001, 117, 0.076, 0.145, 62, 'triangle');
      air(0.002, 1230, 0.047, 0.164);
      air(0.021, 510, 0.061, 0.075);
      break;
    case 'grip':
      air(0, 1450, 0.110, 0.203);
      tone(0.009, 108, 0.059, 0.096, 71, 'triangle');
      break;
    case 'plate':
      air(0, 860, 0.082, 0.181);
      tone(0, 208, 0.088, 0.139, 105, 'triangle');
      tone(0.006, 823, 0.131, 0.103);
      tone(0.009, 1781, 0.062, 0.052);
      break;
    case 'tray':
      air(0, 1920, 0.037, 0.121);
      tone(0, 624, 0.067, 0.071, 582);
      tone(0.002, 1986, 0.051, 0.047);
      tone(0.008, 298, 0.089, 0.091, 165, 'triangle');
      break;
    case 'bump':
      air(0, 535, 0.109, 0.266);
      tone(0.002, 194, 0.103, 0.183, 73, 'triangle');
      tone(0.008, 883, 0.056, 0.073);
      tone(0.041, 592, 0.076, 0.035);
      break;
    case 'prep':
      for (const [time, hz, level] of [[0, 1160, 0.156], [0.053, 2040, 0.180], [0.10, 725, 0.12]]) {
        air(time, hz, 0.066, level);
        tone(time + 0.002, 287 + hz * 0.05, 0.048, 0.101, 200, 'triangle');
      }
      break;
    case 'tongs':
      air(0, 1950, 0.043, 0.195);
      tone(0.003, 1517, 0.087, 0.092);
      tone(0.056, 2268, 0.052, 0.051);
      break;
    case 'wipe':
      air(0, 1550, 0.17, 0.146);
      air(0.094, 840, 0.19, 0.118);
      break;
    case 'cardboard':
      air(0, 1512, 0.108, 0.18);
      air(0.075, 920, 0.095, 0.15);
      tone(0.10, 199, 0.050, 0.093, 105);
      break;
    case 'bake':
      air(0, 795, 0.146, 0.105);
      for (const [time, hz, gain] of [[0.01, 5200, 0.213], [0.052, 3000, 0.16], [0.11, 4200, 0.20],
        [0.17, 3200, 0.113], [0.202, 5200, 0.134], [0.274, 2680, 0.101]]) {
        air(time, hz, 0.063, gain, 'highpass');
      }
      break;
    case 'peel':
      air(0, 900, 0.179, 0.203);
      air(0.059, 1920, 0.110, 0.103);
      tone(0.135, 268, 0.098, 0.107, 166, 'triangle');
      break;
    case 'box':
      air(0, 1085, 0.138, 0.182);
      air(0.061, 2270, 0.076, 0.146);
      tone(0.061, 180, 0.092, 0.137, 95, 'triangle');
      break;
    case 'warmer':
      for (const [time, hz, strength] of [[0, 750, 0.078], [0.023, 2300, 0.205],
        [0.125, 1720, 0.156], [0.258, 3600, 0.12]]) air(time, hz, 0.073, strength);
      break;
    case 'start':
      tone(0, 622, 0.24, 0.129);
      tone(0.004, 1317, 0.188, 0.081);
      tone(0.010, 1843, 0.091, 0.043);
      tone(0.092, 933, 0.190, 0.059);
      air(0, 1300, 0.041, 0.108);
      break;
    case 'score':
    case 'finish': {
      const chord = cue === 'score' ? [392, 494, 587, 784] : [262, 330, 392, 523];
      for (const [i, hz] of chord.entries()) {
        const at = i * (cue === 'score' ? 0.038 : 0.086);
        tone(at, hz, cue === 'score' ? 0.224 : 0.39, 0.117 - i * 0.016, hz, 'triangle');
        tone(at + 0.002, hz * 2.003, 0.119, 0.021);
      }
      break;
    }
  }
}

export function renderKitchenFoley(): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, Math.round(sampleRate * FOLEY_SLOT * FOLEY_CUES.length), sampleRate);
  const noise = noiseBuffer(ctx);
  for (const [index, cue] of FOLEY_CUES.entries()) cookCue(ctx, noise, cue, index * FOLEY_SLOT);
  return ctx.startRendering();
}
