type Voice = 'bass' | 'keys' | 'mallet' | 'kick' | 'rim' | 'brush';

const rate = 24000;
const secondsPerBeat = 60 / 112;
const turn = 2 * Math.PI;
const duration: Record<Voice, number> = { bass: .37, keys: .52, mallet: .36, kick: .22, rim: .13, brush: .085 };
const score = [
  { root: 38, chord: [53, 57, 60, 64], melody: [[.54, 69], [1.28, 72], [2.01, 76], [3.12, 74]] },
  { root: 43, chord: [53, 57, 59, 64], melody: [[.26, 72], [1.52, 69], [2.56, 67], [3.52, 65]] },
  { root: 36, chord: [52, 55, 59, 62], melody: [[.04, 64], [1.54, 67], [2.28, 71], [3.06, 72]] },
  { root: 45, chord: [55, 61, 64, 69], melody: [[.56, 69], [1.32, 67], [2.06, 64]] },
  { root: 38, chord: [53, 57, 60, 64], melody: [[.54, 69], [1.28, 72], [2.01, 76], [3.12, 77]] },
  { root: 43, chord: [53, 57, 59, 64], melody: [[.04, 76], [1.52, 72], [2.52, 71], [3.3, 69]] },
  { root: 36, chord: [52, 55, 59, 62], melody: [[.04, 67], [.78, 64], [2.04, 62], [3.06, 64]] },
  { root: 36, chord: [52, 55, 58, 62], melody: [[.52, 67], [1.54, 70], [2.82, 72]] },
  { root: 41, chord: [52, 57, 60, 65], melody: [[.05, 77], [.8, 76], [1.54, 72], [2.7, 69]] },
  { root: 41, chord: [50, 56, 60, 65], melody: [[.26, 68], [1.56, 72], [2.14, 74], [3.52, 72]] },
  { root: 40, chord: [52, 55, 59, 62], melody: [[.04, 71], [.82, 67], [2.08, 64], [2.82, 67]] },
  { root: 45, chord: [55, 61, 64, 69], melody: [[.54, 69], [1.52, 73], [2.04, 76]] },
  { root: 38, chord: [53, 57, 60, 64], melody: [[.54, 69], [1.28, 72], [2.01, 76], [3.12, 74]] },
  { root: 43, chord: [53, 57, 59, 64], melody: [[.26, 72], [1.52, 71], [2.56, 69], [3.52, 67]] },
  { root: 36, chord: [52, 55, 59, 62], melody: [[.04, 64], [1.54, 67], [2.28, 62], [3.06, 60]] },
  { root: 43, chord: [53, 57, 59, 64], melody: [[.04, 62], [1.54, 65], [2.82, 67]] },
];

function renderVoice(voice: Voice, pitch: number): Float32Array {
  const length = duration[voice];
  const samples = new Float32Array(Math.round(rate * length));
  const frequency = 440 * 2 ** ((pitch - 69) / 12);
  let seed = 7207;
  let filtered = 0;
  for (let sample = 0; sample < samples.length; sample++) {
    const age = sample / rate;
    const phase = turn * frequency * age;
    const attack = Math.min(1, age / (voice === 'keys' ? .016 : .005));
    const release = Math.min(1, (length - age) / .035);
    let signal: number;
    switch (voice) {
      case 'bass':
        signal = (.66 * Math.sin(phase) + .25 * Math.sin(phase * 2) + .09 * Math.sin(phase * 3)) * Math.exp(-age * 7);
        break;
      case 'keys':
        signal = Math.sin(phase + .58 * Math.sin(phase * 2.01) * Math.exp(-age * 12)) * Math.exp(-age * 5.5);
        break;
      case 'mallet':
        signal = .77 * Math.sin(phase) * Math.exp(-age * 9) +
          .17 * Math.sin(phase * 2.013) * Math.exp(-age * 20) +
          .06 * Math.sin(phase * 3.97) * Math.exp(-age * 44);
        break;
      case 'kick':
        signal = Math.sin(turn * (49 * age + 1.28 * (1 - Math.exp(-age * 36)))) * Math.exp(-age * 19);
        break;
      case 'rim':
      case 'brush': {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const noise = seed / 2147483648 - 1;
        filtered += .19 * (noise - filtered);
        signal = voice === 'rim'
          ? (.58 * Math.sin(turn * 228 * age) + .60 * filtered) * Math.exp(-age * 42)
          : (noise - filtered) * Math.exp(-age * 44);
        break;
      }
    }
    samples[sample] = signal * attack * release;
  }
  return samples;
}

