import * as THREE from 'three';
import { KITCHEN_ARENA, routeHeading } from './arena.ts';
import type { Vec } from './arena.ts';
import { CART_BODY_LENGTH, CART_BODY_WIDTH, CART_HUB_DEPTH, CART_HUB_OFFSET } from './simulation.ts';
import { ballGeo, batchMeshes, bevel, box, latheGeo, mat, part, round, tubeGeo } from './scene-parts.ts';

const paprika = mat('#b4362e', 0, 0.34);
const orange = mat('#e4613e', 0, 0.40);
const mint = mat('#61b7a7', 0, 0.48);
const evergreen = mat('#234e42', 0, 0.43);
const lavender = mat('#9d84bc', 0, 0.45);
const pale = mat('#f5e2c0', 0, 0.41);
const dark = mat('#332425', 0, 0.82);
const steel = mat('#a3b0b3', 0, 0.32, 0.76);
const brushed = mat('#b6b3ab', 0, 0.37, 0.31);
const brass = mat('#c8955c', 0, 0.30, 0.60);
const windowGlass = mat('#452826', 0.06, 0.25);
const amberGlass = mat('#d9662e', 0.32, 0.37);
const copperTray = mat('#bc6741', 0, 0.37, 0.47);
const dough = mat('#d5a368', 0, 0.76);
const porcelain = mat('#fff4dd', 0, 0.31);
const grout = mat('#483335', 0, 0.72);
const heat = mat('#ffd382', 0.51);
const taskLight = mat('#ffd49a', 0.9, 0.46);
const trolleyTeal = mat('#188879', 0, 0.35);
const laneColors = KITCHEN_ARENA.routes.map(route => mat(route.color, 0.17));
const trackBed = mat('#504b48', 0, 0.81);
const trackTread = mat('#3c3534', 0, 0.76);
const trackSteel = mat('#b3b2ac', 0, 0.34, 0.69);
const bounds = KITCHEN_ARENA.bounds;
const rearWallZ = -8.62;
const rearWallTop = 2.75;

export const KITCHEN_FRAMING = {
  halfWidth: bounds.x + 1.60,
  rear: { y: rearWallTop, z: rearWallZ - 0.15 },
  front: { y: 0, z: KITCHEN_ARENA.point(1, 0).z },
};

function label(text: string, width: number, height: number): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 72;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#452d2a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#c7986b';
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, 244, 60);
  ctx.fillStyle = '#fff0d7';
  ctx.font = 'bold 31px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 36, 222);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map }));
}

function tileDeck(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 800;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ad927c';
  ctx.fillRect(0, 0, 1200, 800);
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 15; col++) {
      const variation = 1.4 * Math.sin(13 * row + 7 * col);
      const edge = row === 0 || row === 9 || col === 0 || col === 14;
      const base = edge ? 79 : 85;
      const x = col * 80;
      const y = row * 80;
      const face = ctx.createLinearGradient(x + 7, y, x + 72, y + 76);
      face.addColorStop(0, 'hsl(37, 53%, ' + (base + variation + 2) + '%)');
      face.addColorStop(1, 'hsl(34, 47%, ' + (base + variation - 2) + '%)');
      ctx.fillStyle = face;
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 1, 78, 78, 4);
      ctx.fill();
      ctx.fillStyle = '#fff9e85e';
      ctx.fillRect(x + 4, y + 2, 72, 1.4);
      ctx.fillStyle = '#4d30201a';
      ctx.fillRect(x + 4, y + 76, 72, 2);
    }
  }
  for (let i = 0; i < 6500; i++) {
    ctx.fillStyle = i % 3 ? '#8b5e3c1b' : '#fff8e363';
    const x = ((i * 9787) % 104729) % 1200;
    const y = ((i * 1109) % 65521) % 800;
    ctx.fillRect(x, y, 1 + i % 3, i % 7 ? 1 : 2);
  }
  const edgeLight = ctx.createRadialGradient(610, 310, 220, 610, 310, 690);
  edgeLight.addColorStop(0, '#5d322900');
  edgeLight.addColorStop(1, '#5d32294a');
  ctx.fillStyle = edgeLight;
  ctx.fillRect(0, 0, 1200, 800);
  for (const spawn of KITCHEN_ARENA.spawns) {
    const x = (spawn.x / bounds.x + 1) * 600;
    const y = (spawn.z / bounds.z + 1) * 400;
    ctx.strokeStyle = '#926b4a88';
    ctx.lineWidth = 2;
    ctx.setLineDash([9, 10]);
    ctx.strokeRect(x - 35, y - 35, 70, 70);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function serviceFloor(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#423234';
  ctx.fillRect(0, 0, 128, 128);
  ['#61484a', '#5c4547', '#5a4244', '#604648'].forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(i % 2 * 64 + 1, Math.floor(i / 2) * 64 + 1, 62, 62);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(30, 30);
  texture.anisotropy = 4;
  return texture;
}

let contactShadow: THREE.MeshBasicMaterial | undefined;

export function groundedShadow(): THREE.MeshBasicMaterial {
  if (contactShadow) return contactShadow;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const fade = ctx.createRadialGradient(32, 32, 6, 32, 32, 32);
  fade.addColorStop(0, '#452b2288');
  fade.addColorStop(0.52, '#452b224c');
  fade.addColorStop(1, '#452b2200');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 64, 64);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  contactShadow = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false });
  return contactShadow;
}

