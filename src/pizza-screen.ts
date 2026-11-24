import type { PizzaFrameMessage, PizzaHostMessage } from '../pizza-party/network-state.ts';

export function createPizzaScreen(handle: (message: PizzaFrameMessage) => void) {
  let frame: HTMLIFrameElement | undefined;
  let loaded = false;
  let pending = new Map<PizzaHostMessage['type'], PizzaHostMessage>();
  let loading: HTMLElement | undefined;

  function send(message: PizzaHostMessage) {
    if (!frame) return;
    if (loaded) frame.contentWindow?.postMessage(message, location.origin);
    else pending.set(message.type, message);
  }

  function close() {
    frame?.remove();
    loading?.remove();
    frame = undefined;
    loading = undefined;
    loaded = false;
    pending.clear();
  }

  function open(you: number, roster: readonly number[], round?: number) {
    close();
    frame = document.createElement('iframe');
    frame.id = 'pizza-screen';
    frame.title = 'Pizza Party match';
    frame.allow = 'autoplay; fullscreen';
    frame.allowFullscreen = true;
    frame.hidden = true;
    const url = new URL('/pizza/', location.href);
    url.searchParams.set('you', String(you));
    url.searchParams.set('roster', roster.join(','));
    if (round !== undefined) url.searchParams.set('online', String(round));
    const query = new URLSearchParams(location.search);
    if (query.has('debug')) url.searchParams.set('debug', '1');
    if (round === undefined && query.has('seed')) url.searchParams.set('seed', query.get('seed')!);
    frame.src = url.href;
    loading = document.createElement('div');
    loading.id = 'pizza-loading';
    loading.innerHTML = '<p role="status">Opening Pizza Party…</p><button type="button" class="small">Back</button>';
    loading.querySelector('button')!.addEventListener('click', () => handle({ type: round === undefined ? 'back' : 'room' }));
    document.body.append(loading, frame);
  }

  function focus() {
    if (frame && loaded) frame.focus({ preventScroll: true });
  }

  window.addEventListener('message', event => {
    if (!frame || event.source !== frame.contentWindow || event.origin !== location.origin ||
        !event.data || typeof event.data !== 'object') return;
    const message = event.data as PizzaFrameMessage;
    if (message.type !== 'ready') {
      if (loaded) handle(message);
      return;
    }
    loaded = true;
    loading?.remove();
    frame.hidden = false;
    for (const message of pending.values()) send(message);
    pending.clear();
    if (!document.querySelector('dialog[open]')) focus();
  });

  return { open, close, send, focus, get showing() { return !!frame; } };
}
