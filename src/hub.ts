import './hub.css';
import { VIBERS } from './vibers.ts';
import type { Viber } from './vibers.ts';
import { ViberPreview } from './viber-preview.ts';
import chefMark from './assets/chef-mark.png?inline';

type Preference = 'viber' | 'sound';
type Panel = 'games' | 'vibers' | 'guide' | 'settings';

function readPreference(key: Preference): string | null {
  try { return localStorage.getItem('viber-mayhem:' + key); } catch { return null; }
}

export function saveHubPreference(key: Preference, value: string): void {
  try { localStorage.setItem('viber-mayhem:' + key, value); } catch { /* Browser storage may be unavailable. */ }
}

export function readHubPreferences(): { viber: Viber; sound: boolean } {
  const id = readPreference('viber');
  return { viber: VIBERS.find(viber => viber.id === id) ?? VIBERS[0], sound: readPreference('sound') !== 'off' };
}

type MiniGame = {
  id: string;
  title: string;
  cover: string;
  rules: readonly string[];
  start(): void;
};

type HubOptions = {
  selected: Viber;
  sound: boolean;
  games: readonly [MiniGame, ...MiniGame[]];
  selectViber(viber: Viber): void;
  toggleSound(): void;
  toggleFullscreen(): void;
  openOnline?(): void;
};

const lock = '<span class="hub-lock" aria-hidden="true"></span>';
const chef = '<img class="hub-chef" src="' + chefMark + '" alt="" draggable="false">';