function renderLoop(context: BaseAudioContext): AudioBuffer {
  const frames = Math.round(score.length * 4 * secondsPerBeat * rate);
  const buffer = context.createBuffer(2, frames, rate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const voices = new Map<string, Float32Array>();

  function mix(voice: Voice, pitch: number, beat: number, volume: number, pan = 0): void {
    const key = voice + ':' + pitch;
    let samples = voices.get(key);
    if (!samples) {
      samples = renderVoice(voice, pitch);
      voices.set(key, samples);
    }
    let frame = Math.round(beat * secondsPerBeat * rate) % frames;
    const leftVolume = volume * (1 - pan);
    const rightVolume = volume * (1 + pan);
    for (const sample of samples) {
      left[frame] += sample * leftVolume;
      right[frame] += sample * rightVolume;
      if (++frame === frames) frame = 0;
    }
  }

  score.forEach(({ root, chord, melody }, bar) => {
    const beat = bar * 4;
    mix('bass', root, beat, .21);
    mix('bass', root + 12, beat + 1.48, .14);
    mix('bass', root + 7, beat + 2.55, .17);
    mix('bass', score[(bar + 1) % score.length].root, beat + 3.55, .10);
    chord.forEach((note, index) => {
      const pan = (index - 1.5) * .24;
      mix('keys', note, beat + .04 + index * .009, .070, pan);
      mix('keys', note, beat + 1.75 + index * .013, .057, pan);
      mix('keys', note, beat + 3.06 + index * .009, .052, pan);
    });
    melody.forEach(([at, note], index) => {
      mix('mallet', note, beat + at, index ? .13 : .17, .18);
      mix('mallet', note, beat + at + .36, .029, -.36);
    });
    mix('kick', 0, beat, .22);
    mix('kick', 0, beat + (bar % 2 ? 2.55 : 2), .17);
    mix('rim', 0, beat + 1.04, .16, -.16);
    mix('rim', 0, beat + 3.03, .16, -.16);
    for (const at of [.56, 1.56, 2.56, 3.56]) mix('brush', 0, beat + at, .13, .31);
  });
  return buffer;
}

export class PartyAudio {
  private readonly music: GainNode;
  private readonly warmth: BiquadFilterNode;
  private lobbyVolume = 0;
  private buffer: AudioBuffer | undefined;
  private source: AudioBufferSourceNode | undefined;
  private startQueued = false;
  private stopTimer: number | undefined;

  constructor(private readonly context: AudioContext, private readonly effectsOutput: AudioNode) {
    this.music = context.createGain();
    this.music.gain.value = 0;
    this.warmth = context.createBiquadFilter();
    this.warmth.type = 'lowpass';
    this.warmth.frequency.value = 2300;
    this.warmth.Q.value = .2;
    this.warmth.connect(this.music).connect(context.destination);
  }

  setLobbyVolume(volume: number): void {
    if (this.lobbyVolume === volume) return;
    this.lobbyVolume = volume;
    window.clearTimeout(this.stopTimer);
    this.music.gain.setTargetAtTime(.34 * volume, this.context.currentTime, .025);
    if (!volume) {
      if (this.source) this.stopTimer = window.setTimeout(() => {
        const source = this.source;
        this.source = undefined;
        source?.stop();
      }, 140);
      return;
    }
    if (this.source || this.startQueued) return;
    this.startQueued = true;
    window.setTimeout(() => {
      this.startQueued = false;
      if (!this.lobbyVolume) return;
      const source = this.context.createBufferSource();
      this.buffer ??= renderLoop(this.context);
      source.buffer = this.buffer;
      source.loop = true;
      source.connect(this.warmth);
      source.onended = () => source.disconnect();
      source.start();
      this.source = source;
    }, 0);
  }

  playMenu(selected: boolean): void {
    if (this.context.state !== 'running') return;
    const now = this.context.currentTime;
    const note = this.context.createOscillator();
    const envelope = this.context.createGain();
    note.type = selected ? 'sine' : 'triangle';
    note.frequency.setValueAtTime(selected ? 410 : 237, now);
    note.frequency.exponentialRampToValueAtTime(selected ? 551 : 155, now + .045);
    envelope.gain.setValueAtTime(.0001, now);
    envelope.gain.exponentialRampToValueAtTime(selected ? .045 : .052, now + .008);
    envelope.gain.exponentialRampToValueAtTime(.0001, now + .10);
    note.connect(envelope).connect(this.effectsOutput);
    note.onended = () => { note.disconnect(); envelope.disconnect(); };
    note.start(now);
    note.stop(now + .10);
  }
}
