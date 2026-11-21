import './style.css';
import { planFrame } from './frame-clock.ts';
import { createGameFullscreen } from './game-fullscreen.ts';
import { CookerAudio } from './cooker-audio.ts';
import { COOKER_ICON, makeCookerPanel } from './cooker-feedback.ts';
import { createHub, readHubPreferences, saveHubPreference } from './hub.ts';
import type { AudioChannel } from './hub.ts';
import { createOnlineRooms, onlineEnabled } from './online-rooms.ts';
import { OnlineMovement } from './online-movement.ts';
import type { RoomView, Snapshot } from './online-protocol.ts';
import { PartyAudio } from './party-audio.ts';
import { createPingIndicator, previewPing } from './ping-indicator.ts';
import { KITCHEN_ARENA } from './arena.ts';
import { CAST, FUSE_TICKS, HZ, Match, OFFLINE_SEAT, STEP } from './simulation.ts';
import type { MatchView, Vec } from './simulation.ts';
import { YardView } from './scene.ts';
import { VIBERS, viberParty } from './vibers.ts';
import kitchenCover from './assets/let-them-cook-cover.webp';

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const shell = element('shell');
const stage = element('stage');
const canvas = element<HTMLCanvasElement>('arena');
const overlay = element('overlay');
const primary = element<HTMLButtonElement>('primary');
const pauseButton = element<HTMLButtonElement>('pause');
const restartButton = element<HTMLButtonElement>('restart');
const backToHubButton = element<HTMLButtonElement>('back-to-hub');
const onlineRoomButton = element<HTMLButtonElement>('online-room-button');
const onlinePing = element('online-ping');
const showPing = createPingIndicator(onlinePing);
const onlineConnection = element('online-connection');
const onlineSpectator = element('online-spectator');
const onlineRematch = element('online-rematch');
const soundButton = element<HTMLButtonElement>('sound');
const fullscreenButton = element<HTMLButtonElement>('fullscreen');
const landscapePrompt = element<HTMLDialogElement>('landscape-prompt');
const landscapeBack = element<HTMLButtonElement>('landscape-back');
const landscapeFullscreen = element<HTMLButtonElement>('landscape-fullscreen');
const landscapeNotice = element('landscape-notice');
const clock = element('clock');
const fuse = element('fuse');
const fuseLabel = element('fuse-label');
const fill = element('fill');
const countdown = element('countdown');
const notice = element('notice');
const touch = element('touch');
const stick = element('stick');
const thumb = element('thumb');
const track = [element('track-0'), element('track-1')];
const picker = element('viber-picker');
const debug = element('debug');
const query = new URLSearchParams(location.search);
const seedQuery = Number(query.get('seed'));
const fixedSeed = query.has('seed') && Number.isSafeInteger(seedQuery);
const newSeed = () => fixedSeed ? seedQuery >>> 0 : crypto.getRandomValues(new Uint32Array(1))[0];
const kitchen = shell.dataset.arena === 'kitchen' && query.get('arena') !== 'freight';
shell.dataset.arena = kitchen ? 'kitchen' : 'freight';
const usesHub = kitchen && shell.dataset.entry !== 'arena';
let inHub = usesHub;
let pingPreviewAt: number | undefined;
shell.hidden = usesHub;
const preferences = usesHub ? readHubPreferences() : undefined;
const routeTest = !kitchen && (shell.dataset.chasePolicy === 'clear-route' || query.get('chase') === 'route');
const movementProfile = kitchen && shell.dataset.movement === 'responsive' ? 'responsive' : 'classic';
const match = new Match(newSeed(), routeTest ? 'clear-route' : 'nearest', kitchen ? KITCHEN_ARENA : undefined, movementProfile);
if (routeTest) document.title = 'Freight Tag · Route Test';
const gameTitle = kitchen ? 'Let Them Cook' : 'Freight Tag';
const trackNames = kitchen ? ['Serve', 'Return'] : ['Eastbound', 'Westbound'];
const pickerOptions = element('viber-options');
let selected = preferences?.viber ?? VIBERS[0];
let cast: readonly { name: string; color: string; role: string; portrait?: string }[] = CAST;
const cookerPanel = kitchen ? makeCookerPanel(fuse) : undefined;
if (kitchen) {
  document.title = 'Let Them Cook · Viber Mayhem';
  for (const selector of ['.brand', '.title-row', '.sidebar', '.controls']) {
    shell.querySelector(selector)?.remove();
  }
  shell.querySelector('.topbar')?.setAttribute('aria-label', 'Match controls');
  soundButton.title = 'Toggle sound';
  fullscreenButton.title = 'Toggle fullscreen';
  pauseButton.title = 'Pause or resume';
  stage.setAttribute('aria-label', 'Let Them Cook arena');
  canvas.setAttribute('aria-label', '3D Viber test kitchen');
  fuse.setAttribute('aria-label', 'Cooker pressure');
  fuse.setAttribute('role', 'progressbar');
  fuse.setAttribute('aria-valuemin', '0');
  fuse.setAttribute('aria-valuemax', '100');
  track.forEach((signal, lane) => { signal.querySelector('b')!.textContent = trackNames[lane].toUpperCase(); });
}
const coarse = matchMedia('(any-pointer: coarse)');
const portrait = matchMedia('(orientation: portrait)');
const hasTouch = () => coarse.matches || navigator.maxTouchPoints > 0;
const needsLandscape = () => kitchen && portrait.matches && hasTouch();
let paused = false;
let pausedForLandscape = false;
let landscapeDuringPlay = false;
let pauseReason = '';
let graphicsMessage = '';
let previousFrame = performance.now();
let arenaFrame = 0;
let accumulated = 0;
let resultAt = -Infinity;
let noticeEnd = 0;
let lastTickSound = -1;
let displayedClock = '';
let lastOverlay: string | undefined;
let debugAt = 0;
let frames = 0;
let slowerFrames = 0;
const totals = { pass: 0, hit: 0, blast: 0, horn: 0 };
debug.hidden = !query.has('debug');