const layout = `
  <header class="hub-bar">
    <h1 class="hub-wordmark">${chef}<span>Viber <b>Mayhem</b></span></h1>
    <nav class="hub-tools" aria-label="Lobby options">
      <button type="button" class="hub-vibers-tab" data-open="vibers" aria-controls="lobby-vibers" aria-expanded="false">${chef} Vibers</button>
      <button type="button" class="hub-locked" data-locked="Customize your Vibers." aria-label="Cosmetics, unavailable">${lock} Cosmetics</button>
      <button type="button" class="hub-locked" data-locked="Track milestones across mini-games." aria-label="Progress, unavailable">${lock} Progress</button>
      <button type="button" data-hub-fullscreen aria-label="Fullscreen" aria-pressed="false"><span class="hub-expand" aria-hidden="true"></span><span data-fullscreen-label>Fullscreen</span></button>
      <button type="button" class="hub-gear" data-open="settings" aria-controls="lobby-settings" aria-expanded="false" aria-label="Settings" title="Settings">⚙</button>
    </nav>
  </header>
  <main class="hub-room">
    <section class="hub-mode" aria-labelledby="lobby-mode-title">
      <div class="hub-mode-heading">
        <h2 id="lobby-mode-title">Mini-games</h2>
        <button type="button" class="hub-mode-button" data-open="games" aria-controls="lobby-games" aria-expanded="false">
          <strong data-game-title></strong><span class="hub-down" aria-hidden="true"></span>
        </button>
      </div>
      <img class="hub-cover" alt="" draggable="false">
      <section class="hub-sheet" id="lobby-games" data-panel="games" aria-labelledby="lobby-games-title" hidden>
        <div class="hub-sheet-heading"><h2 id="lobby-games-title">Pick a mini-game</h2><button type="button" class="hub-icon-button" data-close aria-label="Close mini-games">×</button></div>
        <div class="hub-game-list" role="group" aria-label="Playable mini-games"></div>
      </section>
    </section>
    <section class="hub-preview" aria-label="Interactive Viber preview">
      <div class="hub-preview-heading">
        <button type="button" class="hub-icon-button" data-cycle="-1" aria-label="Previous Viber">‹</button>
        <strong data-viber-name aria-live="polite"></strong>
        <button type="button" class="hub-icon-button" data-cycle="1" aria-label="Next Viber">›</button>
      </div>
      <div class="hub-preview-stage">
        <canvas tabindex="0" aria-label="3D Viber. Arrow keys rotate, plus and minus zoom, Home resets, and Enter poses."></canvas>
        <img class="hub-portrait-fallback" alt="" hidden>
        <div class="hub-preview-actions" role="group" aria-label="Model view controls">
          <button type="button" class="hub-icon-button" data-rotate="-1" aria-label="Rotate left">↶</button>
          <button type="button" class="hub-icon-button" data-rotate="1" aria-label="Rotate right">↷</button>
          <button type="button" class="hub-icon-button" data-reset-model aria-label="Reset view" title="Reset view">↺</button>
        </div>
      </div>
      <ol class="hub-seats" aria-label="Local party"></ol>
    </section>
    <div class="hub-sheets">
      <section class="hub-sheet" id="lobby-vibers" data-panel="vibers" aria-labelledby="lobby-vibers-title" hidden>
        <div class="hub-sheet-heading"><h2 id="lobby-vibers-title">Pick your Viber</h2><button type="button" class="hub-panel-done" data-close>Done</button></div>
        <div class="hub-viber-options" role="group" aria-label="Viber roster"></div>
      </section>
      <section class="hub-sheet" id="lobby-guide" data-panel="guide" aria-labelledby="lobby-guide-title" hidden>
        <div class="hub-sheet-heading"><h2 id="lobby-guide-title">Controls</h2><button type="button" class="hub-icon-button" data-close aria-label="Close controls">×</button></div>
        <dl class="hub-inputs">
          <div><dt>Keyboard</dt><dd><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrow keys</dd></div>
          <div><dt>Touch</dt><dd>Drag on the left side to move</dd></div>
        </dl>
        <h3 data-guide-title></h3>
        <ul class="hub-rule-list"></ul>
      </section>
      <section class="hub-sheet" id="lobby-settings" data-panel="settings" aria-labelledby="lobby-settings-title" hidden>
        <div class="hub-sheet-heading"><h2 id="lobby-settings-title">Settings</h2><button type="button" class="hub-icon-button" data-close aria-label="Close settings">×</button></div>
        <div class="hub-setting"><span>Match sound</span><button type="button" class="hub-switch" data-hub-sound aria-label="Match sound" aria-pressed="true">On</button></div>
        <div class="hub-setting"><span>Movement and match rules</span><button type="button" class="hub-panel-done" data-open="guide" aria-controls="lobby-guide" aria-expanded="false">Controls</button></div>
      </section>
    </div>
  </main>
  <footer class="hub-party-bar">
    <div class="hub-play-modes" role="group" aria-label="Play mode">
      <span class="hub-bot-mode"><span aria-hidden="true">✓</span> Play with Bots</span>
      <button type="button" class="hub-locked" data-locked="Invite friends and fill open seats with bots." aria-label="Online Rooms, unavailable">${lock} Online Rooms</button>
      <button type="button" class="hub-locked" data-locked="Play a series of scored mini-games." aria-label="Party Cups, unavailable">${lock} Party Cups</button>
      <button type="button" class="hub-locked" data-locked="Play together on one device." aria-label="Same Screen, unavailable">${lock} Same Screen</button>
    </div>
    <button type="button" class="hub-launch" data-hub-start>
      <span class="hub-play-icon" aria-hidden="true"></span>Play
    </button>
  </footer>
  <p class="hub-notice" role="status" data-hub-notice></p>
`;

