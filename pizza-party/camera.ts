import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { COUNTERS, WALK_BOUNDARY } from './layout.ts';

export type KitchenLens = { elevation: number; distance: number; yaw: number; sideMargin: number };

export const KITCHEN_LENS: KitchenLens = { elevation: 50, distance: 16.5, yaw: 0, sideMargin: 0.045 };

// Frame the lanes, worktops and station chefs. The courtyard can extend past the edges.
const kitchenBounds = WALK_BOUNDARY.map(({ x, z }) => new Vector3(x, 0.09, z));
for (const { center, inward } of COUNTERS) {
  for (const dx of [-1.38, 1.38]) {
    for (const dz of [-0.46, 0.46]) kitchenBounds.push(new Vector3(center.x + dx, 0.81, center.z + dz));
  }
  for (const dx of [-0.48, 0.48]) {
    kitchenBounds.push(new Vector3(center.x + dx, 1.52, center.z - inward.z * 1.05));
    kitchenBounds.push(new Vector3(center.x + dx, 0.31, center.z - inward.z * 1.29));
  }
}

export function makeKitchenCamera(lens = KITCHEN_LENS): PerspectiveCamera {
  const camera = new PerspectiveCamera(42, 1, 0.1, 70);
  const elevation = MathUtils.degToRad(lens.elevation);
  const yaw = MathUtils.degToRad(lens.yaw);
  const radius = lens.distance * Math.cos(elevation);
  camera.position.set(
    Math.sin(yaw) * radius,
    0.34 + Math.sin(elevation) * lens.distance,
    -0.12 + Math.cos(yaw) * radius,
  );
  camera.lookAt(0, 0.34, -0.12);
  camera.updateMatrixWorld(true);
  return camera;
}

export function fitKitchenCamera(camera: PerspectiveCamera, width: number, height: number, sideMargin = KITCHEN_LENS.sideMargin): void {
  if (width < 2 || height < 2) return;
  const aspect = width / height;
  const side = Math.max(8, width * sideMargin);
  const top = Math.min(height * 0.20, height <= 380 ? 43 : 54);
  const bottom = Math.max(8, height * 0.024);
  const point = new Vector3();
  let left = Infinity, right = -Infinity, low = Infinity, high = -Infinity;
  for (const corner of kitchenBounds) {
    point.copy(corner).applyMatrix4(camera.matrixWorldInverse);
    const x = -point.x / point.z, y = -point.y / point.z;
    left = Math.min(left, x);
    right = Math.max(right, x);
    low = Math.min(low, y);
    high = Math.max(high, y);
  }
  const scale = Math.min(2 * aspect * (1 - 2 * side / width) / (right - left),
    2 * (1 - (top + bottom) / height) / (high - low));
  camera.fov = MathUtils.radToDeg(2 * Math.atan(1 / scale));
  const offsetX = (left + right) * scale / (2 * aspect) * width / 2;
  const offsetY = ((bottom - top) / height - (low + high) * scale / 2) * height / 2;
  camera.setViewOffset(width, height, offsetX, offsetY, width, height);
}