function oven(scene: THREE.Group, x: number, z: number): void {
  const unit = new THREE.Group();
  unit.position.set(x, 0, z);
  scene.add(unit);
  round(unit, dark, 0, 0.11, 0, 2.14, 0.22, 1.44);
  round(unit, paprika, 0, 0.86, 0, 2.23, 1.42, 1.53);
  round(unit, brass, 0, 0.719, 0.774, 1.77, 0.87, 0.077);
  round(unit, windowGlass, 0, 0.719, 0.819, 1.55, 0.68, 0.052);
  bevel(unit, amberGlass, 0, 0.697, 0.850, 1.35, 0.47, 0.018);
  bevel(unit, windowGlass, 0, 0.718, 0.862, 1.25, 0.36, 0.012);
  for (const height of [0.550, 0.733]) {
    box(unit, copperTray, 0, height, 0.871, 1.22, 0.025, 0.028);
    for (const shift of [-0.426, -0.143, 0.143, 0.426]) {
      part(unit, ballGeo, dough, shift, height + 0.069, 0.878, 0.112, 0.069, 0.038);
      box(unit, heat, shift, height + 0.102, 0.910, 0.054, 0.013, 0.009).rotation.z = 0.33;
    }
  }
  box(unit, heat, 0, 0.904, 0.865, 1.26, 0.018, 0.021);
  bevel(unit, dark, 0, 1.330, 0.772, 1.81, 0.298, 0.078);
  bevel(unit, evergreen, 0, 1.344, 0.819, 0.421, 0.13, 0.031);
  for (const shift of [-0.121, 0, 0.121]) {
    box(unit, heat, shift, 1.345, 0.843, 0.047, 0.035, 0.008);
  }
  for (const side of [-1, 1]) {
    box(unit, steel, side * 0.52, 1.06, 0.858, 0.075, 0.065, 0.17);
    part(unit, latheGeo, brass, side * 0.642, 1.344, 0.83, 0.094, 0.071, 0.094).rotation.x = Math.PI / 2;
    box(unit, pale, side * 0.642, 1.378, 0.87, 0.017, 0.055, 0.015);
    for (let i = 0; i < 4; i++) {
      box(unit, dark, side * 0.63, 0.296 + i * 0.038, 0.762, 0.299, 0.017, 0.016);
    }
  }
  round(unit, pale, 0, 1.065, 0.940, 1.23, 0.082, 0.072);
  round(unit, orange, 0, 1.611, 0, 2.28, 0.18, 1.57);
  round(unit, pale, 0, 1.71, -0.24, 1.95, 0.074, 0.85);
  part(unit, latheGeo, steel, 0.46, 2.02, -0.40, 0.183, 0.58, 0.183);
  part(unit, tubeGeo, dark, 0.46, 2.328, -0.4, 0.23, 0.078, 0.23);
  for (const y of [1.799, 2.194]) part(unit, latheGeo, brass, 0.46, y, -0.40, 0.20, 0.062, 0.20);
}