export function createHub(options: HubOptions) {
  const root = document.createElement('div');
  root.id = 'mayhem-hub';
  root.hidden = true;
  root.innerHTML = layout;
  document.body.prepend(root);
  const require = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const openers = [...root.querySelectorAll<HTMLButtonElement>('[data-open]')];
  const panels = [...root.querySelectorAll<HTMLElement>('.hub-sheet')];
  const sound = require<HTMLButtonElement>('[data-hub-sound]');
  const fullscreen = require<HTMLButtonElement>('[data-hub-fullscreen]');
  const start = require<HTMLButtonElement>('[data-hub-start]');
  const stage = require('.hub-preview-stage');
  const canvas = require<HTMLCanvasElement>('.hub-preview canvas');
  const fallback = require<HTMLImageElement>('.hub-portrait-fallback');
  const notice = require('[data-hub-notice]');
  if (options.openOnline) {
    const online = require<HTMLButtonElement>('[aria-label="Online Rooms, unavailable"]');
    online.removeAttribute('data-locked');
    online.removeAttribute('aria-label');
    online.classList.remove('hub-locked');
    online.textContent = 'Online Rooms';
    online.addEventListener('click', options.openOnline);
  }
  const roster = require('.hub-viber-options');
  const seats = require('.hub-seats');
  const gameList = require('.hub-game-list');
  let game = options.games[0];
  let selected = options.selected;
  let activePanel: Panel | undefined;
  let opener: HTMLButtonElement | undefined;
  let preview: ViberPreview | undefined;
  let hasOpened = false;
  let noticeTimeout: number | undefined;

  function showNotice(message: string): void {
    window.clearTimeout(noticeTimeout);
    notice.textContent = message;
    if (message) noticeTimeout = window.setTimeout(() => { notice.textContent = ''; }, 4500);
  }

  function syncGame(): void {
    require<HTMLImageElement>('.hub-cover').src = game.cover;
    require('[data-game-title]').textContent = game.title;
    require('[data-guide-title]').textContent = game.title;
    require('.hub-rule-list').replaceChildren(...game.rules.map(rule => {
      const item = document.createElement('li');
      item.textContent = rule;
      return item;
    }));
    for (const tile of gameList.querySelectorAll<HTMLButtonElement>('button')) {
      tile.setAttribute('aria-pressed', String(tile.dataset.game === game.id));
    }
  }

  function syncViber(): void {
    require('[data-viber-name]').textContent = selected.name;
    fallback.src = selected.portrait;
    for (const tile of roster.querySelectorAll<HTMLButtonElement>('button')) {
      tile.setAttribute('aria-pressed', String(tile.dataset.viber === selected.id));
    }
    for (const tile of seats.querySelectorAll<HTMLButtonElement>('button')) {
      const isPlayer = tile.dataset.viber === selected.id;
      tile.setAttribute('aria-pressed', String(isPlayer));
      tile.querySelector('span')!.textContent = isPlayer ? 'You' : 'Bot';
    }
    preview?.select(selected);
  }

  function setPanel(next?: Panel, from?: HTMLButtonElement, focus = true): void {
    const previousOpener = opener;
    activePanel = next;
    opener = from;
    root.dataset.openPanel = next ?? '';
    showNotice('');
    for (const button of openers) button.setAttribute('aria-expanded', String(button.dataset.open === next));
    for (const panel of panels) panel.hidden = panel.dataset.panel !== next;
    if (!focus) return;
    if (next) {
      const panel = panels.find(item => item.dataset.panel === next);
      const first = panel?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
        ?? panel?.querySelector<HTMLButtonElement>('[data-close]');
      first?.focus({ preventScroll: true });
    } else {
      const returnTarget = previousOpener?.closest('[hidden]')
        ? require('[data-open="settings"]')
        : previousOpener;
      returnTarget?.focus({ preventScroll: true });
    }
  }

  for (const candidate of options.games) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.game = candidate.id;
    const image = new Image();
    image.src = candidate.cover;
    image.alt = '';
    image.draggable = false;
    const name = document.createElement('strong');
    name.textContent = candidate.title;
    button.append(image, name);
    button.addEventListener('click', () => {
      game = candidate;
      syncGame();
      setPanel();
    });
    gameList.append(button);
  }

  function selectViber(viber: Viber): void {
    if (selected === viber) return;
    selected = viber;
    options.selectViber(viber);
    syncViber();
  }

  for (const viber of VIBERS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.viber = viber.id;
    const portrait = new Image();
    portrait.src = viber.portrait;
    portrait.alt = '';
    portrait.draggable = false;
    const label = document.createElement('strong');
    label.textContent = viber.name;
    button.append(portrait, label);
    button.addEventListener('click', () => selectViber(viber));
    roster.append(button);

    const seat = document.createElement('li');
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'hub-seat';
    tile.dataset.viber = viber.id;
    tile.setAttribute('aria-label', 'Play as ' + viber.name);
    tile.title = 'Play as ' + viber.name;
    tile.append(portrait.cloneNode(), document.createElement('span'));
    tile.addEventListener('click', () => selectViber(viber));
    seat.append(tile);
    seats.append(seat);
  }

  for (const list of [gameList, roster, seats]) {
    list.addEventListener('keydown', event => {
      const step = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : 0;
      if (!step) return;
      const buttons = [...list.querySelectorAll('button')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (index < 0) return;
      event.preventDefault();
      buttons[(index + step + buttons.length) % buttons.length].focus();
    });
  }
  openers.forEach(button => button.addEventListener('click', () => {
    const next = button.dataset.open as Panel;
    if (next === activePanel) setPanel();
    else setPanel(next, button);
  }));
  root.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => setPanel()));
  root.addEventListener('keydown', event => {
    if (activePanel && event.key === 'Escape') {
      event.preventDefault();
      setPanel();
    }
  });
  start.addEventListener('click', () => game.start());
  sound.addEventListener('click', options.toggleSound);
  fullscreen.addEventListener('click', options.toggleFullscreen);
  root.querySelectorAll<HTMLButtonElement>('[data-cycle]').forEach(button => {
    button.addEventListener('click', () => {
      const index = VIBERS.indexOf(selected) + Number(button.dataset.cycle);
      selectViber(VIBERS[(index + VIBERS.length) % VIBERS.length]);
    });
  });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  root.querySelectorAll<HTMLButtonElement>('[data-locked]').forEach(button => {
    button.addEventListener('click', () => {
      showNotice(button.dataset.locked + ' Not available yet.');
      if (!reducedMotion.matches) {
        const icon = button.querySelector('.hub-lock');
        icon?.getAnimations().forEach(animation => animation.cancel());
        icon?.animate([
          { transform: 'rotate(0)' }, { transform: 'rotate(-16deg)' },
          { transform: 'rotate(12deg)' }, { transform: 'rotate(0)' },
        ], { duration: 280, easing: 'ease-out' });
      }
    });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-rotate]').forEach(button => {
    button.addEventListener('click', () => preview?.rotate(Number(button.dataset.rotate) * 0.43));
  });
  require('[data-reset-model]').addEventListener('click', () => preview?.reset());

  function setSound(enabled: boolean): void {
    sound.setAttribute('aria-pressed', String(enabled));
    sound.textContent = enabled ? 'On' : 'Off';
  }

  setSound(options.sound);
  syncGame();
  syncViber();
  return {
    show(focus = false) {
      root.hidden = false;
      setPanel(undefined, undefined, false);
      if (!hasOpened) {
        hasOpened = true;
        try {
          preview = new ViberPreview(stage, canvas);
          preview.select(selected);
        } catch {
          canvas.hidden = require('.hub-preview-actions').hidden = true;
          fallback.hidden = false;
        }
      }
      preview?.show(true);
      if (focus) start.focus({ preventScroll: true });
    },
    hide() {
      preview?.show(false);
      root.hidden = true;
    },
    setSound,
    setFullscreen(enabled: boolean) {
      fullscreen.setAttribute('aria-pressed', String(enabled));
      const label = enabled ? 'Exit fullscreen' : 'Fullscreen';
      fullscreen.setAttribute('aria-label', label);
      require('[data-fullscreen-label]').textContent = label;
      showNotice('');
    },
    showNotice,
  };
}
