export type Vec = { x: number; z: number };

type Lane = {
  duration: number;
  first: number;
  wait: readonly [number, number];
  color: string;
};

export type Arena = {
  bounds: Vec;
  spawns: readonly Vec[];
  routes: readonly [Lane, Lane];
  point: (lane: number, progress: number) => Vec;
  rotateSpawns?: boolean;
};

export const FREIGHT_ARENA: Arena = {
  bounds: { x: 9.4, z: 5.4 },
  spawns: [
    { x: -5.8, z: 3.5 }, { x: -5.8, z: -3.5 },
    { x: 5.8, z: -3.5 }, { x: 5.8, z: 3.5 },
  ],
  routes: [
    { duration: 267, first: 106, wait: [0.7, 2], color: '#ffbe65' },
    { duration: 247, first: 182, wait: [1.2, 4], color: '#64e1ee' },
  ],
  point(lane, progress) {
    const direction = lane === 0 ? 1 : -1;
    const x = direction * (-12.3 + 24.6 * progress);
    return { x, z: direction * (-2.03 + 0.87 * Math.sin(x * 0.30)) };
  },
};

// Oven to serving hatch. The return lane mirrors this curve through the center.
const serveCurves = [
  [
    { x: -5.75, z: -8.75 }, { x: -5.75, z: -5.85 },
    { x: -5.55, z: -3.25 }, { x: -2.55, z: -3.25 },
  ],
  [
    { x: -2.55, z: -3.25 }, { x: 0.85, z: -3.25 },
    { x: 5.60, z: -1.95 }, { x: 12.05, z: -1.95 },
  ],
] as const;

// Measure the curve once so the tight entry turn and long straight have the same speed.
const samples: (Vec & { distance: number })[] = [{ ...serveCurves[0][0], distance: 0 }];
for (const [a, b, c, d] of serveCurves) {
  for (let i = 1; i <= 96; i++) {
    const t = i / 96;
    const s = 1 - t;
    const x = s ** 3 * a.x + 3 * s ** 2 * t * b.x + 3 * s * t ** 2 * c.x + t ** 3 * d.x;
    const z = s ** 3 * a.z + 3 * s ** 2 * t * b.z + 3 * s * t ** 2 * c.z + t ** 3 * d.z;
    const prior = samples[samples.length - 1];
    samples.push({ x, z, distance: prior.distance + Math.hypot(x - prior.x, z - prior.z) });
  }
}

export const KITCHEN_ARENA: Arena = {
  bounds: { x: 9.65, z: 6.45 },
  spawns: [
    { x: -6.15, z: 4.65 }, { x: -6.85, z: -3.20 },
    { x: 6.15, z: -4.65 }, { x: 6.85, z: 3.20 },
  ],
  rotateSpawns: true,
  routes: [
    { ...FREIGHT_ARENA.routes[0], color: '#e96542' },
    { ...FREIGHT_ARENA.routes[1], color: '#168a8d' },
  ],
  point(lane, progress) {
    const distance = samples[samples.length - 1].distance * Math.max(0, Math.min(progress, 1));
    let low = 0;
    let high = samples.length - 1;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (samples[mid].distance <= distance) low = mid;
      else high = mid;
    }
    const a = samples[low];
    const b = samples[high];
    const t = (distance - a.distance) / (b.distance - a.distance);
    const direction = lane === 0 ? 1 : -1;
    return { x: direction * (a.x + (b.x - a.x) * t), z: direction * (a.z + (b.z - a.z) * t) };
  },
};

export function routeHeading(arena: Arena, lane: number, progress: number): number {
  let a = arena.point(lane, progress);
  const b = arena.point(lane, progress + 0.001);
  if (a.x === b.x && a.z === b.z) a = arena.point(lane, progress - 0.001);
  return Math.atan2(b.z - a.z, b.x - a.x);
}