const aliveCount = kitchen ? undefined : element('alive');
const rows = kitchen ? [] : CAST.map(() => {
  const row = document.createElement('li');
  row.innerHTML = '<span class="chevron" aria-hidden="true"><i></i></span><strong></strong><span class="role"></span><span class="player-state"></span>';
  element('roster').append(row);
  return row;
});

const markers = CAST.map(() => {
  const marker = document.createElement('div');
  marker.className = 'marker';
  marker.innerHTML = '<b hidden>' + (kitchen ? COOKER_ICON : '◆') + '</b><span></span><em hidden></em>';
  element('markers').append(marker);
  return {
    marker, core: marker.querySelector('b') as HTMLElement, stun: marker.querySelector('em') as HTMLElement,
  };
});

let yard: YardView | undefined;
let hub: ReturnType<typeof createHub> | undefined;
let online: ReturnType<typeof createOnlineRooms> | undefined;
let networkFrame: { round: number; view: MatchView; time: number; span: number; gapMs: number } | undefined;
const onlineMovement = new OnlineMovement();
let onlineConnectionMessage = '';
function openArena(): void {
  if (yard) return;
  try {
    yard = new YardView(stage, canvas, kitchen, kitchen && query.get('quality') === 'high');
    graphicsMessage = '';
  } catch (error) {
    console.error(error);
    graphicsMessage = 'Open ' + gameTitle + ' in a browser with WebGL 2 and graphics acceleration enabled.';
  }
}
if (!usesHub) openArena();

function applyCast(): void {
  if (kitchen) {
    const arranged = viberParty(selected);
    cast = arranged.map((viber, i) => ({ ...viber, role: i ? 'Bot' : 'You' }));
    yard?.setVibers(arranged);
  }
  cast.forEach((viber, i) => {
    const row = rows[i];
    if (row) {
      row.style.setProperty('--courier', viber.color);
      row.querySelector('strong')!.textContent = viber.name;
      row.querySelector('.role')!.textContent = viber.role;
    }
    const marker = markers[i].marker;
    marker.style.setProperty('--courier', viber.color);
    marker.querySelector('span')!.textContent = i === OFFLINE_SEAT ? 'YOU' : viber.name.toUpperCase();
  });
}

function applyOnlineCast(room: RoomView): void {
  const roster = room.seats.map(seat => VIBERS[seat.viber]);
  cast = roster.map((viber, index) => ({ ...viber, role: index === room.you ? 'You' : 'Guest' }));
  yard?.setVibers(roster);
  for (const [index, { marker }] of markers.entries()) {
    marker.style.setProperty('--courier', roster[index].color);
    marker.querySelector('span')!.textContent = index === room.you ? 'YOU' : roster[index].name.toUpperCase();
  }
}

if (kitchen && !usesHub) {
  for (const viber of VIBERS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(viber === selected));
    const portrait = document.createElement('img');
    portrait.src = viber.portrait;
    portrait.alt = '';
    const name = document.createElement('span');
    name.textContent = viber.name;
    button.append(portrait, name);
    button.addEventListener('click', () => {
      selected = viber;
      for (const candidate of pickerOptions.children) {
        candidate.setAttribute('aria-pressed', String(candidate === button));
      }
      if (match.phase === 'lobby') applyCast();
    });
    pickerOptions.append(button);
  }
}
applyCast();

const movement: Record<string, Vec> = {
  KeyW: { x: 0, z: -1 }, ArrowUp: { x: 0, z: -1 },
  KeyS: { x: 0, z: 1 }, ArrowDown: { x: 0, z: 1 },
  KeyA: { x: -1, z: 0 }, ArrowLeft: { x: -1, z: 0 },
  KeyD: { x: 1, z: 0 }, ArrowRight: { x: 1, z: 0 },
};
const held = new Set<string>();
let finger: { id: number; x: number; y: number } | null = null;
let touchDirection: Vec = { x: 0, z: 0 };

function clearTouch(): void {
  const id = finger?.id;
  finger = null;
  if (id !== undefined && touch.hasPointerCapture(id)) touch.releasePointerCapture(id);
  touchDirection = { x: 0, z: 0 };
  stick.style.removeProperty('left');
  stick.style.removeProperty('top');
  thumb.style.removeProperty('transform');
}

function clearInput(): void {
  held.clear();
  clearTouch();
}

function input(): Vec {
  if (finger) return touchDirection;
  const axis = { x: 0, z: 0 };
  for (const key of held) {
    axis.x += movement[key].x;
    axis.z += movement[key].z;
  }
  return { x: Math.sign(axis.x), z: Math.sign(axis.z) };
}

