// Original, synthesized kitchen foley. No reference-game recordings are used.
export type CookerSound = 'receive' | 'pass' | 'trolley' | 'bump' | 'vent' | 'win';

const beatsPerCycle = 35;
const strikeSeconds = 0.12;
const trolleySecondStrike = 0.155;
const twoPi = Math.PI * 2;

function makeStrike(context: BaseAudioContext, beat: number): AudioBuffer {
  const pressure = beat / beatsPerCycle;
  const rate = context.sampleRate;
  const buffer = context.createBuffer(1, Math.round(rate * strikeSeconds), rate);
  const samples = buffer.getChannelData(0);
  const pitch = 1 + pressure * 0.36;
  const weight = 0.10 + pressure ** 1.6 * 0.103;
  const tapFilter = 1 - Math.exp(-twoPi * 1650 / rate);
  const bodyFilter = 1 - Math.exp(-twoPi * 310 / rate);
  let seed = 11903 + beat * 3571;
  let filtered = 0;
  let bass = 0;
  for (let i = 0; i < samples.length; i++) {
    const time = i / rate;
    const springMotion = 0.008 * (1 - Math.exp(-time * 85));
    const attack = Math.min(1, time / 0.0045);
    const closingFade = Math.min(1, (strikeSeconds - time) / 0.014);
    const body = 0.54 * Math.sin(twoPi * 306 * pitch * (time + springMotion)) * Math.exp(-time / 0.0195);
    const lid = 0.34 * Math.sin(twoPi * 659 * pitch * time + 0.65) * Math.exp(-time / 0.017);
    const rim = (0.115 + pressure * 0.10) * Math.sin(twoPi * 1093 * pitch * time + 1.1) * Math.exp(-time / 0.010);

    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    filtered += tapFilter * (seed / 2147483648 - 1 - filtered);
    bass += bodyFilter * (filtered - bass);
    const click = 0.27 * (filtered - bass) * Math.exp(-time / 0.008);
    const airTime = Math.max(0, time - 0.012);
    const airEnvelope = Math.min(1, airTime / 0.012) * Math.exp(-airTime / 0.014);
    const briefAir = Math.max(0, pressure - 0.56) * 0.55 * (filtered - bass) * airEnvelope;
    samples[i] = weight * (attack * (body + lid + rim + click) + briefAir) * closingFade;
  }

  if (beat === beatsPerCycle - 1) {
    // Mix the cap's rebound into the strike so pausing cannot leave a delayed note behind.
    const offset = Math.round(0.044 * rate);
    for (let i = samples.length - 1; i >= offset; i--) {
      const fade = Math.min(1, (samples.length - i) / (0.018 * rate));
      samples[i] += 0.38 * samples[Math.floor((i - offset) * 0.92)] * fade;
    }
  }
  return buffer;
}

function makeTrolleyBell(context: BaseAudioContext): AudioBuffer {
  const rate = context.sampleRate;
  const buffer = context.createBuffer(1, Math.round(rate * 0.49), rate);
  const data = buffer.getChannelData(0);
  // Two rounded notes with ringing tails distinguish the trolley from the dry cooker beat.
  for (const [at, pitch, level] of [[0, 587, 0.091], [trolleySecondStrike, 467, 0.076]]) {
    const start = Math.round(at * rate);
    for (let i = start; i < data.length; i++) {
      const age = (i - start) / rate;
      const attack = Math.min(1, age / 0.008);
      const body = Math.sin(twoPi * pitch * age) * Math.exp(-age / 0.089);
      const ring = 0.24 * Math.sin(twoPi * pitch * 2.03 * age + 0.2) * Math.exp(-age / 0.044);
      const rim = 0.09 * Math.sin(twoPi * pitch * 2.73 * age + 0.8) * Math.exp(-age / 0.023);
      const fade = Math.min(1, (data.length - i) / (0.045 * rate));
      data[i] += level * attack * fade * (body + ring + rim);
    }
  }
  return buffer;
}

export class CookerAudio {
  private readonly effectsBus: GainNode;
  private readonly warningBus: GainNode;
  private readonly noise: AudioBuffer;
  private readonly bell: AudioBuffer;
  private readonly strikes = new Map<number, AudioBuffer>();
  private enabled = true;
  private beat = 0;
  private duckWarningUntil = -Infinity;
  private lastStrike: { at: number; gain: GainNode } | null = null;

