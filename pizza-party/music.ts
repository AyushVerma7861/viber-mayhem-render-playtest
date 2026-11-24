const SAMPLE_RATE = 32000;
const tempo = 112;
const beat = 60 / tempo;
const bars = 16;
const pitch = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

type Note = readonly [step: number, midi: number, length: number, velocity?: number];
const melody: readonly Note[][] = [
  [[1, 67, 1.35], [4, 69, 1.3], [7, 72, 2.5], [11, 76, 2.0], [14, 74, 1.15]],
  [[2, 72, 1.7], [5, 69, 1.2], [8, 67, 2.9], [13, 64, 1.25]],
  [[1, 65, 1.4], [4, 69, 1.5], [8, 72, 2.35], [12, 74, 1.65]],
  [[0, 71, 2.1], [5, 69, 1.4], [8, 67, 2.85], [13, 62, 1.5]],
  [[1, 67, 1.3], [4, 69, 1.4], [7, 72, 2.35], [11, 76, 2.0], [14, 79, 1.0]],
  [[2, 77, 1.5], [5, 76, 1.35], [8, 72, 1.95], [11, 69, 2.5]],
  [[0, 74, 2.0], [4, 76, 1.7], [7, 77, 1.3], [10, 76, 1.6], [14, 72, 1.2]],
  [[2, 71, 1.25], [5, 67, 2.1], [10, 64, 2.7]],
];

const chords = [
  { root: 36, notes: [55, 59, 62, 64], lift: 43 },  // Cmaj9
  { root: 33, notes: [55, 57, 60, 64], lift: 40 },  // Am7
  { root: 38, notes: [53, 57, 60, 64], lift: 45 },  // Dm9
  { root: 43, notes: [53, 55, 59, 64], lift: 38 },  // G13
  { root: 36, notes: [55, 59, 62, 64], lift: 43 },
  { root: 41, notes: [52, 55, 57, 60], lift: 36 },  // Fmaj9
  { root: 38, notes: [53, 57, 60, 64], lift: 45 },
  { root: 43, notes: [53, 57, 59, 64], lift: 38 },
] as const;

function decay(ctx: BaseAudioContext, bus: AudioNode, at: number, length: number, amount: number, attack = 0.006) {
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0.0001, at);
  envelope.gain.linearRampToValueAtTime(amount, at + attack);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + length);
  envelope.connect(bus);
  return envelope;
}

function voice(ctx: BaseAudioContext, bus: AudioNode, wave: OscillatorType | { harmonics: PeriodicWave },
  at: number, hz: number, length: number, amount: number, attack?: number) {
  const oscillator = ctx.createOscillator();
  if (typeof wave === 'string') oscillator.type = wave;
  else oscillator.setPeriodicWave(wave.harmonics);
  oscillator.frequency.value = hz;
  oscillator.connect(decay(ctx, bus, at, length, amount, attack));
  oscillator.start(at);
  oscillator.stop(at + length + 0.012);
}