touch.addEventListener('pointerdown', event => {
  if (needsLandscape() || finger || event.pointerType === 'mouse') return;
  if (networkFrame) unlockAudio();
  event.preventDefault();
  const rect = touch.getBoundingClientRect();
  finger = { id: event.pointerId, x: event.clientX, y: event.clientY };
  touch.setPointerCapture(event.pointerId);
  stick.style.left = Math.max(44, event.clientX - rect.left) + 'px';
  stick.style.top = Math.min(rect.height - 44, Math.max(44, event.clientY - rect.top)) + 'px';
});
touch.addEventListener('pointermove', event => {
  if (event.pointerId !== finger?.id) return;
  const x = event.clientX - finger.x;
  const z = event.clientY - finger.y;
  const length = Math.hypot(x, z);
  const strength = Math.max(0, Math.min(1, (length / 45 - 0.14) / 0.86)) / (length || 1);
  touchDirection = { x: x * strength, z: z * strength };
  thumb.style.transform = 'translate(' + touchDirection.x * 29 + 'px,' + touchDirection.z * 29 + 'px)';
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  touch.addEventListener(event, pointer => { if (pointer.pointerId === finger?.id) clearTouch(); });
}

let audio: AudioContext | undefined;
let effectsOutput: GainNode | undefined;
let cookerAudio: CookerAudio | undefined;
let partyAudio: PartyAudio | undefined;
let effectsVolume = preferences?.effectsVolume ?? 100;
let musicVolume = preferences?.musicVolume ?? 100;
let lastEffectsVolume = effectsVolume || 100;
let appliedEffectsGain = 0;

function unlockAudio(): void {
  if (document.hidden || !effectsVolume && !(hub?.showing && musicVolume)) return;
  const Context = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return;
  if (!audio) {
    try { audio = new Context(); } catch { return; }
    effectsOutput = audio.createGain();
    effectsOutput.gain.value = 0;
    effectsOutput.connect(audio.destination);
    audio.addEventListener('statechange', syncAudioMix);
    if (kitchen) {
      cookerAudio = new CookerAudio(audio, effectsOutput);
      if (usesHub) partyAudio = new PartyAudio(audio, effectsOutput);
    }
  }
  if (audio.state !== 'running') void audio.resume().catch(() => {});
  syncAudioMix();
}

function syncAudioMix(): void {
  if (!audio || !effectsOutput) return;
  const audible = audio.state === 'running' && !document.hidden;
  const gain = audible ? effectsVolume / 100 : 0;
  if (gain !== appliedEffectsGain) {
    appliedEffectsGain = gain;
    effectsOutput.gain.setTargetAtTime(gain, audio.currentTime, .012);
  }
  cookerAudio?.setEnabled(!!gain && !inHub && !paused && !needsLandscape() && !graphicsMessage);
  partyAudio?.setLobbyVolume(audible && hub?.showing && !landscapePrompt.open ? musicVolume / 100 : 0);
}

if (kitchen) {
  document.addEventListener('click', event => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    unlockAudio();
    const button = event.target.closest('button');
    if (effectsVolume && button?.closest('#mayhem-hub, .online-room, #landscape-prompt') && !button.matches(':disabled')) {
      partyAudio?.playMenu(button.matches('[data-cycle], [data-online-viber], .hub-seats button, .hub-viber-options button'));
    }
  }, true);
  window.addEventListener('keydown', event => {
    if (event.isTrusted && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey) unlockAudio();
  }, true);
  // Touch movement captures the pointer without generating a regular click.
  touch.addEventListener('pointerup', event => { if (event.isTrusted) unlockAudio(); });
}

function tone(from: number, to: number, duration: number, volume: number, type: OscillatorType,
  delay = 0): void {
  if (!effectsVolume || !effectsOutput || audio?.state !== 'running') return;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const start = audio.currentTime + delay;
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, start);
  oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(effectsOutput);
  oscillator.start(start);
  oscillator.stop(start + duration);
}

function announce(message: string, time: number, duration = 1300): void {
  notice.textContent = message;
  noticeEnd = time + duration;
}

function consumeEvents(view: MatchView, localSeat: number, time: number): void {
  for (const event of view.events) {
    switch (event.type) {
      case 'assign':
        if (kitchen) cookerAudio?.play('receive');
        else tone(360, 720, 0.18, 0.08, 'triangle');
        lastTickSound = -1;
        break;
      case 'pass':
        totals.pass++;
        if (kitchen) cookerAudio?.play('pass');
        else {
          tone(920, 510, 0.12, 0.08, 'triangle');
          tone(540, 780, 0.12, 0.045, 'sine', 0.075);
        }
        break;
      case 'horn':
        totals.horn++;
        if (kitchen) cookerAudio?.play('trolley');
        else tone(event.lane ? 294 : 220, event.lane ? 260 : 200, 0.20, 0.045, 'triangle');
        break;
      case 'hit':
        totals.hit++;
        if (kitchen) cookerAudio?.play('bump');
        else tone(145, 64, 0.13, 0.09, 'triangle');
        if (event.player === localSeat) announce(kitchen ? 'Trolley hit · Stunned' : 'Cart hit · Stunned', time);
        break;
      case 'blast':
        totals.blast++;
        yard?.overload(view.players[event.player], time);
        if (kitchen) cookerAudio?.play('vent');
        else {
          tone(124, 24, 0.45, 0.14, 'sawtooth');
          tone(253, 42, 0.29, 0.07, 'triangle');
        }
        announce(kitchen ? event.player === localSeat ? 'You got steamed! Out this round.' : cast[event.player].name + ' got steamed!' :
          event.player === localSeat ? 'You were knocked out' : cast[event.player].name + ' is out', time, kitchen ? 2100 : 1300);
        if (event.player === localSeat) clearInput();
        break;
      case 'win':
        resultAt = time;
        if (kitchen) cookerAudio?.play('win');
        else [392, 494, 587].forEach((note, index) => tone(note, note * 1.006, 0.29, 0.07, 'triangle', 0.1 + index * 0.115));
        clearInput();
        break;
    }
  }
  if (!kitchen && view.holder !== null) {
    const pulse = Math.floor((FUSE_TICKS - view.remaining) / 18);
    if (pulse > 0 && pulse > lastTickSound) {
      const pitch = 370 + pulse * 16;
      tone(pitch, pitch * 0.82, 0.075, view.remaining < HZ * 3 ? 0.044 : 0.022, 'sine');
    }
    lastTickSound = pulse;
  }
}

