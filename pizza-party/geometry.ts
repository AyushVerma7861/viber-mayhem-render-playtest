import { PLAYER_RADIUS, SOLIDS, WALK_BOUNDARY } from './layout.ts';
import type { Polygon, Vec } from './layout.ts';

export const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.z - b.z);

export function inside(point: Vec, polygon: Polygon): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.z > point.z) !== (b.z > point.z) &&
        point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) hit = !hit;
  }
  return hit;
}

export function closest(point: Vec, polygon: Polygon): { point: Vec; distance: number; edge: Vec } {
  let best = Infinity;
  let result = point;
  let edge = { x: 1, z: 0 };
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz)));
    const q = { x: a.x + dx * t, z: a.z + dz * t };
    const d = distance(q, point);
    if (d < best) { best = d; result = q; edge = { x: dx, z: dz }; }
  }
  return { point: result, distance: best, edge };
}

export function walkable(point: Vec, radius = PLAYER_RADIUS): boolean {
  if (!inside(point, WALK_BOUNDARY) || closest(point, WALK_BOUNDARY).distance < radius - 0.00001) return false;
  return SOLIDS.every(s => !inside(point, s.points) && closest(point, s.points).distance >= radius - 0.00001);
}

function correct(point: Vec, polygon: Polygon, keepInside: boolean, radius: number): Vec {
  const near = closest(point, polygon);
  const allowed = inside(point, polygon) === keepInside;
  if (allowed && near.distance >= radius) return point;
  let nx = point.x - near.point.x, nz = point.z - near.point.z;
  if (near.distance > 0.000001) {
    const direction = allowed ? 1 : -1;
    nx = nx / near.distance * direction;
    nz = nz / near.distance * direction;
  } else {
    const length = Math.hypot(near.edge.x, near.edge.z);
    nx = -near.edge.z / length;
    nz = near.edge.x / length;
    if (inside({ x: near.point.x + nx * 0.001, z: near.point.z + nz * 0.001 }, polygon) !== keepInside) {
      nx = -nx; nz = -nz;
    }
  }
  const amount = allowed ? radius - near.distance + 0.00001 : radius + near.distance + 0.00001;
  return { x: point.x + nx * amount, z: point.z + nz * amount };
}

export function constrain(point: Vec, from: Vec, radius = PLAYER_RADIUS): Vec {
  for (let i = 0; i < 4; i++) {
    point = correct(point, WALK_BOUNDARY, true, radius);
    for (const solid of SOLIDS) point = correct(point, solid.points, false, radius);
  }
  return walkable(point, radius) ? point : { ...from };
}

export function clear(from: Vec, to: Vec, radius = PLAYER_RADIUS + 0.015): boolean {
  const n = Math.ceil(distance(from, to) / 0.10);
  for (let i = 0; i <= n; i++) {
    const t = i / Math.max(n, 1);
    if (!walkable({ x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t }, radius)) return false;
  }
  return true;
}

export function circleRect(point: Vec, rectangle: { center: Vec; halfWidth: number; halfDepth: number }): { distance: number; push: Vec } {
  const x = Math.max(rectangle.center.x - rectangle.halfWidth, Math.min(rectangle.center.x + rectangle.halfWidth, point.x));
  const z = Math.max(rectangle.center.z - rectangle.halfDepth, Math.min(rectangle.center.z + rectangle.halfDepth, point.z));
  const d = Math.hypot(point.x - x, point.z - z);
  if (d > 0.000001) return { distance: d, push: { x: (point.x - x) / d, z: (point.z - z) / d } };
  const dx = rectangle.halfWidth - Math.abs(point.x - rectangle.center.x);
  const dz = rectangle.halfDepth - Math.abs(point.z - rectangle.center.z);
  return dx < dz ? { distance: -dx, push: { x: Math.sign(point.x - rectangle.center.x) || 1, z: 0 } } :
    { distance: -dz, push: { x: 0, z: Math.sign(point.z - rectangle.center.z) || 1 } };
}