function counter(scene: THREE.Group, x: number, z: number, width: number,
  angle = 0, surface = brushed): THREE.Group {
  const unit = new THREE.Group();
  unit.position.set(x, 0, z);
  unit.rotation.y = angle;
  scene.add(unit);
  box(unit, dark, 0, 0.09, 0, width - 0.16, 0.18, 1.18);
  round(unit, evergreen, 0, 0.48, 0, width, 0.78, 1.35);
  round(unit, surface, 0, 0.932, 0, width + 0.11, 0.145, 1.43);
  bevel(unit, brushed, 0, 0.882, 0.703, width - 0.10, 0.038, 0.044);
  bevel(unit, brushed, 0, 1.060, -0.654, width + 0.04, 0.131, 0.126);
  for (let i = 0; i < Math.round(width); i++) {
    const doorX = width * ((i + 0.5) / Math.round(width) - 0.5);
    bevel(unit, dark, doorX, 0.49, 0.671, 0.892, 0.625, 0.030);
    bevel(unit, evergreen, doorX, 0.49, 0.693, 0.84, 0.57, 0.051);
    bevel(unit, evergreen, doorX, 0.455, 0.723, 0.664, 0.318, 0.017);
    bevel(unit, dark, doorX, 0.588, 0.739, 0.176, 0.167, 0.051);
    bevel(unit, mint, doorX, 0.597, 0.772, 0.124, 0.113, 0.042);
  }
  return unit;
}

function backsplash(scene: THREE.Group, left: number, right: number): void {
  const wide = right - left;
  const x = (right + left) / 2;
  bevel(scene, grout, x, 1.31, rearWallZ, wide, 2.64, 0.22);
  const count = Math.ceil(wide / 0.57);
  const step = wide / count;
  const wallTiles = [mat('#875b4f', 0, 0.60), mat('#926154', 0, 0.61), mat('#9c6b5d', 0, 0.60)];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < count; col++) {
      const tile = wallTiles[(row * 5 + col * 7) % wallTiles.length];
      box(scene, tile, left + (col + 0.5) * step, 0.25 + row * 0.49, -8.490,
        step - 0.025, 0.464, 0.051);
    }
  }
  bevel(scene, dark, x, 2.672, -8.55, wide + 0.13, 0.128, 0.298);
  box(scene, brass, x, 2.658, -8.381, wide - 0.10, 0.026, 0.023);
}

function kitchenWallDetails(scene: THREE.Group): void {
  for (const x of [-8.2, -2.9, 2.15, 8.01]) {
    bevel(scene, dark, x, 2.42, -8.40, 1.43, 0.27, 0.24);
    bevel(scene, taskLight, x, 2.39, -8.254, 1.18, 0.099, 0.080);
  }
  bevel(scene, brushed, 4.32, 2.15, -8.29, 1.41, 0.049, 0.071);
  for (const [index, x] of [3.87, 4.18, 4.49, 4.81].entries()) {
    box(scene, brushed, x, 1.93, -8.244, 0.044, 0.34, 0.035);
    bevel(scene, index % 2 ? dark : brushed, x, 1.734, -8.233, 0.149, 0.13, 0.063);
  }
  bevel(scene, pale, 5.38, 1.97, -8.239, 0.26, 0.35, 0.09);
  bevel(scene, paprika, 5.38, 1.859, -8.188, 0.259, 0.048, 0.023);
}

function inDeck(point: Vec): boolean {
  return Math.abs(point.x) <= bounds.x && Math.abs(point.z) <= bounds.z;
}

function dockProgress(lane: number, entering: boolean): number {
  for (let i = 0; i <= 500; i++) {
    const progress = entering ? i / 500 : 1 - i / 500;
    if (inDeck(KITCHEN_ARENA.point(lane, progress))) {
      return progress + (entering ? -0.039 : 0.038);
    }
  }
  throw new Error('Kitchen trolley route does not reach the play floor.');
}