function setPaused(value: boolean, reason = ''): void {
  if (inHub || networkFrame || (match.phase !== 'play' && match.phase !== 'ready')) return;
  if (!value && !canPlayInLandscape()) return;
  paused = value;
  pauseReason = value ? reason : '';
  syncAudioMix();
  accumulated = 0;
  clearInput();
  if (!paused) {
    primary.blur();
    previousFrame = performance.now();
  }
  updateInterface(match, OFFLINE_SEAT, performance.now());
}

function start(): void {
  if (graphicsMessage) return;
  activateMatch();
  if (!canPlayInLandscape()) return;
  match.start(match.phase === 'lobby' ? match.seed : newSeed());
  if (kitchen) applyCast();
  yard?.reset();
  paused = false;
  pauseReason = '';
  resultAt = -Infinity;
  accumulated = 0;
  previousFrame = performance.now();
  notice.textContent = '';
  totals.blast = totals.hit = totals.pass = totals.horn = 0;
  clearInput();
  primary.blur();
  restartButton.blur();
  syncAudioMix();
  updateInterface(match, OFFLINE_SEAT, previousFrame);
}

function playFromHub(pingPreview = false): void {
  activateMatch();
  if (!canPlayInLandscape()) return;
  pingPreviewAt = pingPreview ? performance.now() : undefined;
  onlinePing.toggleAttribute('data-preview', pingPreview);
  onlinePing.title = pingPreview ? 'Simulated network ping' : 'Round-trip time to the match server';
  networkFrame = undefined;
  inHub = false;
  hub?.hide();
  syncAudioMix();
  shell.hidden = false;
  document.title = 'Let Them Cook · Viber Mayhem';
  window.scrollTo(0, 0);
  openArena();
  arenaFrame = requestAnimationFrame(frame);
  if (graphicsMessage) {
    updateInterface(match, OFFLINE_SEAT, performance.now());
    return;
  }
  start();
  canvas.tabIndex = -1;
  canvas.focus({ preventScroll: true });
}

function returnToHub(): void {
  if (!hub) return;
  pingPreviewAt = undefined;
  pausedForLandscape = false;
  closeLandscapePrompt();
  inHub = true;
  cancelAnimationFrame(arenaFrame);
  clearInput();
  onlineMovement.reset();
  if (networkFrame) online?.sendInput({ x: 0, z: 0 }, performance.now());
  shell.hidden = true;
  document.title = 'Viber Mayhem';
  hub.show(true);
  syncAudioMix();
  window.scrollTo(0, 0);
}

function showOnlineRound(): void {
  const room = online?.state;
  if (!room || !networkFrame || networkFrame.round !== room.round) return;
  online?.close();
  const wasInHub = inHub;
  inHub = false;
  hub?.hide();
  shell.hidden = false;
  document.title = 'Let Them Cook · Online';
  openArena();
  applyOnlineCast(room);
  paused = false;
  resultAt = networkFrame.view.phase === 'result' ? performance.now() - 620 : -Infinity;
  lastOverlay = undefined;
  clearInput();
  onlineMovement.reset();
  if (wasInHub) arenaFrame = requestAnimationFrame(frame);
  canvas.tabIndex = -1;
  canvas.focus({ preventScroll: true });
  if (needsLandscape()) syncLandscape();
}

function showOnlineRoom(): void {
  if (!networkFrame || !online?.state) return;
  releaseControls();
  online.open();
}