export function noiseBuffer(ctx: BaseAudioContext, duration = 0.46) {
  const buffer = ctx.createBuffer(1, Math.ceil(duration * ctx.sampleRate), ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  let state = 0x91e10da5;
  for (let i = 0; i < samples.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    samples[i] = state / 0x80000000 - 1;
  }
  return buffer;
}

export function noiseHit(ctx: BaseAudioContext, bus: AudioNode, noise: AudioBuffer,
  at: number, hz: number, length: number, amount: number, type: BiquadFilterType = 'bandpass') {
  const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter();
  source.buffer = noise;
  filter.type = type;
  filter.frequency.value = hz;
  filter.Q.value = 0.8;
  source.connect(filter).connect(decay(ctx, bus, at, length, amount, 0.003));
  source.start(at);
  source.stop(at + length + 0.008);
}

function stereo(ctx: BaseAudioContext, bus: AudioNode, pan: number) {
  const channel = ctx.createStereoPanner();
  channel.pan.value = pan;
  channel.connect(bus);
  return channel;
}

function kick(ctx: BaseAudioContext, bus: AudioNode, at: number, velocity: number) {
  const low = ctx.createOscillator();
  low.frequency.setValueAtTime(116, at);
  low.frequency.exponentialRampToValueAtTime(48, at + 0.080);
  low.connect(decay(ctx, bus, at, 0.21, 0.25 * velocity, 0.002));
  low.start(at);
  low.stop(at + 0.22);
}

export async function renderPizzaMusic(): Promise<AudioBuffer> {
  const seconds = bars * 4 * beat;
  const ctx = new OfflineAudioContext(2, Math.round(seconds * SAMPLE_RATE), SAMPLE_RATE);
  const mix = ctx.createGain();
  mix.gain.value = 1.83;
  mix.connect(ctx.destination);
  const bass = { harmonics: ctx.createPeriodicWave(new Float32Array(5), Float32Array.of(0, 1, 0.24, 0.15, 0.06)) };
  const guitar = { harmonics: ctx.createPeriodicWave(new Float32Array(7), Float32Array.of(0, 1, 0.53, 0.29, 0.13, 0.10, 0.052)) };
  const keys = { harmonics: ctx.createPeriodicWave(new Float32Array(5), Float32Array.of(0, 1, 0.22, 0.13, 0.038)) };
  const noise = noiseBuffer(ctx);
  const left = stereo(ctx, mix, -0.27), right = stereo(ctx, mix, 0.25);
  const lead = stereo(ctx, mix, 0.13), kit = stereo(ctx, mix, -0.12);
  for (let bar = 0; bar < bars; bar++) {
    const chord = chords[bar % chords.length], reply = bar >= bars / 2;
    const time = (step: number) => (bar * 16 + step + (step % 2 === 1 ? 0.15 : 0)) * beat / 4;
    const next = chords[(bar + 1) % chords.length];
    for (const [step, note, dur, strength] of [
      [0, chord.root, 0.70, 1], [3, chord.root + 12, 0.35, 0.61], [6, chord.lift, 0.43, 0.82],
      [8, chord.root, 0.68, 0.94], [11, chord.root + 12, 0.34, 0.61], [14, next.root + 2, 0.38, 0.78],
    ]) {
      voice(ctx, mix, bass, time(step), pitch(note), dur * beat, strength * 0.145);
    }
    for (const step of [2, 6, 10, 13]) {
      chord.notes.forEach((note, index) => {
        voice(ctx, index % 2 ? right : left, guitar, time(step) + index * 0.009, pitch(note),
          beat * (step === 13 ? 0.21 : 0.34), (step === 6 ? 0.037 : 0.026) * (1 - index * 0.07));
      });
    }
    const notes = melody[bar % melody.length];
    for (const [step, note, length, velocity = 1] of notes) {
      const at = time(step);
      const actual = note + (reply && (bar === 11 || bar === 15) && step >= 8 ? 12 : 0);
      voice(ctx, lead, keys, at, pitch(actual), beat * length / 3.4, 0.062 * velocity, 0.009);
      voice(ctx, left, 'sine', at + 0.042, pitch(actual + 12), beat * length / 4.4, 0.014 * velocity);
    }
    for (const step of [0, 8, ...(bar % 2 ? [11] : [6])]) kick(ctx, mix, time(step), step === 0 ? 1 : 0.68);
    for (const step of [4, 12]) {
      noiseHit(ctx, kit, noise, time(step), 1640, 0.094, 0.115);
      voice(ctx, kit, 'triangle', time(step), step === 4 ? 303 : 284, 0.037, 0.105, 0.002);
    }
    for (const step of [0, 2, 4, 6, 8, 10, 12, 14, ...(reply ? [7, 15] : [])]) {
      noiseHit(ctx, step % 4 === 0 ? right : left, noise, time(step), 5600,
        step === 14 ? 0.098 : 0.060, step % 4 === 2 ? 0.065 : 0.040, 'highpass');
    }
  }
  const track = await ctx.startRendering();
  const fade = Math.round(track.sampleRate * 0.011);
  for (let channel = 0; channel < track.numberOfChannels; channel++) {
    const samples = track.getChannelData(channel);
    for (let i = 0; i < fade; i++) {
      samples[i] *= i / fade;
      samples[samples.length - 1 - i] *= i / fade;
    }
  }
  return track;
}