function railStrip(scene: THREE.Group, lane: number, offset: number, width: number,
  height: number, material: THREE.Material): void {
  const positions: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  const samples = 120;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const { x, z } = KITCHEN_ARENA.point(lane, t);
    const heading = routeHeading(KITCHEN_ARENA, lane, t);
    for (const side of [-1, 1]) {
      const shift = offset + side * width / 2;
      positions.push(x - Math.sin(heading) * shift, height, z + Math.cos(heading) * shift);
      uv.push(t, (side + 1) / 2);
    }
    const a = i * 2;
    if (i > 0) indices.push(a - 2, a - 1, a, a - 1, a + 1, a);
  }
  const shape = new THREE.BufferGeometry();
  shape.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  shape.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  shape.setIndex(indices);
  shape.computeVertexNormals();
  scene.add(new THREE.Mesh(shape, material));
}

function rails(scene: THREE.Group, lane: number): void {
  railStrip(scene, lane, 0, 1.50, 0.026, trackTread);
  railStrip(scene, lane, 0, 1.37, 0.034, trackBed);
  for (const side of [-1, 1]) {
    railStrip(scene, lane, side * 0.430, 0.096, 0.051, dark);
    railStrip(scene, lane, side * 0.430, 0.057, 0.069, trackSteel);
    railStrip(scene, lane, side * 0.714, 0.056, 0.041, laneColors[lane]);
  }
  const segments = 79;
  for (let i = 0; i < segments; i++) {
    const t = (i + 0.5) / segments;
    const { x, z } = KITCHEN_ARENA.point(lane, t);
    const angle = routeHeading(KITCHEN_ARENA, lane, t);
    const sideX = -Math.sin(angle);
    const sideZ = Math.cos(angle);
    box(scene, trackTread, x, 0.045, z, 0.081, 0.020, 1.28).rotation.y = -angle;
    if (i % 2 === 0) {
      for (const side of [-1, 1]) {
        box(scene, steel, x + side * sideX * 0.527, 0.056, z + side * sideZ * 0.527,
          0.058, 0.022, 0.055).rotation.y = -angle;
      }
    }
    if (i % 8 === 4 && inDeck({ x, z })) {
      for (const side of [-1, 1]) {
        box(scene, laneColors[lane], x + side * sideX * 0.13, 0.065, z + side * sideZ * 0.13,
          0.29, 0.013, 0.062).rotation.y = -angle + side * 0.80;
      }
    }
  }
}

function dock(scenery: THREE.Group, scene: THREE.Scene, lane: number, entering: boolean): THREE.Mesh[] {
  const p = dockProgress(lane, entering);
  const position = KITCHEN_ARENA.point(lane, p);
  const heading = routeHeading(KITCHEN_ARENA, lane, p);
  const gate = new THREE.Group();
  gate.position.set(position.x, 0, position.z);
  gate.rotation.y = -heading;
  scenery.add(gate);
  for (const side of [-1, 1]) {
    round(gate, dark, 0, 0.617, side * 0.901, 0.70, 1.234, 0.34);
    round(gate, laneColors[lane], 0, 0.654, side * 0.995, 0.72, 0.19, 0.20);
    bevel(gate, steel, 0.362, 0.341, side * 0.902, 0.028, 0.45, 0.227);
    for (let i = 0; i < 4; i++) {
      box(gate, dark, 0.386, 0.196 + i * 0.089, side * 0.9, 0.017, 0.035, 0.182);
    }
  }
  round(gate, lane === 0 ? paprika : evergreen, 0, 1.377, 0, 0.79, 0.30, 2.18);
  round(gate, dark, 0, 1.502, 0, 0.50, 0.045, 1.82);
  bevel(gate, brass, 0.110, 1.526, 0, 0.122, 0.047, 1.97);
  if (!entering) return [];
  const lights = new THREE.Group();
  lights.position.copy(gate.position);
  lights.rotation.copy(gate.rotation);
  scene.add(lights);
  const bulb = mat(KITCHEN_ARENA.routes[lane].color, 0.6).clone();
  return [-0.6, 0, 0.6].map(z => round(lights, bulb, 0, 1.543, z, 0.35, 0.098, 0.23));
}