  constructor(private readonly context: BaseAudioContext, output: AudioNode = context.destination) {
    this.effectsBus = context.createGain();
    this.effectsBus.gain.value = 0.72;
    this.effectsBus.connect(output);
    this.warningBus = context.createGain();
    this.warningBus.connect(output);

    this.noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = this.noise.getChannelData(0);
    let state = 4217;
    for (let i = 0; i < data.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      data[i] = state / 2147483648 - 1;
    }
    this.bell = makeTrolleyBell(context);
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    const now = this.context.currentTime;
    this.effectsBus.gain.cancelScheduledValues(now);
    this.effectsBus.gain.setTargetAtTime(enabled ? 0.72 : 0, now, 0.012);
    this.warningBus.gain.cancelScheduledValues(now);
    this.warningBus.gain.setTargetAtTime(enabled ? 1 : 0, now, 0.008);
    if (!enabled) this.duckStrike(now, 0);
  }

  pressure(value: number, active: boolean, at = this.context.currentTime): void {
    if (!active) return;
    const beat = Math.min(beatsPerCycle - 1, Math.floor(value * beatsPerCycle + 1e-7));
    if (beat <= this.beat) return;
    this.beat = beat;
    if (!this.enabled) return;
    let buffer = this.strikes.get(beat);
    if (!buffer) {
      buffer = makeStrike(this.context, beat);
      this.strikes.set(beat, buffer);
    }
    const overlap = at < this.duckWarningUntil;
    this.lastStrike = { at, gain: this.playBuffer(buffer, at, overlap ? 0.54 : 1) };
  }

  private duckStrike(at: number, volume: number): void {
    const strike = this.lastStrike;
    if (!strike || at - strike.at >= strikeSeconds) return;
    strike.gain.gain.setTargetAtTime(volume, at, 0.008);
  }

  private playBuffer(buffer: AudioBuffer, at: number, volume: number): GainNode {
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    gain.gain.value = volume;
    source.connect(gain).connect(this.warningBus);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    source.start(at);
    return gain;
  }

  private puff(at: number, duration: number, gain: number, cutoff: number): void {
    const source = this.context.createBufferSource(); source.buffer = this.noise;
    const filter = this.context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = cutoff;
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(gain, at + 0.018);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter).connect(envelope).connect(this.effectsBus);
    source.onended = () => { source.disconnect(); filter.disconnect(); envelope.disconnect(); };
    source.start(at); source.stop(at + duration);
  }

  private clink(at: number, pitch: number, gain: number, duration = 0.12): void {
    for (const [multiple, strength] of [[1, 1], [2.76, 0.35], [4.07, 0.15]]) {
      const source = this.context.createOscillator(); source.type = 'sine'; source.frequency.value = pitch * multiple;
      const envelope = this.context.createGain(); envelope.gain.setValueAtTime(gain * strength, at);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
      source.connect(envelope).connect(this.effectsBus);
      source.onended = () => { source.disconnect(); envelope.disconnect(); };
      source.start(at); source.stop(at + duration);
    }
  }

  play(kind: CookerSound, at = this.context.currentTime): void {
    if (kind === 'receive') this.beat = 0;
    if (kind === 'vent' || kind === 'pass' || kind === 'trolley' || kind === 'bump') {
      const duration = kind === 'trolley' ? trolleySecondStrike + 0.080 : 0.10;
      this.duckWarningUntil = Math.max(this.duckWarningUntil, at + duration);
      this.duckStrike(at, kind === 'vent' ? 0 : 0.54);
    }
    if (!this.enabled) return;
    if (kind === 'vent') {
      this.puff(at, 1.15, 0.38, 4200); this.puff(at + 0.06, 0.55, 0.16, 1000);
      this.clink(at, 270, 0.07, 0.16);
    } else if (kind === 'pass' || kind === 'receive') {
      this.clink(at, kind === 'pass' ? 430 : 310, 0.055, 0.09);
      this.puff(at, 0.16, 0.055, 650);
    } else if (kind === 'trolley') {
      this.playBuffer(this.bell, at, 1);
    } else if (kind === 'bump') {
      this.puff(at, 0.12, 0.13, 440); this.clink(at, 180, 0.035, 0.07);
    } else {
      [510, 640, 760].forEach((pitch, i) => this.clink(at + i * 0.12, pitch, 0.045, 0.22));
    }
  }
}
