import { APPROACHES, FLOOR_DEPTH, FLOOR_WIDTH, PLAYER_RADIUS, crossingAt } from './layout.ts';
import type { Vec } from './layout.ts';
import { clear, distance, walkable } from './geometry.ts';

const STEP = 0.22;
const LEFT = -FLOOR_WIDTH / 2 - STEP;
const TOP = -FLOOR_DEPTH / 2 - STEP;
const WIDTH = Math.ceil((FLOOR_WIDTH + STEP * 2) / STEP);
const HEIGHT = Math.ceil((FLOOR_DEPTH + STEP * 2) / STEP);

const points = Array.from({ length: WIDTH * HEIGHT }, (_, id) => ({
  x: LEFT + id % WIDTH * STEP, z: TOP + Math.floor(id / WIDTH) * STEP,
}));
const valid = points.map(point => walkable(point, PLAYER_RADIUS + 0.025));
const crossings = points.map(crossingAt);
const links = points.map((_, id) => {
  const edges: { to: number; cost: number }[] = [];
  if (!valid[id]) return edges;
  const x = id % WIDTH, z = Math.floor(id / WIDTH);
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    if (x + dx < 0 || x + dx >= WIDTH || z + dz < 0 || z + dz >= HEIGHT) continue;
    const next = id + dz * WIDTH + dx;
    if (valid[next] && (!(dx && dz) || valid[id + dx] && valid[id + dz * WIDTH])) {
      edges.push({ to: next, cost: Math.hypot(dx, dz) * STEP });
    }
  }
  return edges;
});

function nearest(from: Vec): number {
  const x = Math.round((from.x - LEFT) / STEP), z = Math.round((from.z - TOP) / STEP);
  let closest = Infinity, found = -1;
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const xx = x + dx, zz = z + dz;
    if (xx < 0 || xx >= WIDTH || zz < 0 || zz >= HEIGHT) continue;
    const id = zz * WIDTH + xx;
    if (!valid[id]) continue;
    const d = distance(from, points[id]);
    if (d < closest && clear(from, points[id], PLAYER_RADIUS - 0.002)) {
      found = id;
      closest = d;
    }
    if (dx === 0 && dz === 0 && found === id) return id;
  }
  return found;
}

type HeapEntry = { id: number; cost: number };
function field(goal: Vec, blocked: number): Float64Array {
  const start = nearest(goal);
  if (start < 0) throw new Error('A Pizza Party approach is outside the navigable kitchen.');
  const costs = new Float64Array(points.length).fill(Infinity);
  const heap: HeapEntry[] = [];
  const push = (entry: HeapEntry) => {
    let i = heap.length;
    heap.push(entry);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].cost <= entry.cost) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = entry;
  };

  costs[start] = 0;
  push({ id: start, cost: 0 });
  while (heap.length) {
    const first = heap[0], last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].cost < heap[child].cost) child++;
        if (heap[child].cost >= last.cost) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = last;
    }
    if (first.cost > costs[first.id]) continue;
    for (const { to, cost } of links[first.id]) {
      // Searching backward from the goal keeps exits open for a bot already inside the blocked gap.
      const insideBlocked = blocked >= 0 && crossings[to] === blocked;
      if (blocked >= 0 && crossings[first.id] === blocked && !insideBlocked) continue;
      const nextCost = first.cost + cost * (insideBlocked ? 7 : 1);
      if (nextCost >= costs[to] - 0.000001) continue;
      costs[to] = nextCost;
      push({ id: to, cost: nextCost });
    }
  }
  return costs;
}

const fields = new Map<number, Float64Array>();
const sight = new Map<number, Int8Array>();

function distances(goal: number, blocked: number): Float64Array {
  const key = goal + (blocked + 1) * APPROACHES.length;
  const existing = fields.get(key);
  if (existing) return existing;
  const values = field(APPROACHES[goal].position, blocked);
  fields.set(key, values);
  return values;
}

export function routeCosts(from: Vec, goals: readonly number[], blocked: number): number[] {
  const start = nearest(from);
  return goals.map(goal => start < 0 ? distance(from, APPROACHES[goal].position) + 2 : distances(goal, blocked)[start]);
}

function crossesBlockedGap(from: Vec, to: Vec, blocked: number): boolean {
  if (blocked < 0 || crossingAt(from) === blocked) return false;
  const steps = Math.max(1, Math.ceil(distance(from, to) / (STEP / 2)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (crossingAt({ x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t }) === blocked) return true;
  }
  return false;
}

export function waypoint(from: Vec, goal: number, blocked: number): Vec {
  const target = APPROACHES[goal].position, start = nearest(from);
  if (start < 0) return target;
  const costs = distances(goal, blocked);
  let seen = sight.get(goal);
  if (!seen) {
    seen = new Int8Array(points.length);
    sight.set(goal, seen);
  }
  if (!seen[start]) seen[start] = clear(points[start], target) ? 1 : -1;
  // Grid nodes have extra clearance. The segment may start with a body already resting against a wall.
  const canWalk = (to: Vec) => !crossesBlockedGap(from, to, blocked) && clear(from, to, PLAYER_RADIUS);
  const leavingBlockedGap = blocked >= 0 && crossingAt(from) === blocked;
  if (seen[start] === 1 && !leavingBlockedGap && canWalk(target)) return target;
  let best = start;
  for (let leap = 0; leap < 4; leap++) {
    let next = best;
    for (const { to } of links[best]) {
      if (costs[to] < costs[next] && canWalk(points[to])) next = to;
    }
    if (next === best) break;
    best = next;
  }
  return points[best];
}