function receiveSnapshot(snapshot: Snapshot): void {
  const room = online?.state;
  if (!room) return;
  const prior = networkFrame;
  const now = performance.now();
  const previous = prior?.round === snapshot.round ? prior.view : undefined;
  const view = snapshot.view;
  const gap = previous ? view.tick - previous.tick : 0;
  const blend = gap > 0 && gap <= 9;
  const renderView = {
    ...view,
    players: view.players.map(player => ({
      ...player, previous: blend ? previous!.players[player.id].position : player.position,
    })),
    carts: view.carts.map(cart => ({
      ...cart, previous: (blend ? previous!.carts.find(item => item.lane === cart.lane && item.start === cart.start)?.position : undefined)
        ?? cart.position,
    })),
  };
  networkFrame = {
    round: snapshot.round, view: renderView, time: now, span: Math.max(1, gap * 1000 / HZ),
    gapMs: previous && prior ? now - prior.time : 0,
  };
  if (prior?.round !== snapshot.round) {
    totals.blast = totals.hit = totals.pass = totals.horn = 0;
    notice.textContent = '';
    showOnlineRound();
  } else if (inHub) {
    showOnlineRound();
  }
  if (!inHub) {
    if (!document.hidden && online?.connected) onlineMovement.reconcile(snapshot, room.you, now);
    syncAudioMix();
    consumeEvents(view, room.you, now);
  }
  if (view.phase === 'result' && landscapeDuringPlay) closeLandscapePrompt();
}

const places = ['1st', '2nd', '3rd', '4th'];

function showKitchenResults(view: MatchView, localSeat: number, winner: number, title: HTMLElement, copy: HTMLElement): void {
  const finishers = view.players
    .filter(player => player.id !== winner)
    .sort((a, b) => b.eliminatedAt - a.eliminatedAt);
  const first = cast[winner];
  title.textContent = winner === localSeat ? 'You win!' : first.name + ' wins!';
  copy.textContent = winner === localSeat
    ? first.name + ' · 1st place'
    : 'You placed ' + places[finishers.findIndex(player => player.id === localSeat) + 1];
  element<HTMLImageElement>('result-portrait').src = first.portrait!;
  element('result-places').replaceChildren(...finishers.map((player, index) => {
    const item = document.createElement('li');
    item.toggleAttribute('data-you', player.id === localSeat);
    const rank = document.createElement('span');
    rank.textContent = places[index + 1];
    const name = document.createElement('strong');
    name.textContent = cast[player.id].name;
    item.append(rank, name);
    if (player.id === localSeat) {
      const you = document.createElement('small');
      you.textContent = 'You';
      item.append(you);
    }
    return item;
  }));
}

function updateOverlay(view: MatchView, localSeat: number, now: number): void {
  const state = graphicsMessage ? 'graphics' : paused ? 'pause' :
    view.phase === 'result' && now - resultAt >= 620 ? 'result' :
      view.phase === 'lobby' ? 'lobby' : '';
  overlay.hidden = state === '';
  if (state === lastOverlay) return;
  lastOverlay = state;
  const kitchenResults = kitchen && state === 'result';
  overlay.toggleAttribute('data-results', kitchenResults);
  element('result-winner').hidden = !kitchenResults;
  element('result-places').hidden = !kitchenResults;
  if (!state) return;
  const title = element('overlay-title');
  const copy = element('overlay-text');
  restartButton.hidden = state !== 'pause';
  picker.hidden = usesHub || !kitchen || (state !== 'lobby' && state !== 'result');
  backToHubButton.hidden = !usesHub || (state !== 'pause' && state !== 'result' && state !== 'graphics');
  backToHubButton.textContent = networkFrame ? 'Back to Room' : 'Back to Lobby';
  primary.disabled = state === 'graphics';
  if (state === 'graphics') {
    title.textContent = 'Graphics unavailable';
    copy.textContent = graphicsMessage;
  } else if (state === 'pause') {
    title.textContent = 'Match paused';
    copy.textContent = pauseReason || (kitchen ? 'The cooker and both trolleys are paused.' : 'The fuse and both tracks are paused.');
    primary.textContent = 'Resume';
  } else if (state === 'result') {
    const winner = view.winner!;
    if (kitchenResults) {
      showKitchenResults(view, localSeat, winner, title, copy);
      primary.textContent = 'Rematch';
      title.tabIndex = -1;
      title.setAttribute('aria-describedby', 'overlay-text');
      title.focus({ preventScroll: true });
    } else {
      title.textContent = winner === localSeat ? 'You won the yard!' : cast[winner].name + ' wins!';
      copy.textContent = 'Last courier standing.';
      primary.textContent = 'Play again →';
    }
  } else {
    title.textContent = kitchen ? gameTitle : 'Last courier standing';
    copy.textContent = kitchen ? 'Bump a rival to pass the cooker. Dodge the trolleys.' : 'Bump a rival to pass the core. Watch both tracks.';
    primary.textContent = kitchen ? 'Let’s cook' : 'Start match →';
  }
}

