import './online-rooms.css';
import { Client } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';
import { RECONNECT_SECONDS, ROOM_TYPE } from './online-protocol.ts';
import type { RoomView, Snapshot } from './online-protocol.ts';
import { parseRegionDirectory, preferredRegion, readRoomRoute } from './online-regions.ts';
import type { GameRegion, RegionDirectory, RoomRoute } from './online-regions.ts';
import type { Vec } from './simulation.ts';
import { VIBERS } from './vibers.ts';
import type { Viber } from './vibers.ts';

const SESSION = 'viber-mayhem:online-seat';
export const onlineEnabled = document.documentElement.hasAttribute('data-online');

type Callbacks = {
  cover: string;
  selected(): Viber;
  activate(): void;
  room(view: RoomView): void;
  snapshot(snapshot: Snapshot): void;
  connection(message: string): void;
  actionNotice(message: string): void;
  left(): void;
};

function waitingFor(state: RoomView): string {
  const away = state.seats.filter(seat => seat.kind === 'away').length;
  if (away) return away === 1 ? 'Waiting for one player to reconnect.' : 'Waiting for players to reconnect.';
  const guests = state.seats.filter((seat, index) => seat.kind === 'human' && index !== state.host && !seat.ready);
  if (guests.length === 1) return 'Waiting for ' + VIBERS[guests[0].viber].name + ' to ready up.';
  return guests.length ? 'Waiting for ' + guests.length + ' players to ready up.' : '';
}

