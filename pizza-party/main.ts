import './style.css';
import { createPizzaAudio } from './audio.ts';
import { createKitchenSounds } from './kitchen-sounds.ts';
import { COUNTERS, offset } from './layout.ts';
import { planFrame } from './shared/frame-clock.ts';
import { createGameFullscreen } from './shared/game-fullscreen.ts';
import { VIBERS } from './shared/vibers.ts';
import { PIZZA_IDLE } from './network-state.ts';
import type { PizzaDisplay, PizzaFrameMessage, PizzaHostMessage, PizzaTimedEvent } from './network-state.ts';
import { OnlinePizza } from './online-preview.ts';
import { FOOD_INFO, HZ, PizzaMatch } from './simulation.ts';
import type { Food, PizzaEvent, PizzaPose, Vec } from './simulation.ts';
import { PizzaView } from './view.ts';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const query = new URLSearchParams(location.search);
const numberSeed = Number(query.get('seed'));
const seeded = query.has('seed') && Number.isSafeInteger(numberSeed);
const nextSeed = () => seeded ? numberSeed >>> 0 : crypto.getRandomValues(new Uint32Array(1))[0];
const arrivalPriority = import.meta.env.MODE === 'arrival-priority';
const sharedOpening = import.meta.env.MODE === 'shared-rush';
const embedded = window.parent !== window && location.origin !== 'null';
const onlineRound = embedded && query.has('online') ? Number(query.get('online')) : undefined;
const seat = embedded && /^[0-3]$/.test(query.get('you') ?? '') ? Number(query.get('you')) : 0;
const requestedRoster = embedded && /^[0-3](,[0-3]){3}$/.test(query.get('roster') ?? '')
  ? query.get('roster')!.split(',').map(Number) : [];
const roster = new Set(requestedRoster).size === VIBERS.length ? requestedRoster.map(id => VIBERS[id]) : VIBERS;
const post = (message: PizzaFrameMessage) => {
  if (embedded) window.parent.postMessage(message, location.origin);
};
const online = onlineRound === undefined ? undefined : new OnlinePizza(seat, post);
const offlineMatch = new PizzaMatch(nextSeed(), arrivalPriority ? 'arrival' : 'closest', sharedOpening);
let match: PizzaDisplay = offlineMatch;
const audio = createPizzaAudio();
const kitchenSounds = createKitchenSounds(audio, seat);
const app = el('pizza-app'), canvas = el<HTMLCanvasElement>('kitchen'), touch = el('touch'), stick = el('stick');
const overlay = el('overlay'), primary = el<HTMLButtonElement>('primary'), secondary = el<HTMLButtonElement>('secondary');
const pause = el<HTMLButtonElement>('pause'), mute = el<HTMLButtonElement>('mute'), fullscreenButton = el<HTMLButtonElement>('fullscreen');
const scores = el('scoreboard'), clock = el('clock'), timer = el('timer'), carry = el('carry'), toast = el('toast');
const you = el('you-marker'), countdown = el('countdown'), debug = el('debug'), displayNote = el('display-note');
const back = el<HTMLButtonElement>('back'), roomButton = el<HTMLButtonElement>('pizza-room');
const ping = el('pizza-ping'), connection = el('pizza-connection');
const portrait = matchMedia('(orientation: portrait)');
const coarse = matchMedia('(any-pointer: coarse)');
const hasTouch = () => coarse.matches || navigator.maxTouchPoints > 0;
const needsLandscape = () => hasTouch() && portrait.matches;

const directions: Record<string, Vec> = {
  KeyW: { x: 0, z: -1 }, ArrowUp: { x: 0, z: -1 },
  KeyS: { x: 0, z: 1 }, ArrowDown: { x: 0, z: 1 },
  KeyA: { x: -1, z: 0 }, ArrowLeft: { x: -1, z: 0 },
  KeyD: { x: 1, z: 0 }, ArrowRight: { x: 1, z: 0 },
};
const held = new Set<string>();
let pointer: { id: number; x: number; y: number } | undefined;
let drag: Vec = { x: 0, z: 0 };
let paused = false;
let startAfterRotate = false;
let resumeAfterRotate = false;
let graphics = '';
let clockAt = performance.now();
let remainder = 0;
let toastUntil = -Infinity;
let shown = '';
let shownSeconds = -1;
let previousCarry: Food | null | undefined;
let noticeHandle = 0;
let view: PizzaView | undefined;
let localPose: PizzaPose | undefined;
let sentLoaded = false;
let room: Extract<PizzaHostMessage, { type: 'room' }> | undefined;
let hostFullscreen = false;
const sliders = (['music', 'effects'] as const).map(name => ({
  name, input: el<HTMLInputElement>(name + '-level'), number: el(name + '-value'),
}));