function updateInterface(view: MatchView, localSeat: number, now: number): void {
  const active = view.phase === 'ready' || view.phase === 'play';
  const activeOnline = !!networkFrame;
  const roomPanel = !!online?.showing;
  stage.dataset.phase = view.phase;
  stage.dataset.paused = String(paused);
  pauseButton.disabled = !active || !!graphicsMessage || activeOnline;
  pauseButton.hidden = activeOnline;
  onlineRoomButton.hidden = !activeOnline;
  onlinePing.hidden = !activeOnline && pingPreviewAt === undefined;
  if (!activeOnline && pingPreviewAt !== undefined) showPing(previewPing(now - pingPreviewAt));
  onlineSpectator.hidden = !activeOnline || view.phase !== 'play' || view.players[localSeat].alive;
  pauseButton.textContent = paused ? 'Resume' : 'Pause';
  pauseButton.setAttribute('aria-pressed', String(paused));
  touch.hidden = !hasTouch() || needsLandscape() || paused || view.phase !== 'play' || !view.players[localSeat].alive ||
    !!graphicsMessage || (activeOnline && (!online?.connected || roomPanel));
  stick.hidden = !coarse.matches && finger === null;
  updateOverlay(view, localSeat, now);
  const room = online?.state;
  const showRematch = activeOnline && !!room && view.phase === 'result' && !graphicsMessage;
  onlineRematch.hidden = !showRematch;
  if (showRematch && room && online) {
    const host = room.you === room.host;
    const ready = room.seats[room.you].ready;
    const wait = online.waitingFor(room);
    const status = onlineConnectionMessage || (host
      ? wait || 'Your party is ready for a rematch.'
      : ready ? 'You’re ready. Waiting for the host to start.' : 'Ready up to play again with this party.');
    const action = host ? 'Rematch' : ready ? 'Cancel ready' : 'Ready for rematch';
    if (onlineRematch.textContent !== status) onlineRematch.textContent = status;
    if (primary.textContent !== action) primary.textContent = action;
    primary.disabled = !online.connected || (host && !!wait);
  }
  const holder = view.holder;
  const shown = view.phase === 'lobby' || view.phase === 'ready' ? FUSE_TICKS : view.remaining;
  const seconds = shown ? (Math.ceil(shown * 10 / HZ) / 10).toFixed(1) : '—';
  if (seconds !== displayedClock) {
    clock.innerHTML = shown ? seconds + '<span>s</span>' : '—';
    displayedClock = seconds;
  }
  fuse.dataset.urgent = String(holder !== null && shown <= 3 * HZ);
  fuseLabel.textContent = holder === null ? kitchen ? 'Pass before the valve blows' : 'CORE FUSE'
    : holder === localSeat ? kitchen ? 'YOU’RE COOKING!' : 'YOU HAVE IT' : cast[holder].name.toUpperCase() + ' HAS IT';
  const pressure = holder === null ? 0 : 1 - shown / FUSE_TICKS;
  fill.style.transform = 'scaleX(' + (kitchen ? pressure : shown / FUSE_TICKS) + ')';
  cookerPanel?.update(shown, FUSE_TICKS, holder !== null, view.phase === 'lobby' || view.phase === 'ready');
  if (kitchen) fuse.setAttribute('aria-valuenow', String(Math.round(pressure * 100)));
  if (aliveCount) aliveCount.textContent = view.players.filter(player => player.alive).length + ' / 4';
  for (const player of view.players) {
    const core = holder === player.id;
    const locked = core && view.tick < view.passAt;
    const stun = player.stunnedUntil - view.tick;
    const row = rows[player.id];
    if (row) {
      const rowState = !player.alive ? 'Out' : view.winner === player.id ? 'Won'
        : core ? locked ? 'Hold' : 'Core' : stun > 0 ? 'Stun' : 'In';
      if (row.dataset.state !== rowState) {
        row.dataset.state = rowState;
        row.querySelector('.player-state')!.textContent = rowState;
      }
    }
    const label = markers[player.id];
    label.marker.hidden = !player.alive;
    if (!player.alive) continue;
    label.marker.dataset.core = String(core);
    label.marker.dataset.stun = String(stun > 0);
    label.core.hidden = !core;
    label.stun.hidden = stun <= 0 && !locked;
    if (stun > 0) label.stun.textContent = '✦ ' + (Math.ceil(stun / 6) / 10).toFixed(1);
    else if (locked) label.stun.textContent = kitchen ? 'GET A GRIP' : 'LOCK';
    yard?.project(player.id, label.marker);
  }
  for (const [lane, signal] of track.entries()) {
    const warning = view.phase === 'play' && view.lanes[lane]?.warned;
    const running = view.carts.some(cart => cart.lane === lane);
    signal.dataset.status = warning ? 'warning' : running ? 'active' : 'idle';
    const vehicle = kitchen ? ' trolley' : ' freight';
    signal.setAttribute('aria-label', trackNames[lane] + (warning ? vehicle + ' incoming' : running ? vehicle + ' active' : ' clear'));
  }
  const ready = !paused && view.phase === 'ready';
  const go = !paused && view.phase === 'play' && view.tick - view.playAt < 29;
  countdown.hidden = !(ready || go);
  countdown.textContent = ready ? String(Math.ceil((view.playAt - view.tick) / HZ)) : kitchen ? 'LET’S COOK!' : 'GO';
  if (now >= noticeEnd && notice.textContent) notice.textContent = '';
}