export function buildKitchen(scene: THREE.Scene): THREE.Mesh[][] {
  const scenery = new THREE.Group();
  const service = new THREE.MeshStandardMaterial({ map: serviceFloor(), roughness: 0.86 });
  const deck = new THREE.MeshStandardMaterial({ map: tileDeck(), roughness: 0.72 });
  const floorPlane = new THREE.PlaneGeometry(1, 1);
  part(scenery, floorPlane, service, 0, -0.025, 0, 84, 84, 1).rotation.x = -Math.PI / 2;
  part(scenery, floorPlane, deck, 0, 0.010, 0, bounds.x * 2, bounds.z * 2, 1).rotation.x = -Math.PI / 2;
  // Continue the back of the room above the working backsplash.
  box(scenery, mat('#64454a', 0, 0.84), 0, 5.15, rearWallZ - 0.27, 38, 5.20, 0.22);
  for (const x of [-11.1, -5.77, 0, 5.67, 11.1]) {
    box(scenery, grout, x, 5.15, rearWallZ - 0.143, 0.07, 5.20, 0.025);
  }
  backsplash(scenery, -14, -6.92);
  backsplash(scenery, -4.62, 14);
  bevel(scenery, dark, -5.77, 2.57, rearWallZ, 2.36, 0.35, 0.30);
  box(scenery, brass, -5.77, 2.658, -8.381, 2.31, 0.026, 0.023);
  kitchenWallDetails(scenery);
  for (const side of [-1, 1]) {
    const openingX = KITCHEN_ARENA.point(side < 0 ? 0 : 1, dockProgress(side < 0 ? 0 : 1, true)).x;
    const openingZ = -side * 1.99;
    for (const [min, max] of [[-bounds.x, openingX - 1.12], [openingX + 1.12, bounds.x]]) {
      round(scenery, paprika, (min + max) / 2, 0.042, side * (bounds.z + 0.15), max - min, 0.19, 0.28);
      box(scenery, brass, (min + max) / 2, 0.128, side * (bounds.z + 0.15), max - min - 0.07, 0.055, 0.13);
    }
    for (const [min, max] of [[-bounds.z, openingZ - 1.12], [openingZ + 1.12, bounds.z]]) {
      round(scenery, paprika, side * (bounds.x + 0.15), 0.044, (min + max) / 2, 0.28, 0.19, max - min);
      box(scenery, brass, side * (bounds.x + 0.15), 0.126, (min + max) / 2, 0.13, 0.05, max - min - 0.06);
    }
  }

  const signals = KITCHEN_ARENA.routes.map((_, lane) => {
    rails(scenery, lane);
    dock(scenery, scene, lane, false);
    return dock(scenery, scene, lane, true);
  });
  const shadow = groundedShadow();
  const shadowPlane = new THREE.PlaneGeometry(1, 1);
  for (const [x, z, w, d] of [[-8.18, -7.26, 3.35, 2.45],
    [-2.89, -7.22, 3.35, 2.45], [2.15, -7.19, 7.56, 2.33], [8.01, -7.22, 5.1, 2.21],
    [-10.59, -1.35, 2.49, 5.17], [10.58, 1.90, 2.29, 4.26]]) {
    part(scenery, shadowPlane, shadow, x, 0.017, z, w, d, 1).rotation.x = -Math.PI / 2;
  }
  oven(scenery, -8.18, -7.72);
  oven(scenery, -2.89, -7.65);
  const rearCounter = counter(scenery, 2.15, -7.62, 6.45);
  for (const [i, x] of [-2.34, -1.89, 2.18, 2.62].entries()) {
    part(rearCounter, latheGeo, i % 2 ? porcelain : paprika, x, 1.16, -0.06, 0.17, 0.33, 0.17);
    part(rearCounter, latheGeo, brass, x, 1.344, -0.06, 0.182, 0.058, 0.182);
    bevel(rearCounter, pale, x, 1.175, 0.105, 0.117, 0.105, 0.021);
  }
  round(rearCounter, orange, 0.45, 1.24, -0.12, 0.62, 0.45, 0.52);
  part(rearCounter, latheGeo, steel, 0.45, 1.068, 0.235, 0.239, 0.147, 0.239);
  part(rearCounter, latheGeo, dark, 0.45, 1.145, 0.235, 0.199, 0.024, 0.199);
  round(rearCounter, steel, 0.45, 1.44, -0.10, 0.47, 0.126, 0.42);
  bevel(rearCounter, copperTray, -0.605, 1.023, 0.18, 0.89, 0.063, 0.58);
  bevel(rearCounter, dough, -0.70, 1.071, 0.18, 0.378, 0.047, 0.318);
  part(rearCounter, latheGeo, brass, -0.345, 1.084, 0.13, 0.073, 0.44, 0.073)
    .rotation.z = Math.PI / 2.3;
  const serve = counter(scenery, 8.01, -7.66, 3.92, 0, lavender);
  bevel(serve, paprika, 0, 1.572, -0.6, 3.99, 0.150, 0.31);
  bevel(serve, dark, -0.569, 1.462, -0.60, 0.91, 0.105, 0.24);
  for (const x of [-1.64, 1.64]) {
    part(serve, latheGeo, brass, x, 1.31, -0.57, 0.045, 0.62, 0.045);
  }
  for (const x of [-0.84, 0, 0.84]) {
    for (let i = 0; i < 4; i++) {
      round(serve, porcelain, x, 1.037 + i * 0.068, 0.08, 0.68, 0.059, 0.54);
    }
  }
  const wash = counter(scenery, -10.75, -1.35, 3.92, Math.PI / 2);
  round(wash, steel, 0, 1.035, 0, 1.91, 0.07, 0.8);
  round(wash, dark, 0, 1.076, 0, 1.58, 0.025, 0.58);
  box(wash, steel, 0, 1.25, -0.35, 0.065, 0.33, 0.062);
  round(wash, steel, 0, 1.423, -0.236, 0.063, 0.066, 0.282);
  counter(scenery, 10.76, 1.90, 3.15, -Math.PI / 2);

  for (const [name, x, z, width, y] of [
    ['OVENS', -2.89, -6.947, 1.33, 1.85],
    ['PREP', 2.15, -6.874, 1.51, 0.76],
    ['SERVE', 8.01, -6.919, 1.51, 1.15],
    ['WASH', -10.80, 0.654, 1.39, 0.74],
  ] as const) {
    const sign = label(name, width, 0.34);
    sign.position.set(x, y, z);
    scenery.add(sign);
  }
  batchMeshes(scenery, scene, [service, deck, shadow, trackBed, trackTread, trackSteel, ...laneColors]);
  return signals;
}