try {
  view = new PizzaView(canvas, roster);
} catch {
  graphics = 'Open Pizza Party in a browser with WebGL 2 and graphics acceleration enabled.';
}

function showFullscreen(active: boolean) {
  fullscreenButton.setAttribute('aria-pressed', String(active));
  fullscreenButton.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Fullscreen');
  fullscreenButton.title = active ? 'Exit fullscreen' : 'Fullscreen';
}

const fullscreen = createGameFullscreen(app, showFullscreen, message => {
  window.clearTimeout(noticeHandle);
  displayNote.hidden = false;
  displayNote.textContent = message;
  noticeHandle = window.setTimeout(() => { displayNote.hidden = true; }, 2200);
});
const isFullscreen = () => embedded ? hostFullscreen : fullscreen.active;
function toggleFullscreen() {
  if (embedded) post({ type: 'fullscreen' });
  else void fullscreen.toggle();
}

const scoreNodes = roster.map((viber, id) => {
  const tile = document.createElement('div');
  tile.className = 'score';
  tile.style.setProperty('--viber', viber.color);
  tile.toggleAttribute('data-you', id === seat);
  const photo = new Image(20, 20);
  photo.src = viber.portrait;
  photo.alt = '';
  const value = document.createElement('b');
  tile.append(photo, value);
  scores.append(tile);
  return { tile, value, score: -1 };
});

const orderNodes = roster.map((viber, id) => {
  const badge = document.createElement('div');
  badge.className = 'order';
  badge.toggleAttribute('data-you', id === seat);
  badge.style.setProperty('--viber', viber.color);
  el('orders').append(badge);
  return { badge, key: '' };
});

const activeRound = () => match.phase === 'ready' || match.phase === 'playing';

function muteButton() {
  const label = audio.muted ? 'Sound off' : 'Sound on';
  mute.setAttribute('aria-pressed', String(!audio.muted));
  mute.setAttribute('aria-label', label);
  mute.title = label;
}

function clearInput() {
  held.clear();
  const id = pointer?.id;
  pointer = undefined;
  drag = { x: 0, z: 0 };
  if (id !== undefined && touch.hasPointerCapture(id)) touch.releasePointerCapture(id);
  touch.classList.remove('active');
}

function setPaused(value: boolean) {
  if (online || !activeRound()) return;
  paused = value;
  remainder = 0;
  clockAt = performance.now();
  clearInput();
  updateOverlay();
}

function begin(anotherSeed: boolean) {
  if (!view || graphics || online) return;
  audio.unlock();
  if (!embedded) fullscreen.enterOnLaunch();
  if (needsLandscape()) {
    startAfterRotate = true;
    updateOverlay();
    return;
  }
  startAfterRotate = resumeAfterRotate = false;
  offlineMatch.reset(anotherSeed ? nextSeed() : match.seed);
  view.reset();
  kitchenSounds.reset();
  clockAt = performance.now();
  remainder = 0;
  toastUntil = -Infinity;
  toast.hidden = true;
  paused = false;
  shown = '';
  clearInput();
  primary.blur();
  secondary.blur();
  updateHud();
}

function syncOrientation() {
  if (online) {
    clearInput();
    online.release();
    updateOverlay();
    return;
  }
  if (needsLandscape()) {
    if (activeRound() && !paused) {
      resumeAfterRotate = true;
      setPaused(true);
    }
  } else if (startAfterRotate) begin(false);
  else if (resumeAfterRotate && !document.hidden && !graphics) setPaused(false);
  if (!needsLandscape()) resumeAfterRotate = false;
  updateOverlay();
}

