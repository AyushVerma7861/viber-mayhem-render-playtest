export type PingReading = number | 'checking' | 'no-reply' | 'reconnecting';

const labels = {
  checking: 'Checking',
  'no-reply': 'No reply',
  reconnecting: 'Reconnecting',
};
const preview: readonly PingReading[] = [34, 41, 78, 126, 213, 248, 'reconnecting', 'reconnecting', 64, 38];

export function pingQuality(milliseconds: number): 'good' | 'fair' | 'slow' {
  return milliseconds < 100 ? 'good' : milliseconds < 180 ? 'fair' : 'slow';
}

export function pingText(reading: PingReading): string {
  return typeof reading === 'number' ? reading + ' ms' : labels[reading];
}

export function previewPing(elapsed: number): PingReading {
  return preview[Math.floor(Math.max(0, elapsed) / 1500) % preview.length];
}

export function createPingIndicator(badge: HTMLElement): (reading: PingReading) => void {
  const value = badge.querySelector<HTMLElement>('#online-ping-value')!;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let previous: PingReading | undefined;

  return reading => {
    if (reading === previous) return;
    previous = reading;
    const quality = typeof reading === 'number' ? pingQuality(reading) : reading;
    const changed = badge.dataset.quality !== quality;
    badge.dataset.quality = quality;
    value.textContent = pingText(reading);
    if (changed && !badge.hidden && !reducedMotion.matches) {
      value.getAnimations().forEach(animation => animation.cancel());
      value.animate([
        { opacity: .48, transform: 'translateY(3px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 235, easing: 'ease-out' });
    }
  };
}