export function makeTrolley(lane: number): THREE.Group {
  const details = new THREE.Group();
  const trolley = new THREE.Group();
  const body = lane === 0 ? paprika : trolleyTeal;
  round(details, dark, 0, 0.236, 0, CART_BODY_LENGTH, 0.23, CART_BODY_WIDTH);
  round(details, body, 0, 0.485, 0, 2.27, 0.425, 0.94);
  bevel(details, brass, 0, 0.365, 0, 2.306, 0.037, 0.962);
  round(details, pale, -0.15, 0.709, 0, 1.71, 0.105, 0.88);
  bevel(details, brushed, -0.17, 0.767, 0, 1.67, 0.057, 0.788);
  round(details, steel, 0.81, 0.701, 0, 0.35, 0.136, 0.62);
  part(details, latheGeo, brass, 0.81, 0.792, 0, 0.157, 0.08, 0.157);
  part(details, ballGeo, laneColors[lane], 0.81, 0.860, 0, 0.118, 0.123, 0.118);
  if (lane === 0) {
    for (const x of [-0.59, 0.19]) {
      round(details, dark, x, 0.816, 0, 0.72, 0.103, 0.62);
      round(details, brushed, x, 0.907, 0, 0.692, 0.151, 0.60);
      bevel(details, steel, x, 1.014, 0, 0.192, 0.070, 0.089);
    }
  } else {
    for (const x of [-0.59, 0.19]) {
      for (let level = 0; level < 4; level++) {
        round(details, porcelain, x, 0.798 + 0.058 * level, 0, 0.64, 0.048, 0.56);
      }
    }
  }
  for (const end of [-1, 1]) {
    round(details, brass, end * 1.225, 0.35, 0, 0.114, 0.172, 0.79);
    for (const side of [-1, 1]) {
      part(details, latheGeo, dark, end * 0.775, 0.229, side * 0.491,
        0.212, 0.16, 0.212).rotation.x = Math.PI / 2;
      part(details, latheGeo, steel, end * 0.775, 0.229, side * CART_HUB_OFFSET,
        0.096, CART_HUB_DEPTH, 0.096).rotation.x = Math.PI / 2;
      part(details, latheGeo, brass, end * 0.775, 0.229, side * (CART_HUB_OFFSET + 0.007),
        0.047, 0.012, 0.047).rotation.x = Math.PI / 2;
      round(details, heat, end * 1.129, 0.512, side * 0.263, 0.067, 0.099, 0.18);
      bevel(details, pale, end * 0.251, 0.518, side * 0.479, 0.268, 0.081, 0.028);
    }
  }
  for (const side of [-1, 1]) {
    bevel(details, dark, 0, 0.428, side * 0.475, 0.96, 0.133, 0.047);
    for (let i = 0; i < 7; i++) {
      box(details, steel, (i - 3) * 0.118, 0.431, side * 0.502, 0.049, 0.069, 0.011);
    }
  }
  batchMeshes(details, trolley);
  const shadow = part(trolley, new THREE.PlaneGeometry(1, 1), groundedShadow(),
    0, 0.091, 0, 3.72, 1.78, 1);
  shadow.rotation.x = -Math.PI / 2;
  trolley.traverse(item => { item.castShadow = false; });
  return trolley;
}