function stateName() {
  if (graphics) return 'graphics';
  if (needsLandscape() && (activeRound() || startAfterRotate)) return 'rotate';
  if (paused) return 'pause';
  if (match.phase === 'menu') return online ? 'loading' : 'menu';
  if (match.phase === 'over') return 'results';
  return '';
}

function updateOverlay() {
  const state = stateName();
  updateMusic(state);
  const isResults = state === 'results';
  overlay.hidden = state === '';
  overlay.toggleAttribute('data-results', isResults);
  el('results').hidden = !isResults;
  back.hidden = !embedded || !state;
  back.textContent = online ? 'Room' : 'Games';
  if (online && isResults) {
    primary.disabled = !room?.canRematch;
    primary.textContent = room?.rematch ?? 'Rematch';
  }
  if (state === shown) return;
  shown = state;
  if (!state) return;

  const title = el('panel-title'), copy = el('panel-copy');
  primary.disabled = state === 'graphics' || state === 'loading' || !!(online && isResults && !room?.canRematch);
  secondary.hidden = state !== 'pause';
  el('sound-settings').hidden = state !== 'pause';
  el('chef-mark').hidden = state !== 'menu';
  el('input-hint').hidden = state !== 'menu';
  el('input-hint').textContent = hasTouch() ? 'Drag on the left to move' : 'WASD or arrows to move';
  if (state === 'rotate') {
    title.textContent = 'Turn to landscape';
    copy.textContent = 'Rotate your phone sideways to play.';
    primary.textContent = 'Fullscreen';
  } else if (state === 'graphics' || state === 'loading') {
    title.textContent = state === 'graphics' ? 'Graphics unavailable' : 'Opening the kitchen';
    copy.textContent = state === 'graphics' ? graphics : 'Syncing the room…';
    primary.textContent = state === 'graphics' ? 'Play' : 'Connecting';
  } else if (state === 'pause') {
    title.textContent = 'Paused';
    copy.textContent = 'The round is paused.';
    primary.textContent = 'Resume';
  } else if (isResults) {
    const winners = match.winners;
    title.textContent = winners.length > 1 ? 'It’s a tie!' : winners[0] === seat ? 'You win!' : roster[winners[0]].name + ' wins!';
    const best = Math.max(...match.players.map(player => player.score));
    copy.textContent = best === 1 ? '1 pizza' : best + ' pizzas';
    primary.textContent = room?.rematch ?? 'Rematch';
    const results = [...match.players].sort((a, b) => b.score - a.score);
    el('results').replaceChildren(...results.map(({ id, score }) => {
      const row = document.createElement('div'), photo = new Image(19, 19);
      row.className = 'result';
      row.toggleAttribute('data-won', winners.includes(id));
      photo.src = roster[id].portrait;
      photo.alt = '';
      const name = document.createElement('span'), total = document.createElement('b');
      name.textContent = id === seat ? 'You' : roster[id].name;
      total.textContent = String(score);
      row.append(photo, name, total);
      return row;
    }));
  } else {
    title.textContent = 'Pizza Party';
    copy.textContent = sharedOpening
      ? 'Each order needs a topping from a near tray and a far tray. Race for the marked pickup spot when you share a request.'
      : arrivalPriority
      ? 'Use the marked spots to grab toppings as the trays refill. Bring two requested toppings to your counter.'
      : 'Closest plate wins when a tray refills. Bring two requested toppings to your counter.';
    primary.textContent = 'Play';
  }
}

function updateMusic(state = stateName()) {
  audio.setMode(document.hidden || room?.blocked ? 'rest' : state === 'menu' ? 'menu' :
    state === '' ? 'round' : state === 'results' ? 'results' : 'rest');
}

function icon(food: Food, served: boolean, matching: boolean): HTMLElement {
  const token = document.createElement('span');
  token.className = 'ingredient';
  token.textContent = FOOD_INFO[food].icon;
  token.toggleAttribute('data-served', served);
  token.toggleAttribute('data-matched', matching);
  return token;
}

