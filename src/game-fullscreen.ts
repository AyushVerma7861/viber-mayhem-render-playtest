type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};

type FullscreenRoot = HTMLElement & {
  webkitRequestFullscreen?: () => void;
};

type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: 'landscape') => Promise<void>;
};

export function createGameFullscreen(
  target: FullscreenRoot,
  onChange: (active: boolean) => void,
  showNotice: (message: string) => void,
) {
  const page: FullscreenDocument = document;
  const touch = matchMedia('(pointer: coarse)');
  const portrait = matchMedia('(orientation: portrait)');
  const orientation: LockableOrientation | undefined = screen.orientation;
  const fullscreenElement = () => page.fullscreenElement ?? page.webkitFullscreenElement;
  const rotateHint = 'Rotate your device for landscape.';
  let active = !!fullscreenElement();
  let triedOnLaunch = false;
  let entering = false;
  let requestedLandscape = false;

  async function lockLandscape() {
    if (!touch.matches) return;
    if (orientation?.lock) {
      requestedLandscape = true;
      try {
        await orientation.lock('landscape');
        return;
      } catch { /* The player can rotate the device themselves. */ }
    }
    if (active && portrait.matches) showNotice(rotateHint);
  }

  function sync() {
    const next = !!fullscreenElement();
    if (next === active) return;
    active = next;
    onChange(active);
    if (active) {
      triedOnLaunch = true;
      void lockLandscape();
    } else if (requestedLandscape) {
      requestedLandscape = false;
      try { orientation?.unlock?.(); } catch { /* The browser may already have unlocked it. */ }
    }
  }

  function unavailable(manual: boolean) {
    queueMicrotask(() => {
      const canRotate = touch.matches && portrait.matches;
      if (manual) showNotice('Fullscreen is unavailable here.' + (canRotate ? ' ' + rotateHint : ''));
      else if (canRotate) showNotice(rotateHint);
    });
  }

  async function enter(manual: boolean) {
    if (fullscreenElement() || entering) return;
    if (!target.requestFullscreen && !target.webkitRequestFullscreen) return unavailable(manual);
    entering = true;
    try {
      if (target.requestFullscreen) await target.requestFullscreen({ navigationUI: 'hide' });
      else target.webkitRequestFullscreen?.();
    } catch {
      unavailable(manual);
    } finally {
      entering = false;
    }
  }

  page.addEventListener('fullscreenchange', sync);
  page.addEventListener('webkitfullscreenchange', sync);

  return {
    get active() { return !!fullscreenElement(); },
    enterOnLaunch() {
      if (triedOnLaunch) return;
      triedOnLaunch = true;
      void enter(false);
    },
    async toggle() {
      triedOnLaunch = true;
      if (!fullscreenElement()) return enter(true);
      try {
        const exit = page.fullscreenElement ? page.exitFullscreen : page.webkitExitFullscreen;
        await exit?.call(page);
      } catch {
        showNotice('Could not exit fullscreen. Use your browser’s fullscreen controls.');
      }
    },
  };
}