export function makeCooker() {
  const cooker = new THREE.Group();
  const body = new THREE.Group();
  const lid = new THREE.Group();
  const gasket = mat('#e16b3c', 0.06, 0.46);
  const gauge = mat('#fff1ce', 0.12, 0.44).clone();
  part(body, latheGeo, dark, 0, -0.108, 0, 0.219, 0.057, 0.219);
  part(body, latheGeo, brushed, 0, 0.014, 0, 0.231, 0.242, 0.231);
  part(body, latheGeo, steel, 0, -0.077, 0, 0.239, 0.033, 0.239);
  part(body, latheGeo, gasket, 0, 0.108, 0, 0.241, 0.040, 0.241);
  part(body, latheGeo, dark, 0, 0.055, 0.211, 0.091, 0.042, 0.091).rotation.x = Math.PI / 2;
  part(body, latheGeo, gauge, 0, 0.055, 0.239, 0.066, 0.018, 0.066).rotation.x = Math.PI / 2;
  for (const theta of [-1.32, -0.66, 0, 0.66, 1.32]) {
    box(body, dark, Math.sin(theta) * 0.049, 0.055 + Math.cos(theta) * 0.049, 0.251,
      0.008, 0.012, 0.008).rotation.z = -theta;
  }
  for (const side of [-1, 1]) {
    round(body, dark, side * 0.265, 0.040, 0, 0.15, 0.066, 0.106);
    round(body, brass, side * 0.229, 0.035, 0.051, 0.068, 0.084, 0.033);
  }
  batchMeshes(body, cooker);
  const needle = new THREE.Group();
  needle.position.set(0, 0.055, 0.262);
  box(needle, paprika, 0, 0.023, 0, 0.010, 0.057, 0.012);
  cooker.add(needle);
  part(lid, latheGeo, steel, 0, 0.143, 0, 0.245, 0.051, 0.245);
  part(lid, ballGeo, brushed, 0, 0.146, 0, 0.22, 0.097, 0.22);
  round(lid, dark, 0, 0.261, 0.025, 0.145, 0.071, 0.092);
  part(lid, tubeGeo, dark, -0.130, 0.234, -0.035, 0.061, 0.084, 0.061);
  cooker.add(lid);
  const steam = Array.from({ length: 6 }, () => part(cooker, ballGeo,
    new THREE.MeshBasicMaterial({ color: '#f2fcf5', transparent: true, opacity: 0, depthWrite: false }),
    0, 0, 0, 0.1, 0.1, 0.1));
  cooker.traverse(item => { item.castShadow = false; });
  return { cooker, lid, gauge, needle, steam };
}