function updateHud() {
  const human = match.players[seat];
  app.dataset.phase = match.phase;
  const seconds = Math.ceil(match.remaining / HZ);
  if (seconds !== shownSeconds) {
    shownSeconds = seconds;
    clock.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    timer.toggleAttribute('data-urgent', seconds <= 10 && match.phase === 'playing');
  }
  pause.disabled = !activeRound() || !!graphics || !!online;
  const pauseLabel = paused ? 'Resume' : 'Pause';
  if (pause.getAttribute('aria-label') !== pauseLabel) {
    pause.setAttribute('aria-label', pauseLabel);
    pause.toggleAttribute('data-paused', paused);
    pause.title = pauseLabel;
  }
  if (previousCarry !== human.carried) {
    previousCarry = human.carried;
    carry.textContent = human.carried ? FOOD_INFO[human.carried].icon + ' ' + FOOD_INFO[human.carried].name : '';
  }
  carry.hidden = !human.carried || match.phase !== 'playing';
  toast.hidden = match.tick >= toastUntil || match.phase !== 'playing' || paused;
  countdown.hidden = match.phase !== 'ready' || paused;
  if (!countdown.hidden) {
    countdown.textContent = match.tick < 39 ? 'READY' : 'COOK!';
  }

  for (const player of match.players) {
    const score = scoreNodes[player.id], order = orderNodes[player.id];
    if (score.score !== player.score) {
      score.score = player.score;
      score.value.textContent = String(player.score);
      score.tile.setAttribute('aria-label', (player.id === seat ? 'You' : roster[player.id].name) + ', ' + player.score + ' pizzas');
    }
    const cooking = player.serviceAt >= 0;
    const key = [player.recipe.join(), player.delivered.join(), cooking, player.id === seat ? human.carried : ''].join('|');
    if (key !== order.key) {
      order.key = key;
      order.badge.toggleAttribute('data-cooking', cooking);
      if (cooking) {
        const token = document.createElement('span');
        token.className = 'ingredient';
        token.textContent = '🍕';
        order.badge.replaceChildren(token);
      } else {
        order.badge.replaceChildren(...player.delivered.map(food => icon(food, true, false)),
          ...player.recipe.map(food => icon(food, false, player.id === seat && food === human.carried)));
      }
    }
    if (view) {
      const { center, inward, tangent } = COUNTERS[player.id];
      const side = Math.sign(center.x * tangent.x);
      const counter = view.project(offset(offset(center, inward, -0.39), tangent, side * 1.04), 0.97);
      order.badge.style.setProperty('--order-x', counter.x + 'px');
      order.badge.style.setProperty('--order-y', counter.y + 'px');
    }
  }
  if (view) {
    const point = view.runnerLabel(seat);
    you.style.transform = 'translate(' + point.x + 'px,' + point.y + 'px) translate(-50%,-100%)';
  }
  if (query.has('debug')) {
    debug.hidden = false;
    debug.textContent = 'seed ' + match.seed + ' · tick ' + match.tick + ' · ' + match.phase + '\n' +
      'you ' + human.position.x.toFixed(2) + ', ' + human.position.z.toFixed(2) + ' · ' + (human.carried ?? 'empty') + '\n' +
      'scores ' + match.players.map(player => player.score).join(' / ');
    const opening = match.openingPair;
    if (opening) {
      const readyAt = match.trayReadyAt[opening.station];
      debug.textContent += '\nopening ' + match.supplies[opening.station] + ' · portions ' + Number(match.tick >= readyAt) +
        ' · refill ' + readyAt;
    }
    if (online) debug.textContent += '\nserver round ' + onlineRound + ' · seat ' + seat +
      ' · render ' + (localPose?.position.x ?? human.position.x).toFixed(3) + ', ' +
      (localPose?.position.z ?? human.position.z).toFixed(3);
  }
  updateOverlay();
}

function feedback(event: PizzaEvent & Partial<PizzaTimedEvent>) {
  view?.event(match, event);
  kitchenSounds.event(match, event);
  if (event.player !== seat) return;
  if (event.type === 'score') toast.textContent = '+1 pizza';
  else if (event.type === 'swap' && event.station !== undefined) {
    toast.textContent = 'Swapped to ' + FOOD_INFO[match.supplies[event.station]].name.toLowerCase();
  }
  else if (event.type === 'deliver' && event.counter !== seat) toast.textContent = 'Served at ' + roster[event.counter!].name + '’s counter';
  else if (event.type === 'deliver') toast.textContent = 'Topping served';
  else return;
  toastUntil = match.tick + 49;
}

