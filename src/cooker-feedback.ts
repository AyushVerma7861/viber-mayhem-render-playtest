export const COOKER_ICON = `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M13 21h22v12a7 7 0 0 1-7 7h-8a7 7 0 0 1-7-7V21Z" fill="currentColor"/><path d="M10 21h28M18 17h12M21 13h6M9 25H5v8h7m24-8h7v8h-7M18 9c-4-4 4-5 0-8m12 8c-4-4 4-5 0-8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="24" cy="29" r="5" fill="#fff5dd"/><path d="m24 29 3-3" stroke="#574239" stroke-width="2"/></svg>`;

export function makeCookerPanel(panel: HTMLElement) {
  const owner = panel.querySelector('#fuse-label')!;
  const clock = panel.querySelector('#clock')!;
  const meter = panel.querySelector('.meter')!;
  panel.classList.add('cooker-pressure');
  panel.replaceChildren();
  const dial = document.createElement('div');
  dial.className = 'pressure-dial';
  dial.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="53" r="43" fill="#fff4d8"/><path d="M18 72 A37 37 0 0 1 18 35" stroke="#64b39a"/><path d="M18 35 A37 37 0 0 1 82 35" stroke="#f0b45e"/><path d="M82 35 A37 37 0 0 1 82 72" stroke="#e87c58"/><g class="pressure-needle"><path d="M50 59 47 49 50 21 53 49Z" fill="#533b33"/><circle cx="50" cy="53" r="5" fill="#533b33"/></g></svg><strong id="pressure-value">0<span>%</span></strong>`;
  const copy = document.createElement('div');
  copy.className = 'pressure-copy';
  const caption = document.createElement('span');
  caption.className = 'pressure-caption'; caption.textContent = 'COOKER PRESSURE';
  const phase = document.createElement('strong'); phase.id = 'pressure-phase';
  const countdown = document.createElement('div'); countdown.className = 'pressure-countdown';
  const hint = document.createElement('span'); hint.textContent = 'to vent';
  countdown.append(clock, hint);
  copy.append(caption, phase, owner, countdown, meter);
  panel.append(dial, copy);
  panel.setAttribute('aria-label', 'Pressure cooker');
  const value = panel.querySelector('#pressure-value')!;
  return {
    update(remaining: number, total: number, hasCooker: boolean, ready: boolean): void {
      const pressure = hasCooker ? Math.max(0, Math.min(1, 1 - remaining / total)) : 0;
      const state = !hasCooker ? 'waiting' : pressure < 0.4 ? 'simmer' : pressure < 0.72 ? 'building' : pressure < 0.9 ? 'rattling' : 'venting';
      panel.dataset.heat = state;
      panel.style.setProperty('--pressure-angle', (-120 + pressure * 240) + 'deg');
      value.innerHTML = Math.round(pressure * 100) + '<span>%</span>';
      phase.textContent = !hasCooker ? ready ? 'Ready to simmer' : 'Fresh cooker…' :
        state === 'simmer' ? 'Simmering' : state === 'building' ? 'Pressure rising' : state === 'rattling' ? 'Lid is rattling!' : 'About to vent!';
    },
  };
}
