export type Vec = { x: number; z: number };
export type Polygon = readonly Vec[];

export const PLAYER_RADIUS = 0.2814;
export const PLATE_REACH = 0.602;
export const PLATE_RADIUS = 0.221;

export const FLOOR_WIDTH = 12.5;
export const FLOOR_DEPTH = 7.05;
const halfWidth = FLOOR_WIDTH / 2;
const halfDepth = FLOOR_DEPTH / 2;
const corner = 0.88;
const sideRecess = halfWidth - 0.40;
const northWindows = [-2.73, 2.64] as const;
const southWindows = [-3.06, 2.94] as const;
const windowSetback = 0.49;

function windowPocket(x: number, edge: -1 | 1): Polygon {
  return [
    { x: x + edge * 1.40, z: edge * halfDepth },
    { x: x + edge * 1.30, z: edge * (halfDepth - 0.96) },
    { x: x - edge * 1.30, z: edge * (halfDepth - 0.96) },
    { x: x - edge * 1.40, z: edge * halfDepth },
  ];
}

export const WALK_BOUNDARY: Polygon = [
  { x: -halfWidth + corner, z: -halfDepth },
  ...windowPocket(northWindows[0], -1), ...windowPocket(northWindows[1], -1),
  { x: halfWidth - corner, z: -halfDepth },
  { x: halfWidth, z: -halfDepth + corner }, { x: halfWidth, z: -1.39 },
  { x: sideRecess, z: -0.99 }, { x: sideRecess, z: 0.24 }, { x: halfWidth, z: 0.64 },
  { x: halfWidth, z: halfDepth - corner },
  { x: halfWidth - corner, z: halfDepth },
  ...windowPocket(southWindows[1], 1), ...windowPocket(southWindows[0], 1),
  { x: -halfWidth + corner, z: halfDepth },
  { x: -halfWidth, z: halfDepth - corner }, { x: -halfWidth, z: 1.39 },
  { x: -sideRecess, z: 0.99 }, { x: -sideRecess, z: -0.24 }, { x: -halfWidth, z: -0.64 },
  { x: -halfWidth, z: -halfDepth + corner },
];

function prepStation(center: Vec, width: number, depth: number, clip: number) {
  const left = center.x - width / 2;
  const right = center.x + width / 2;
  const north = center.z - depth / 2;
  const south = center.z + depth / 2;
  const points: Polygon = [
    { x: left + clip, z: north }, { x: right - clip, z: north },
    { x: right, z: north + clip }, { x: right, z: south - clip },
    { x: right - clip, z: south }, { x: left + clip, z: south },
    { x: left, z: south - clip }, { x: left, z: north + clip },
  ];
  return { center, width, left, right, south, points };
}

// Two ingredient tables flank an offset warming station, leaving a crossing on either side.
export const SOLIDS = [
  prepStation({ x: -3.60, z: 0.16 }, 2.38, 1.58, 0.28),
  prepStation({ x: -0.14, z: 0.08 }, 2.02, 1.45, 0.21),
  prepStation({ x: 3.34, z: -0.18 }, 2.38, 1.62, 0.27),
] as const;

export const CROSSINGS = SOLIDS.slice(1).map((station, index) => {
  const west = SOLIDS[index];
  return { x: (west.right + station.left) / 2, z: (west.center.z + station.center.z) / 2, width: station.left - west.right };
});

export function crossingAt({ x, z }: Vec): number {
  return CROSSINGS.findIndex(lane => Math.abs(x - lane.x) < lane.width / 2 && Math.abs(z - lane.z) < 0.93);
}

export const SUPPLY_RECTS = [SOLIDS[0], SOLIDS[2]].flatMap(({ center }) =>
  [-1, 1].map(end => {
    const side = -end;
    return {
      center: { x: center.x + end * 0.55, z: center.z + side * 0.40 },
      halfWidth: 0.46, halfDepth: 0.20, side,
    };
  }),
);

export function offset(origin: Vec, direction: Vec, amount: number): Vec {
  return { x: origin.x + direction.x * amount, z: origin.z + direction.z * amount };
}

function servingWindow(center: Vec, inward: Vec) {
  const tangent = { x: inward.z, z: -inward.x };
  return {
    center, inward, tangent,
    trigger: offset(center, inward, 0.67),
    halfWidth: inward.x ? 0.14 : 1.24,
    halfDepth: inward.z ? 0.14 : 1.24,
  };
}

export const COUNTERS = [
  servingWindow({ x: southWindows[0], z: halfDepth - windowSetback }, { x: 0, z: -1 }),
  servingWindow({ x: northWindows[1], z: -halfDepth + windowSetback }, { x: 0, z: 1 }),
  servingWindow({ x: southWindows[1], z: halfDepth - windowSetback }, { x: 0, z: -1 }),
  servingWindow({ x: northWindows[0], z: -halfDepth + windowSetback }, { x: 0, z: 1 }),
];
export const SPAWNS: readonly Vec[] = COUNTERS.map(({ center, inward }) => offset(center, inward, 1.55));
export const HOMES: readonly Vec[] = COUNTERS.map(counter => counter.center);
export const SUPPLY_POINTS: readonly Vec[] = SUPPLY_RECTS.map(supply => supply.center);

export type Approach = { action: 'pickup' | 'serve'; station: number; position: Vec; face: Vec };
const pickupReach = PLATE_REACH + PLATE_RADIUS - 0.008;
export const APPROACHES: readonly Approach[] = [
  ...SUPPLY_RECTS.map(({ center, halfDepth, side }, station) => ({
    action: 'pickup' as const, station, position: offset(center, { x: 0, z: side }, pickupReach + halfDepth), face: center,
  })),
  ...COUNTERS.flatMap(({ trigger, inward, tangent }, station) => [-0.59, 0.59].map(lane => {
    const face = offset(trigger, tangent, lane);
    return { action: 'serve' as const, station, position: offset(face, inward, 0.71), face };
  })),
];

export const SUPPLY_GOALS = SUPPLY_RECTS.map((_, i) => [i] as const);
export const COUNTER_GOALS = COUNTERS.map((_, i) => [
  SUPPLY_RECTS.length + 2 * i, SUPPLY_RECTS.length + 2 * i + 1,
] as const);