function currentInput(): Vec {
  if (pointer) return drag;
  const input: Vec = { x: 0, z: 0 };
  for (const key of held) {
    input.x += directions[key].x;
    input.z += directions[key].z;
  }
  return input;
}

function frame(now: number) {
  const elapsed = (now - clockAt) / 1000;
  clockAt = now;
  if (online) {
    const steering = !!room?.connected && !room.blocked && !needsLandscape() && !document.hidden && !graphics;
    localPose = online.advance(now, currentInput(), steering);
    const waiting = room?.message || (activeRound() && online.stale(now) ? 'Waiting for the match server…' : '');
    if (connection.textContent !== waiting) connection.textContent = waiting;
    connection.hidden = !waiting || !!room?.blocked;
  } else if (!paused && activeRound() && !document.hidden && !needsLandscape() && !graphics) {
    const clockPlan = planFrame(remainder, elapsed);
    remainder = clockPlan.remainder;
    if (clockPlan.interrupted) setPaused(true);
    else {
      const input = currentInput();
      for (let n = 0; n < clockPlan.steps; n++) {
        offlineMatch.step(input);
        offlineMatch.events.forEach(feedback);
        kitchenSounds.step(match);
      }
    }
  }
  const blend = online ? online.blend(now) : Math.min(1, remainder * HZ);
  view?.render(match, paused || match.phase === 'over' ? 1 : blend, kitchenSounds.strides,
    localPose ? { seat, pose: localPose } : undefined);
  if (!sentLoaded && onlineRound !== undefined && view && !graphics && match !== offlineMatch) {
    sentLoaded = true;
    post({ type: 'loaded', round: onlineRound });
  }
  updateHud();
  requestAnimationFrame(frame);
}

function togglePause() {
  if (needsLandscape() || graphics) return;
  audio.unlock();
  setPaused(!paused);
}

primary.addEventListener('click', () => {
  const state = stateName();
  if (state === 'rotate') toggleFullscreen();
  else if (state === 'pause') togglePause();
  else if (online && state === 'results') post({ type: 'rematch' });
  else if (state === 'menu' || state === 'results') begin(true);
});
secondary.addEventListener('click', () => begin(false));
pause.addEventListener('click', togglePause);
back.addEventListener('click', () => post({ type: online ? 'room' : 'back' }));
roomButton.addEventListener('click', () => post({ type: 'room' }));
mute.addEventListener('click', () => { audio.toggle(); muteButton(); });
for (const { name, input, number } of sliders) {
  input.value = String(Math.round(audio.getLevel(name) * 100));
  number.textContent = input.value + '%';
  input.addEventListener('input', () => {
    audio.setLevel(name, Number(input.value) / 100);
    if (embedded) post({ type: 'volume', channel: name, level: Number(input.value) });
    number.textContent = input.value + '%';
  });
}
fullscreenButton.addEventListener('click', toggleFullscreen);
portrait.addEventListener('change', syncOrientation);
coarse.addEventListener('change', syncOrientation);
window.addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement) {
    if (!event.repeat && event.code === 'Escape') togglePause();
    return;
  }
  if (event.code in directions && activeRound() && !paused && (!online || room?.connected && !room.blocked) &&
      !event.ctrlKey && !event.metaKey && !event.altKey && !needsLandscape()) {
    event.preventDefault();
    held.add(event.code);
  }
  if (!event.repeat && event.code === 'Escape' && !isFullscreen()) {
    if (online) post({ type: 'room' });
    else togglePause();
  }
  if (!event.repeat && event.code === 'KeyR' && (paused || match.phase === 'over')) begin(false);
});
window.addEventListener('keyup', event => held.delete(event.code));
window.addEventListener('blur', () => {
  resumeAfterRotate = false;
  if (online) {
    clearInput();
    online.advance(performance.now(), PIZZA_IDLE, false);
    online.release();
  }
  else if (activeRound() && !paused) setPaused(true);
  else clearInput();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    resumeAfterRotate = false;
    if (online) clearInput();
    if (!paused && activeRound()) setPaused(true);
  }
  updateMusic();
});

