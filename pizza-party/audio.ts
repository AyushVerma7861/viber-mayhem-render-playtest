import { FOLEY_CUES, FOLEY_SLOT, renderKitchenFoley } from './foley.ts';
import type { FoleyCue } from './foley.ts';
import { renderPizzaMusic } from './music.ts';
import foleyAsset from './shared/assets/slice-shop-foley.flac?url';
import musicAsset from './shared/assets/slice-shop-music.mp3?url';

type AudioMode = 'menu' | 'round' | 'results' | 'rest';
type AudioLevel = 'music' | 'effects';
const level = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

function preferences() {
  const settings = { muted: false, music: 0.58, effects: 0.78 };
  try {
    settings.muted = localStorage.getItem('viber-pizza:muted') === '1';
    for (const name of ['music', 'effects'] as const) {
      const saved = localStorage.getItem('viber-pizza:' + name);
      if (saved !== null && Number.isFinite(Number(saved))) settings[name] = level(Number(saved));
    }
  } catch { /* Storage is optional for the offline launcher. */ }
  return settings;
}

async function loadSound(context: AudioContext, url: string, render: () => Promise<AudioBuffer>) {
  try {
    const response = await fetch(url);
    if (!response.ok) return render();
    return await context.decodeAudioData(await response.arrayBuffer());
  } catch {
    return render();
  }
}

export function createPizzaAudio() {
  const settings = preferences();
  let mode: AudioMode = 'rest';
  let context: AudioContext | undefined;
  let master: GainNode | undefined, music: GainNode | undefined, effects: GainNode | undefined;
  let foley: AudioBuffer | undefined, track: AudioBuffer | undefined;
  let source: AudioBufferSourceNode | undefined;
  let lastBump = -Infinity;
  let variant = 0;

  function updateMix() {
    if (!context || !master || !music || !effects) return;
    const now = context.currentTime;
    master.gain.setTargetAtTime(settings.muted ? 0 : 0.88, now, 0.024);
    const musicMix = mode === 'menu' ? 0.52 : mode === 'round' ? 0.45 : 0;
    music.gain.setTargetAtTime(settings.music * musicMix, now, 0.085);
    effects.gain.setTargetAtTime(mode === 'rest' ? 0 : settings.effects, now, 0.025);
    if (track && !source && context.state === 'running' && musicMix > 0 && !settings.muted) {
      source = context.createBufferSource();
      source.buffer = track;
      source.loop = true;
      source.connect(music);
      source.start();
    }
  }

  function unlock() {
    if (settings.muted) return;
    try {
      if (!context) {
        context = new AudioContext({ latencyHint: 'interactive' });
        master = context.createGain();
        music = context.createGain();
        effects = context.createGain();
        master.gain.value = 0;
        music.gain.value = 0;
        effects.gain.value = 0;
        const mix = context.createDynamicsCompressor();
        mix.threshold.value = -9;
        mix.knee.value = 12;
        mix.ratio.value = 6;
        mix.attack.value = 0.004;
        mix.release.value = 0.16;
        music.connect(master);
        effects.connect(master);
        master.connect(mix).connect(context.destination);
        context.addEventListener('statechange', updateMix);
        void loadSound(context, foleyAsset, renderKitchenFoley).then(buffer => { foley = buffer; }, () => {});
        void loadSound(context, musicAsset, renderPizzaMusic).then(buffer => { track = buffer; updateMix(); }, () => {});
        updateMix();
      }
      if (context.state !== 'running' && context.state !== 'closed') void context.resume().catch(() => {});
    } catch { /* Audio support is independent of play. */ }
  }

  function play(kind: FoleyCue, strength = 1, pan = 0) {
    const ctx = context, bus = effects;
    const volume = level(strength);
    if (!volume || mode === 'rest' || settings.muted || !settings.effects || !ctx || !bus ||
      !foley || ctx.state !== 'running') return;
    const now = ctx.currentTime + 0.005;
    if (kind === 'bump') {
      if (now - lastBump < 0.149) return;
      lastBump = now;
    }
    const hit = ctx.createBufferSource(), gain = ctx.createGain(), spatial = ctx.createStereoPanner();
    hit.buffer = foley;
    const pitched = kind !== 'score' && kind !== 'finish' && kind !== 'start';
    if (pitched) hit.playbackRate.value = 1 + [0, -0.047, 0.036, 0.066, -0.023][variant++ % 5];
    gain.gain.value = volume;
    spatial.pan.value = Math.max(-0.69, Math.min(0.69, pan));
    hit.connect(gain).connect(spatial).connect(bus);
    hit.onended = () => { hit.disconnect(); gain.disconnect(); spatial.disconnect(); };
    hit.start(now, FOLEY_CUES.indexOf(kind) * FOLEY_SLOT, FOLEY_SLOT - 0.014);
  }

  return {
    get muted() { return settings.muted; },
    unlock,
    play,
    getLevel(name: AudioLevel) { return settings[name]; },
    setLevel(name: AudioLevel, value: number) {
      settings[name] = level(value);
      try { localStorage.setItem('viber-pizza:' + name, String(settings[name])); } catch { /* Session setting. */ }
      updateMix();
    },
    setMode(value: AudioMode) {
      if (mode === value) return;
      mode = value;
      updateMix();
    },
    toggle() {
      settings.muted = !settings.muted;
      try { localStorage.setItem('viber-pizza:muted', settings.muted ? '1' : '0'); } catch { /* Session setting. */ }
      if (!settings.muted) unlock();
      updateMix();
    },
  };
}