function frame(now: number): void {
  if (inHub) return;
  arenaFrame = requestAnimationFrame(frame);
  const elapsed = Math.max(0, now - previousFrame) / 1000;
  previousFrame = now;
  syncAudioMix();
  if (networkFrame && online?.state) {
    const { view, time, span, gapMs } = networkFrame;
    const seat = online.state.you;
    const steering = view.phase === 'play' && view.players[seat].alive && online.connected &&
      !online.showing && !needsLandscape() && !document.hidden && !graphicsMessage;
    const connection = onlineConnectionMessage || (view.phase !== 'result' && now - time > 650
      ? 'Waiting for the next match update…' : '');
    if (onlineConnection.textContent !== connection) onlineConnection.textContent = connection;
    const direction = steering ? input() : { x: 0, z: 0 };
    const sequence = steering ? online.sendInput(direction, now) : undefined;
    const pose = steering ? onlineMovement.advance(now, direction, sequence) : undefined;
    yard?.draw(view, Math.min(1, Math.max(0, (now - time) / span)), now, pose);
    cookerAudio?.pressure(view.holder === null ? 0 : 1 - view.remaining / FUSE_TICKS,
      view.phase === 'play' && view.holder !== null && !document.hidden);
    updateInterface(view, seat, now);
    if (!debug.hidden && now - debugAt > 500) {
      const confirmation = onlineMovement.confirmationMs;
      debug.textContent = [
        'online tick ' + view.tick + '  frame ' + Math.round(elapsed * 1000) + ' ms',
        'snapshot gap ' + Math.round(gapMs) + ' ms  server interval ' + Math.round(span) + ' ms',
        'input confirmation ' + (confirmation === undefined ? '—' : Math.round(confirmation) + ' ms'),
        'position correction ' + onlineMovement.correctionDistance.toFixed(2),
      ].join('\n');
      debugAt = now;
    }
    return;
  }
  if (!paused && !needsLandscape() && !document.hidden && !graphicsMessage && (match.phase === 'play' || match.phase === 'ready')) {
    if (kitchen) {
      const timing = planFrame(accumulated, elapsed);
      accumulated = timing.remainder;
      if (timing.interrupted) {
        setPaused(true, 'Play paused after a long interruption. Resume when you are ready.');
      } else {
        for (let step = 0; step < timing.steps; step++) {
          match.step(input());
          consumeEvents(match, OFFLINE_SEAT, now);
        }
      }
    } else {
      // Preserve the historical Freight Tag comparison's frame policy.
      accumulated += Math.min(elapsed, 5 * STEP);
      while (accumulated >= STEP) {
        match.step(input());
        consumeEvents(match, OFFLINE_SEAT, now);
        accumulated -= STEP;
      }
    }
  }
  yard?.draw(match, paused || match.phase === 'result' ? 1 : accumulated / STEP, now);
  cookerAudio?.pressure(match.holder === null ? 0 : 1 - match.remaining / FUSE_TICKS,
    match.phase === 'play' && match.holder !== null && !paused && !document.hidden);
  updateInterface(match, OFFLINE_SEAT, now);
  if (!debug.hidden) {
    frames++;
    if (elapsed > 1 / 30) slowerFrames++;
    if (now - debugAt > 500) {
      const fps = Math.round(frames * 1000 / (now - debugAt));
      debug.textContent = [
        'seed ' + match.seed + '  tick ' + match.tick + '  fps ' + fps,
        'passes ' + totals.pass + '  cart hits ' + totals.hit + '  out ' + totals.blast,
        'carts ' + match.carts.length + '  warnings ' + totals.horn + '  slow frames ' + slowerFrames,
        'you ' + match.players[OFFLINE_SEAT].position.x.toFixed(2) + ', ' + match.players[OFFLINE_SEAT].position.z.toFixed(2),
      ].join('\n');
      debugAt = now;
      frames = 0;
      slowerFrames = 0;
    }
  }
}