touch.addEventListener('pointerdown', event => {
  if (pointer || paused || match.phase !== 'playing' || needsLandscape() || online && (!room?.connected || room.blocked)) return;
  event.preventDefault();
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  touch.setPointerCapture(event.pointerId);
  const bounds = touch.getBoundingClientRect();
  stick.style.left = Math.max(0, event.clientX - bounds.left - 38) + 'px';
  stick.style.top = Math.max(0, event.clientY - bounds.top - 38) + 'px';
  touch.classList.add('active');
});
touch.addEventListener('pointermove', event => {
  if (event.pointerId !== pointer?.id) return;
  const x = event.clientX - pointer.x, z = event.clientY - pointer.y;
  const length = Math.hypot(x, z);
  const range = Math.max(29, Math.min(43, touch.clientHeight * 0.115));
  const strength = Math.max(0, Math.min(1, (length / range - 0.11) / 0.89));
  drag = { x: x / (length || 1) * strength, z: z / (length || 1) * strength };
  stick.querySelector('i')!.style.transform = 'translate(' + 20 * drag.x + 'px,' + 20 * drag.z + 'px)';
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  touch.addEventListener(event, e => { if (e.pointerId === pointer?.id) clearInput(); });
}

canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  graphics = 'Waiting for the browser to restore the kitchen graphics.';
  setPaused(true);
  updateOverlay();
});
canvas.addEventListener('webglcontextrestored', () => { graphics = ''; updateOverlay(); });

if (embedded) {
  app.dataset.embedded = '';
  if (online) app.dataset.online = '';
  pause.hidden = !!online;
  roomButton.hidden = ping.hidden = !online;
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== location.origin ||
        !event.data || typeof event.data !== 'object') return;
    const message = event.data as PizzaHostMessage;
    if (message.type === 'fullscreen') {
      hostFullscreen = message.active;
      showFullscreen(hostFullscreen);
    } else if (message.type === 'start') {
      for (const { name, input, number } of sliders) {
        audio.setLevel(name, message[name]);
        input.value = String(Math.round(message[name] * 100));
        number.textContent = input.value + '%';
      }
      audio.unlock();
      if (!online) begin(false);
    } else if (online && message.type === 'room') {
      room = message;
      if (room.blocked || !room.connected) {
        clearInput();
        online.advance(performance.now(), PIZZA_IDLE, false);
        online.release();
      }
      const reading = room.ping;
      ping.textContent = typeof reading === 'number' ? reading + ' ms' : reading === 'no-reply' ? '—' : '…';
      ping.dataset.quality = typeof reading !== 'number' ? '' : reading < 100 ? 'good' : reading < 180 ? 'fair' : 'slow';
      ping.setAttribute('aria-label', 'Server ping ' + (typeof reading === 'number' ? reading + ' milliseconds' : reading));
      updateOverlay();
    } else if (online && message.type === 'state' && message.snapshot.round === onlineRound) {
      const { view: state, events } = message.snapshot;
      const steps = state.tick - match.tick;
      const blend = steps > 0 && steps <= 8 && match !== offlineMatch;
      match = {
        ...state,
        players: state.players.map(player => ({
          ...player, previous: blend ? match.players[player.id].position : player.position,
          previousHeading: blend ? match.players[player.id].heading : player.heading,
        })),
      };
      online.receive(message);
      events.forEach(feedback);
      if (blend) kitchenSounds.step(match, steps);
      updateHud();
    }
  });
  post({ type: 'ready' });
}
muteButton();
updateHud();
audio.unlock();
function unlockOnGesture(event: Event) {
  if (!event.isTrusted) return;
  audio.unlock();
  window.removeEventListener('pointerdown', unlockOnGesture, true);
  window.removeEventListener('keydown', unlockOnGesture, true);
}
window.addEventListener('pointerdown', unlockOnGesture, true);
window.addEventListener('keydown', unlockOnGesture, true);
requestAnimationFrame(frame);