export function createOnlineRooms(callbacks: Callbacks) {
  const dialog = document.createElement('dialog');
  dialog.className = 'online-room';
  dialog.setAttribute('aria-labelledby', 'online-room-title');
  dialog.innerHTML = `
    <header class="online-hero">
      <img alt="" draggable="false">
      <div><p data-room-region>LET THEM COOK</p><h2 id="online-room-title">Online Rooms</h2></div>
      <button type="button" data-close-online aria-label="Close Online Rooms">×</button>
    </header>
    <section data-room-entry>
      <div class="online-entry-options">
        <div class="online-entry-card">
          <h3>Host a game</h3>
          <p>Invite friends to your room. Bots fill any open seats.</p>
          <label class="online-region" data-region-controls hidden>
            <span>Server region</span>
            <select aria-describedby="online-region-help"><option value="">Auto</option></select>
          </label>
          <p id="online-region-help" role="status" hidden></p>
          <button type="button" class="online-gold" data-create-room>Create private room</button>
        </div>
        <form class="online-entry-card" data-join-room>
          <h3>Join a friend</h3>
          <label for="online-code">Room code or invite link</label>
          <div class="online-code-entry"><input id="online-code" name="room" maxlength="512" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" required>
          <button type="submit">Join</button></div>
        </form>
      </div>
    </section>
    <section data-room-party hidden>
      <div class="online-party-grid">
        <div class="online-lineup">
          <div class="online-lineup-heading"><h3>Party</h3><span data-room-count></span></div>
          <ol class="online-seats" aria-label="Room seats and Viber selection"></ol>
          <p class="online-pick-hint" data-room-pick>Tap a bot portrait to switch Vibers.</p>
          <details class="online-guide" data-room-guide>
            <summary>How to play</summary>
            <p>Use WASD or arrow keys, or drag left of center on touch. Bump a rival to pass the cooker before it vents. Dodge the trolleys.</p>
          </details>
        </div>
        <div class="online-invite">
          <span>Room code</span>
          <code data-room-code></code>
          <div class="online-share-actions">
            <button type="button" data-copy-invite>Copy invite</button>
            <button type="button" data-share-invite hidden>Share</button>
          </div>
          <label class="online-manual" data-manual-invite hidden>Invite link
            <input type="url" readonly aria-label="Invite link">
          </label>
        </div>
      </div>
      <p class="online-phase" role="status" data-room-phase></p>
      <footer class="online-actions">
        <button type="button" class="online-leave" data-leave-room>Leave room</button>
        <button type="button" data-reopen-room hidden>Reopen for invites</button>
        <button type="button" class="online-gold" data-room-action>Ready</button>
      </footer>
    </section>
    <p class="online-notice" role="status" data-room-notice></p>
    <section class="online-confirm" aria-labelledby="online-confirm-title" hidden>
      <h3 id="online-confirm-title">Leave this match?</h3>
      <p>You’ll give up your seat. The round continues for the party.</p>
      <div><button type="button" data-confirm-leave>Leave match</button>
      <button type="button" class="online-gold" data-keep-seat>Keep playing</button></div>
    </section>`;
  document.body.append(dialog);
  const get = <T extends HTMLElement = HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
  const roomAction = get<HTMLButtonElement>('[data-room-action]');
  const createButton = get<HTMLButtonElement>('[data-create-room]');
  const form = get<HTMLFormElement>('[data-join-room]');
  const codeInput = get<HTMLInputElement>('#online-code');
  const tiles = get('.online-seats');
  const closeButton = get<HTMLButtonElement>('[data-close-online]');
  const manualInvite = get('[data-manual-invite]');
  const shareButton = get<HTMLButtonElement>('[data-share-invite]');
  const regionChoice = get<HTMLSelectElement>('.online-region select');
  const regionHelp = get('#online-region-help');
  const confirm = get('[data-keep-seat]').closest<HTMLElement>('section')!;
  get<HTMLImageElement>('.online-hero img').src = callbacks.cover;
  shareButton.hidden = typeof navigator.share !== 'function';
  let room: Room | undefined;
  let view: RoomView | undefined;
  let busy = false;
  let connected = false;
  let awaitingSnapshot = false;
  let attempt = 0;
  let sequence = 0;
  let lastInputAt = -Infinity;
  let lastInput: Vec = { x: 0, z: 0 };
  let frameTick = -1;
  let connectionMessage = '';
  let reconnectTimer: number | undefined;
  let directory: RegionDirectory = {
    home: 'local', regions: [{ id: 'local', label: 'Local server', origin: location.origin }],
  };
  let configuredDirectory = false;
  let directoryRequest: Promise<void> | undefined;
  const pings = new Map<string, number | null>();
  let pingRequest: Promise<void> | undefined;
  let lastPingAt = -Infinity;
  let activeRegion: GameRegion | undefined;
  let activePing: number | undefined;

  function notice(message: string) { get('[data-room-notice]').textContent = message; }
  function storage(value?: string) {
    try {
      if (value === undefined) return sessionStorage.getItem(SESSION);
      if (value) sessionStorage.setItem(SESSION, value);
      else sessionStorage.removeItem(SESSION);
    } catch { /* Storage is optional. */ }
    return null;
  }

  function reconnectToken(route: RoomRoute): string | undefined {
    const saved = storage();
    if (saved?.startsWith(route.code + ':') && route.region.origin === location.origin) return saved;
    try {
      const seat = JSON.parse(saved ?? 'null');
      if (seat?.region === route.region.id && seat.origin === route.region.origin && seat.code === route.code &&
        typeof seat.token === 'string' && seat.token.startsWith(route.code + ':')) return seat.token;
    } catch { /* An invalid local seat can be joined normally. */ }
  }

  function saveSeat(joined: Room, region: GameRegion) {
    storage(JSON.stringify({ region: region.id, origin: region.origin, code: joined.roomId, token: joined.reconnectionToken }));
  }

  async function fetchDirectory() {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch('/regions.json', { cache: 'no-store', signal: controller.signal });
      const configured = response.ok ? parseRegionDirectory(await response.json()) : undefined;
      if (!configured) return;
      directory = configured;
      configuredDirectory = true;
      for (const region of directory.regions) regionChoice.add(new Option(region.label, region.id));
      get('[data-region-controls]').hidden = directory.regions.length < 2;
    } catch { /* Single-server and older previews can still use their own origin. */ }
    finally { window.clearTimeout(timeout); }
  }

  function loadDirectory() {
    return directoryRequest ??= fetchDirectory();
  }

  function updateRegionLabels() {
    const preferred = preferredRegion(directory, pings);
    const fastest = pings.get(preferred.id);
    const finished = pings.size === directory.regions.length;
    regionChoice.options[0].textContent = finished && fastest != null ? 'Auto · ' + preferred.label + ' · ' + fastest + ' ms' : 'Auto';
    for (const region of directory.regions) {
      const option = [...regionChoice.options].find(item => item.value === region.id);
      if (!option) continue;
      const ping = pings.get(region.id);
      option.textContent = region.label + (ping === undefined ? ' · checking…' : ping === null ? ' · no reply' : ' · ' + ping + ' ms');
    }
    const noReply = finished && fastest === null;
    regionHelp.hidden = !noReply;
    if (noReply) regionHelp.textContent = 'No ping reply yet. A server may be waking up.';
  }

  function checkPing() {
    if (directory.regions.length < 2 || pingRequest || performance.now() - lastPingAt < 60000) return pingRequest;
    pings.clear();
    updateRegionLabels();
    pingRequest = Promise.all(directory.regions.map(async region => {
      try {
        pings.set(region.id, Math.round(await new Client(region.origin).getLatency({ pingCount: 3, timeout: 2200 })));
      } catch { pings.set(region.id, null); }
      updateRegionLabels();
    })).then(() => {
      lastPingAt = performance.now();
      pingRequest = undefined;
    });
    return pingRequest;
  }

  function roomCode(code: string, region: GameRegion | undefined = activeRegion): string {
    return configuredDirectory && region ? region.id + ':' + code : code;
  }

  function showRoomRegion() {
    const text = configuredDirectory && activeRegion
      ? ' · ' + activeRegion.label + (activePing === undefined ? '' : ' · ' + activePing + ' ms') : '';
    get('[data-room-region]').textContent = 'LET THEM COOK' + text;
  }

  function invite(code: string) {
    const url = new URL(location.pathname, location.origin);
    url.searchParams.set('room', code);
    if (configuredDirectory && activeRegion) url.searchParams.set('region', activeRegion.id);
    return url.href;
  }

  function updateAddress(code?: string) {
    const url = new URL(location.href);
    if (code) url.searchParams.set('room', code);
    else url.searchParams.delete('room');
    if (code && configuredDirectory && activeRegion) url.searchParams.set('region', activeRegion.id);
    else url.searchParams.delete('region');
    history.replaceState(null, '', url);
  }

  function render() {
    get('[data-room-entry]').hidden = !!view || !confirm.hidden;
    get('[data-room-party]').hidden = !view || !confirm.hidden;
    get('[data-room-notice]').hidden = !confirm.hidden;
    get('h2').textContent = view ? 'Private room' : 'Online Rooms';
    closeButton.hidden = !!room && (!view || view.phase === 'waiting') && confirm.hidden;
    closeButton.setAttribute('aria-label', view ? 'Close room panel' : busy ? 'Cancel room connection' : 'Close Online Rooms');
    createButton.disabled = codeInput.disabled = get<HTMLButtonElement>('[type="submit"]').disabled = busy;
    regionChoice.disabled = busy;
    showRoomRegion();
    if (!view) return;
    const state = view;
    const isHost = state.host === state.you;
    const ready = state.seats[state.you].ready;
    const selecting = state.phase === 'waiting';
    const wait = waitingFor(state);
    const people = state.seats.filter(seat => seat.kind === 'human' || seat.kind === 'away').length;
    get('[data-room-code]').textContent = roomCode(state.code);
    get('[data-room-count]').textContent = people + ' / ' + state.seats.length + ' players';
    get('.online-invite').hidden = !selecting;
    get<HTMLButtonElement>('[data-copy-invite]').disabled = shareButton.disabled = !selecting || !connected;
    get('[data-room-pick]').hidden = !selecting;
    get('[data-room-guide]').hidden = !selecting;
    if (!selecting) manualInvite.hidden = true;
    const focused = tiles.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.onlineViber : undefined;
    tiles.replaceChildren(...state.seats.map((seat, index) => {
      const tile = document.createElement('li');
      tile.toggleAttribute('data-you', index === state.you);
      tile.dataset.kind = seat.kind;
      tile.style.setProperty('--seat-accent', VIBERS[seat.viber].color);
      const picture = new Image();
      const viber = VIBERS[seat.viber];
      picture.src = viber.portrait;
      picture.alt = '';
      const name = document.createElement('strong');
      name.textContent = viber.name;
      const role = document.createElement('span');
      role.textContent = seat.kind === 'bot' ? 'Bot' : seat.kind === 'away' ? 'Reconnecting' : seat.kind === 'left' ? 'Left' :
        index === state.host ? (index === state.you ? 'You · Host' : 'Host') :
          index === state.you ? (seat.ready ? 'You · Ready' : 'You') : seat.ready ? 'Ready' : selecting ? 'Picking a Viber' : 'Player';
      tile.toggleAttribute('data-ready', seat.ready);
      if (selecting && seat.kind === 'bot' && connected) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.onlineViber = String(seat.viber);
        button.setAttribute('aria-label', 'Play as ' + viber.name);
        button.append(picture, name, role);
        button.addEventListener('click', () => message('viber', seat.viber));
        tile.append(button);
      } else tile.append(picture, name, role);
      return tile;
    }));
    const phase = get('[data-room-phase]');
    const nextPhase = connectionMessage || (selecting
      ? isHost ? wait || (people === 1 ? 'Invite friends or start with bots.' : 'Your party is ready.') :
        ready ? 'You’re ready. The host starts the match.' : 'Choose your Viber, then ready up.'
      : state.phase === 'playing' ? 'Match in progress.' :
        isHost ? 'Reopen the room to change Vibers or invite more players.' : 'The host can reopen the room for new invites.');
    if (phase.textContent !== nextPhase) phase.textContent = nextPhase;
    roomAction.textContent = selecting ? isHost ? 'Start match' : ready ? 'Cancel ready' : 'Ready' :
      state.phase === 'playing' ? 'Return to match' : 'Return to results';
    roomAction.disabled = selecting && (!connected || isHost && !!wait);
    const reopen = get<HTMLButtonElement>('[data-reopen-room]');
    reopen.hidden = state.phase !== 'results' || !isHost;
    reopen.disabled = !connected;
    if (focused !== undefined) {
      const button = tiles.querySelector<HTMLButtonElement>('[data-online-viber="' + focused + '"]');
      (button ?? (roomAction.disabled ? tiles.querySelector('button') ?? get('[data-leave-room]') : roomAction))
        .focus({ preventScroll: true });
    }
  }

  function updateConnection(message: string) {
    const changed = connectionMessage !== message;
    connectionMessage = message;
    if (changed) {
      if (view && !connected) {
        const phase = get('[data-room-phase]');
        if (phase.textContent !== message) phase.textContent = message;
      } else if (!view && message) notice(message);
    }
    callbacks.connection(message);
  }

  function close() {
    confirm.hidden = true;
    if (dialog.open) dialog.close();
  }

  function open() {
    if (!dialog.open) dialog.showModal();
    render();
    if (!room && !busy) void loadDirectory().then(() => {
      if (dialog.open && !room && !busy) void checkPing();
    });
  }

  function attach(joined: Room, region: GameRegion) {
    room = joined;
    activeRegion = region;
    activePing = undefined;
    connected = false;
    awaitingSnapshot = true;
    joined.reconnection.minUptime = 0;
    joined.reconnection.maxDelay = 1500;
    joined.reconnection.maxEnqueuedMessages = 0;
    sequence = 0;
    frameTick = -1;
    saveSeat(joined, region);
    updateAddress(joined.roomId);
    updateConnection('Syncing room…');
    joined.onMessage('room', (state: RoomView) => {
      if (room !== joined) return;
      if (state.phase !== view?.phase) notice('');
      if (view?.round !== state.round) {
        sequence = 0;
        lastInputAt = -Infinity;
        frameTick = -1;
      }
      view = state;
      if (awaitingSnapshot && state.phase === 'waiting') finishSync();
      render();
      callbacks.room(state);
    });
    joined.onMessage('notice', (message: string) => {
      if (room !== joined) return;
      if (dialog.open) notice(message);
      else callbacks.actionNotice(message);
    });
    joined.onMessage('snapshot', (snapshot: Snapshot) => {
      if (room !== joined || snapshot.round !== view?.round || snapshot.view.tick < frameTick) return;
      if (snapshot.view.tick === frameTick && snapshot.view.events.length) return;
      frameTick = snapshot.view.tick;
      sequence = Math.max(sequence, snapshot.acknowledgments[view.you] + 1);
      if (awaitingSnapshot) finishSync();
      callbacks.snapshot(snapshot);
    });
    joined.onDrop(() => {
      if (room !== joined) return;
      connected = false;
      activePing = undefined;
      awaitingSnapshot = false;
      window.clearInterval(reconnectTimer);
      const expires = performance.now() + RECONNECT_SECONDS * 1000;
      const update = () => {
        const seconds = Math.max(0, Math.ceil((expires - performance.now()) / 1000));
        updateConnection(seconds ? 'Reconnecting… Seat held for ' + seconds + 's.' : 'Reconnecting…');
      };
      update();
      render();
      reconnectTimer = window.setInterval(update, 1000);
    });
    joined.onReconnect(() => {
      if (room !== joined) return;
      awaitingSnapshot = true;
      window.clearInterval(reconnectTimer);
      saveSeat(joined, region);
      updateConnection('Syncing match…');
      joined.send('sync');
    });
    joined.onLeave(() => {
      if (room !== joined) return;
      const code = roomCode(joined.roomId, region);
      forget();
      callbacks.left();
      codeInput.value = code;
      open();
      notice('Connection lost. Try the same room code, or start a new room.');
      codeInput.focus();
    });
    joined.send('sync');
  }

  function finishSync() {
    awaitingSnapshot = false;
    connected = true;
    notice('');
    updateConnection('');
    render();
    const synced = room;
    if (configuredDirectory) synced?.ping(ms => {
      if (room !== synced || !connected) return;
      activePing = ms;
      showRoomRegion();
    });
  }

  function forget() {
    room = undefined;
    view = undefined;
    connected = false;
    activeRegion = undefined;
    activePing = undefined;
    awaitingSnapshot = false;
    confirm.hidden = true;
    manualInvite.hidden = true;
    window.clearInterval(reconnectTimer);
    storage('');
    updateAddress();
    updateConnection('');
  }

  async function reclaimSeat(client: Client, token: string, current: number): Promise<Room | undefined> {
    const until = performance.now() + RECONNECT_SECONDS * 1000;
    while (current === attempt) {
      try {
        return await client.reconnect(token);
      } catch (error) {
        if (performance.now() + 1000 >= until) throw error;
        // A refresh can reach matchmaking before the old socket has closed.
        await new Promise(resolve => window.setTimeout(resolve, 1000));
      }
    }
  }

  async function enter(input?: string, fromInvite = false) {
    if (busy || room) return;
    busy = true;
    const current = ++attempt;
    open();
    notice(input === undefined ? 'Finding a server…' : 'Opening room…');
    const viber = VIBERS.indexOf(callbacks.selected());
    let reconnect: string | undefined;
    try {
      await loadDirectory();
      if (current !== attempt) return;
      const route = input === undefined ? undefined : readRoomRoute(input, directory);
      if (input !== undefined && !route) {
        notice(fromInvite ? 'This invite is incomplete or its server is unavailable. Ask your friend for a new link or room code.' :
          'Enter a valid room code or invite link for an available server.');
        return;
      }
      const selected = directory.regions.find(region => region.id === regionChoice.value);
      if (!route && !selected) await checkPing();
      if (current !== attempt) return;
      const region = route?.region ?? selected ?? preferredRegion(directory, pings);
      const client = new Client(region.origin);
      reconnect = route && reconnectToken(route);
      if (route) codeInput.value = roomCode(route.code, region);
      notice(reconnect ? 'Rejoining your room…' : route ? 'Joining room…' : 'Creating room…');
      let joined: Room | undefined;
      if (reconnect) {
        joined = await reclaimSeat(client, reconnect, current);
      } else if (route) {
        joined = await client.joinById(route.code, { viber });
      } else {
        joined = await client.create(ROOM_TYPE, { viber });
      }
      if (!joined) return;
      if (current === attempt) attach(joined, region);
      else void joined.leave().catch(() => {});
    } catch {
      if (current !== attempt) return;
      if (reconnect) storage('');
      notice(reconnect ? 'Your saved seat expired. Try joining the room again.' :
        input !== undefined ? 'Could not join. The server may be waking up, or the room may be full, closed, or in a match.' :
          'Could not create a room. Check your connection and try again.');
    } finally {
      if (current === attempt) {
        busy = false;
        render();
        if (!room) (input === undefined ? createButton : codeInput).focus();
      }
    }
  }

  function message(type: string, value?: unknown) {
    if (room && connected) room.send(type, value);
  }

  function dismiss() {
    if (!confirm.hidden) {
      confirm.hidden = true;
      render();
      get('[data-leave-room]').focus();
    } else if (!room || view && view.phase !== 'waiting') {
      if (busy) {
        attempt++;
        busy = false;
        if (connectionMessage) updateConnection('');
        notice('');
        render();
      }
      if (!room) {
        updateAddress();
        notice('');
      }
      close();
    }
  }

  closeButton.addEventListener('click', dismiss);
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  createButton.addEventListener('click', () => void enter());
  form.addEventListener('submit', event => {
    event.preventDefault();
    void enter(codeInput.value);
  });
  function revealInvite(url: string) {
    if (!view || view.phase !== 'waiting') return;
    manualInvite.hidden = false;
    const field = manualInvite.querySelector('input')!;
    field.value = url;
    field.focus();
    field.select();
    notice('Select and copy the invite link, or share the room code.');
  }

  get('[data-copy-invite]').addEventListener('click', async () => {
    if (!view || !connected) return;
    const url = invite(view.code);
    try {
      await navigator.clipboard.writeText(url);
      if (view && invite(view.code) === url) {
        manualInvite.hidden = true;
        notice('Invite copied.');
      }
    } catch {
      if (view && invite(view.code) === url) revealInvite(url);
    }
  });
  shareButton.addEventListener('click', async () => {
    if (!view || !connected) return;
    const url = invite(view.code);
    try {
      await navigator.share({ title: 'Let Them Cook · Viber Mayhem', text: 'Join my private room', url });
    } catch (error) {
      if (view && invite(view.code) === url && !(error instanceof DOMException && error.name === 'AbortError')) revealInvite(url);
    }
  });
  roomAction.addEventListener('click', () => {
    if (!view) return;
    callbacks.activate();
    if (view.phase !== 'waiting') {
      close();
    } else if (view.you === view.host) {
      message('start');
    } else {
      message('ready', !view.seats[view.you].ready);
    }
  });
  function leave() {
    const leaving = room;
    forget();
    void leaving?.leave().catch(() => {});
    callbacks.left();
    render();
    notice('You left the room.');
    createButton.focus();
  }
  get('[data-reopen-room]').addEventListener('click', () => {
    notice('');
    message('waiting');
  });
  get('[data-leave-room]').addEventListener('click', () => {
    if (view?.phase !== 'playing') return leave();
    confirm.hidden = false;
    render();
    get('[data-keep-seat]').focus();
  });
  get('[data-confirm-leave]').addEventListener('click', leave);
  get('[data-keep-seat]').addEventListener('click', dismiss);

  return {
    open, close,
    get state() { return view; },
    get connected() { return connected; },
    get showing() { return dialog.open; },
    waitingFor,
    startFromLink() {
      const code = new URLSearchParams(location.search).get('room');
      if (code === null) return;
      codeInput.value = code;
      void enter(location.href, true);
    },
    rematch() {
      if (!view) return;
      if (view.you === view.host) message('start');
      else message('ready', !view.seats[view.you].ready);
    },
    sendInput(vec: Vec, now: number) {
      if (!view || view.phase !== 'playing' || !connected) return;
      const changed = vec.x !== lastInput.x || vec.z !== lastInput.z;
      const releasing = changed && vec.x === 0 && vec.z === 0;
      if (!releasing && now - lastInputAt < (changed ? 16 : 50)) return;
      lastInputAt = now;
      lastInput = vec;
      const sent = sequence++;
      message('input', { round: view.round, sequence: sent, ...vec });
      return sent;
    },
  };
}