primary.addEventListener('click', () => {
  if (networkFrame) {
    unlockAudio();
    online?.rematch();
    return;
  }
  if (paused) {
    unlockAudio();
    setPaused(false);
  } else {
    start();
  }
});
pauseButton.addEventListener('click', () => setPaused(!paused));
restartButton.addEventListener('click', start);
backToHubButton.addEventListener('click', () => {
  if (networkFrame) {
    showOnlineRoom();
  } else returnToHub();
});
onlineRoomButton.addEventListener('click', showOnlineRoom);
function syncSound(): void {
  const sound = effectsVolume > 0;
  soundButton.textContent = sound ? 'Effects on' : 'Effects muted';
  soundButton.setAttribute('aria-pressed', String(sound));
  soundButton.title = sound ? 'Mute sound effects' : 'Unmute sound effects';
  hub?.setAudio(effectsVolume, musicVolume);
  syncAudioMix();
}
function setVolume(channel: AudioChannel, level: number): void {
  if (channel === 'effects') {
    effectsVolume = level;
    if (level) lastEffectsVolume = level;
  } else musicVolume = level;
  if (usesHub) saveHubPreference(`${channel}-volume`, String(level));
  if (level && audio?.state !== 'running') unlockAudio();
  syncSound();
}
soundButton.addEventListener('click', () => setVolume('effects', effectsVolume ? 0 : lastEffectsVolume));
const fullscreen = createGameFullscreen(document.documentElement, full => {
  fullscreenButton.setAttribute('aria-pressed', String(full));
  fullscreenButton.textContent = full ? 'Exit fullscreen' : 'Fullscreen';
  landscapeFullscreen.setAttribute('aria-pressed', String(full));
  landscapeFullscreen.textContent = fullscreenButton.textContent;
  hub?.setFullscreen(full);
  online?.setFullscreen(full);
  releaseControls();
}, message => {
  if (landscapePrompt.open) landscapeNotice.textContent = message.replace(/ ?Rotate your device for landscape\.$/, '');
  else if (online?.showing) online.showDisplayNotice(message);
  else if (inHub) hub?.showNotice(message);
  else announce(message, performance.now(), 3200);
});
function activateMatch(): void {
  unlockAudio();
  if (kitchen) fullscreen.enterOnLaunch();
}
function openLandscapePrompt(duringPlay: boolean): void {
  landscapeDuringPlay = duringPlay;
  landscapeBack.textContent = duringPlay && networkFrame ? 'Back to Room' :
    duringPlay && hub ? 'Back to Lobby' : 'Back';
  if (!landscapePrompt.open) landscapePrompt.showModal();
  syncAudioMix();
}
function closeLandscapePrompt(): void {
  if (landscapePrompt.open) landscapePrompt.close();
  landscapeDuringPlay = false;
  landscapeNotice.textContent = '';
  syncAudioMix();
}
function canPlayInLandscape(): boolean {
  if (!needsLandscape()) return true;
  openLandscapePrompt(landscapeDuringPlay);
  return false;
}
function syncLandscape(): void {
  releaseControls();
  if (!needsLandscape()) {
    closeLandscapePrompt();
    if (pausedForLandscape) {
      pausedForLandscape = false;
      if (!document.hidden && !graphicsMessage) setPaused(false);
    }
    return;
  }
  const phase = networkFrame?.view.phase ?? match.phase;
  if (inHub || online?.showing || (phase !== 'ready' && phase !== 'play')) return;
  if (!networkFrame && !paused) {
    setPaused(true);
    pausedForLandscape = true;
  }
  openLandscapePrompt(true);
}
function dismissLandscapePrompt(): void {
  const duringPlay = landscapeDuringPlay;
  closeLandscapePrompt();
  if (!duringPlay) return;
  if (networkFrame) showOnlineRoom();
  else if (hub) returnToHub();
  else pausedForLandscape = false;
}
landscapePrompt.addEventListener('cancel', event => {
  event.preventDefault();
  dismissLandscapePrompt();
});
landscapeBack.addEventListener('click', dismissLandscapePrompt);
landscapeFullscreen.addEventListener('click', fullscreen.toggle);
fullscreenButton.addEventListener('click', fullscreen.toggle);
stage.addEventListener('graphics-lost', () => {
  setPaused(true);
  clearInput();
  graphicsMessage = 'The arena will resume after your browser restores its graphics context.';
});
stage.addEventListener('graphics-restored', () => { graphicsMessage = ''; });
function releaseControls(): void {
  clearInput();
  onlineMovement.reset();
  if (networkFrame) online?.sendInput({ x: 0, z: 0 }, performance.now());
}
window.addEventListener('blur', releaseControls);
portrait.addEventListener('change', syncLandscape);
coarse.addEventListener('change', syncLandscape);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    if (audio || hub?.showing) unlockAudio();
    return;
  }
  syncAudioMix();
  if (networkFrame) releaseControls();
  else setPaused(true);
});
window.addEventListener('keydown', event => {
  if (inHub || landscapePrompt.open || online?.showing || event.altKey || event.ctrlKey || event.metaKey) return;
  const phase = networkFrame?.view.phase ?? match.phase;
  if (movement[event.code] && phase === 'play' && !paused && !needsLandscape() && (!networkFrame || online?.connected)) {
    event.preventDefault();
    if (networkFrame && !event.repeat) unlockAudio();
    held.add(event.code);
  }
  if (event.repeat) return;
  if (networkFrame) {
    if (event.code === 'Escape' && !fullscreen.active) {
      event.preventDefault();
      showOnlineRoom();
    }
    return;
  }
  if (event.code === 'Escape' && !fullscreen.active) setPaused(!paused);
  if (event.code === 'KeyR' && (paused || match.phase === 'result')) start();
});
window.addEventListener('keyup', event => held.delete(event.code));
if (usesHub) {
  if (onlineEnabled) online = createOnlineRooms({
    cover: kitchenCover,
    ping: showPing,
    selected: () => selected,
    activate: activateMatch,
    canPlay: canPlayInLandscape,
    toggleFullscreen: fullscreen.toggle,
    room(state) {
      if (state.phase !== 'waiting' || !networkFrame) return;
      if (!inHub) returnToHub();
      networkFrame = undefined;
      online?.open();
    },
    snapshot: receiveSnapshot,
    connection(message) {
      onlineConnectionMessage = message;
      if (message && !online?.connected) releaseControls();
    },
    actionNotice: message => announce(message, performance.now(), 2400),
    left() {
      if (!inHub) returnToHub();
      networkFrame = undefined;
    },
  });
  hub = createHub({
    selected,
    games: [{
      id: 'let-them-cook',
      title: gameTitle,
      cover: kitchenCover,
      rules: [
        'Bump a rival to pass the cooker. Pressure keeps building through passes.',
        'Watch both tracks. A trolley hit stuns you for two seconds.',
        'The Viber holding the cooker when it vents is out. The last Viber wins.',
      ],
      start: playFromHub,
    }],
    selectViber(viber) {
      selected = viber;
      saveHubPreference('viber', viber.id);
    },
    setVolume,
    toggleFullscreen: fullscreen.toggle,
    previewPing: onlineEnabled ? undefined : () => playFromHub(true),
    openOnline: online && (() => {
      online?.open();
      activateMatch();
    }),
  });
  document.title = 'Viber Mayhem';
  hub.show();
  if (musicVolume) unlockAudio();
  online?.startFromLink();
} else {
  updateInterface(match, OFFLINE_SEAT, previousFrame);
  arenaFrame = requestAnimationFrame(frame);
}
syncSound();
element('game-loading')?.remove();
