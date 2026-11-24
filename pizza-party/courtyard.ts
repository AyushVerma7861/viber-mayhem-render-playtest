import * as THREE from 'three';
import chefMark from './shared/assets/chef-mark.png';
import { FLOOR_DEPTH, FLOOR_WIDTH } from './layout.ts';
import { ballGeo, bevel, box, latheGeo, mat, part, round } from './shared/scene-parts.ts';

const iron = mat('#263a34');
const trim = mat('#aa7948', 0, 0.43, 0.22);
const wood = mat('#916044', 0, 0.81);
const kraft = mat('#c59660', 0, 0.86);
const pottery = mat('#92533d', 0, 0.74);
const soil = mat('#382d23');
const leaves = ['#496436', '#6c8342', '#7a9652', '#406248'].map(color => mat(color, 0, 0.61));
const grade = -0.345;
const logo = new THREE.PlaneGeometry(1, 1);
let badgeMaterial: THREE.MeshStandardMaterial | undefined;
let haloTexture: THREE.CanvasTexture | undefined;

export function chefBadge(group: THREE.Object3D, x: number, y: number, z: number, size: number) {
  if (!badgeMaterial) {
    const map = new THREE.TextureLoader().load(chefMark);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    badgeMaterial = new THREE.MeshStandardMaterial({ map, alphaTest: 0.55, roughness: 0.7 });
  }
  const badge = part(group, logo, badgeMaterial, x, y, z, size, size, 1);
  badge.castShadow = false;
  return badge;
}

export function warmPool(scene: THREE.Scene, x: number, y: number, z: number, width: number, opacity: number) {
  if (!haloTexture) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 183, 82, 0.78)');
    gradient.addColorStop(0.48, 'rgba(255, 128, 39, 0.36)');
    gradient.addColorStop(1, 'rgba(255, 100, 28, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    haloTexture = new THREE.CanvasTexture(canvas);
    haloTexture.colorSpace = THREE.SRGBColorSpace;
  }
  const material = new THREE.MeshBasicMaterial({
    map: haloTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity,
  });
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(width, width), material);
  pool.position.set(x, y, z);
  pool.rotation.x = -Math.PI / 2;
  scene.add(pool);
  return material;
}

function brickSurface() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1536;
  const ctx = canvas.getContext('2d')!;
  const midpoint = canvas.width / 2;
  ctx.fillStyle = '#282d29';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(midpoint, midpoint);
  ctx.rotate(Math.PI / 4);
  const colors = ['#3a4640', '#444c43', '#39453f', '#485049', '#465049', '#39423d', '#504c41'];
  const brick = 16;
  for (let j = -68; j < 68; j++) {
    for (let i = -68; i < 68; i++) {
      const phase = (i + j) & 3;
      if (phase & 1) continue;
      const hash = Math.imul(i + 621, j + 1171) ^ (i * 9029 - j * 1229);
      const x = i * brick, y = j * brick;
      const width = phase === 0 ? 2 * brick : brick;
      const depth = phase === 0 ? brick : 2 * brick;
      ctx.fillStyle = colors[(hash >>> 0) % colors.length];
      ctx.fillRect(x + 0.7, y + 0.7, width - 1.4, depth - 1.4);
      ctx.fillStyle = '#daaf7d26';
      ctx.fillRect(x + 1.25, y + 1, width - 2.4, 0.8);
      ctx.fillStyle = '#161c1a30';
      ctx.fillRect(x + 2 + (hash & 5), y + 4 + ((hash >>> 4) & 5), width / 4, 1.15);
    }
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ map, roughness: 0.9 }));
  ground.position.y = grade;
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  return ground;
}

function herbPot(group: THREE.Group, x: number, z: number, scale: number) {
  const root = new THREE.Group();
  root.position.set(x, grade, z);
  root.scale.setScalar(scale);
  group.add(root);
  part(root, new THREE.CylinderGeometry(1, 0.73, 1, 16), pottery, 0, 0.20, 0, 0.31, 0.40, 0.31);
  part(root, latheGeo, pottery, 0, 0.40, 0, 0.33, 0.076, 0.33);
  part(root, latheGeo, soil, 0, 0.44, 0, 0.28, 0.014, 0.28);
  for (let leaf = 0; leaf < 13; leaf++) {
    const a = leaf * 2.39996, r = leaf < 7 ? 0.15 : 0.268;
    const y = leaf < 7 ? 0.63 + (leaf % 3) * 0.07 : 0.57;
    const blade = part(root, ballGeo, leaves[leaf % leaves.length], Math.cos(a) * r, y, Math.sin(a) * r, 0.105, 0.038, 0.183);
    blade.rotation.set(0.33 + (leaf % 3) * 0.15, -a + Math.PI / 2, -0.19);
  }
}

function produceCrate(group: THREE.Group, x: number, y: number, z: number, yaw: number) {
  const crate = new THREE.Group();
  crate.position.set(x, y, z);
  crate.rotation.y = yaw;
  group.add(crate);
  bevel(crate, wood, 0, 0.05, 0, 0.84, 0.10, 0.67);
  for (const side of [-1, 1]) {
    bevel(crate, wood, side * 0.407, 0.18, 0, 0.066, 0.255, 0.66);
    for (const height of [0.123, 0.249]) bevel(crate, wood, 0, height, side * 0.315, 0.80, 0.078, 0.061);
  }
  const label = mat('#c04435', 0, 0.57);
  const tin = mat('#a2a5a0', 0, 0.34, 0.28);
  for (const [dx, dz, h] of [[-0.20, -0.09, 0.32], [0.14, 0.051, 0.27], [0.18, -0.17, 0.25]]) {
    part(crate, latheGeo, label, dx, 0.095 + h / 2, dz, 0.111, h, 0.111);
    part(crate, latheGeo, tin, dx, 0.101 + h, dz, 0.114, 0.021, 0.114);
    const ring = new THREE.TorusGeometry(0.074, 0.006, 5, 16);
    part(crate, ring, trim, dx, 0.114 + h, dz, 1, 1, 1).rotation.x = Math.PI / 2;
  }
}

export function pizzaCarton(group: THREE.Object3D, width: number, depth: number) {
  bevel(group, kraft, 0, 0.033, 0, width, 0.066, depth);
  for (const side of [-1, 1]) {
    box(group, kraft, side * width * 0.47, 0.085, 0, 0.043, 0.082, depth);
    box(group, kraft, 0, 0.085, side * depth * 0.47, width, 0.082, 0.043);
    box(group, iron, side * width * 0.15, 0.07, depth * 0.506, 0.075, 0.012, 0.012);
  }
  const lid = new THREE.Group();
  lid.position.set(0, 0.116, -depth / 2);
  group.add(lid);
  bevel(lid, kraft, 0, 0, depth / 2, width, 0.041, depth);
  chefBadge(lid, 0, 0.022, depth / 2, width * 0.31).rotation.x = -Math.PI / 2;
  return lid;
}

function boxShelf(group: THREE.Group, x: number, z: number) {
  const rack = new THREE.Group();
  rack.position.set(x, grade, z);
  rack.rotation.y = -0.27;
  group.add(rack);
  for (const side of [-1, 1]) bevel(rack, iron, side * 0.48, 0.50, 0, 0.13, 0.94, 0.65);
  for (const height of [0.15, 0.51, 0.96]) bevel(rack, iron, 0, height, 0, 1.09, 0.067, 0.70);
  bevel(rack, iron, 0, 0.50, -0.30, 0.96, 0.86, 0.064);
  bevel(rack, trim, 0, 0.998, 0, 1.08, 0.024, 0.69);
  bevel(rack, iron, 0, 1.015, 0, 1.00, 0.028, 0.61);
  for (const [y, dx] of [[0.19, -0.065], [0.31, -0.09], [0.55, 0.04], [0.67, 0.10]]) {
    const carton = new THREE.Group();
    carton.position.set(dx, y, 0.027);
    rack.add(carton);
    pizzaCarton(carton, 0.72, 0.53);
  }
}

function lantern(group: THREE.Group, scene: THREE.Scene, x: number, z: number) {
  const body = new THREE.Group();
  body.position.set(x, grade, z);
  group.add(body);
  round(body, iron, 0, 0.04, 0, 0.42, 0.085, 0.42);
  bevel(body, trim, 0, 0.107, 0, 0.32, 0.062, 0.32);
  bevel(body, mat('#ffc77c', 1.1, 0.62), 0, 0.286, 0, 0.229, 0.33, 0.23);
  for (const a of [-0.137, 0.137]) for (const b of [-0.137, 0.137]) {
    bevel(body, trim, a, 0.285, b, 0.032, 0.36, 0.032);
  }
  bevel(body, trim, 0, 0.463, 0, 0.33, 0.058, 0.33);
  part(body, latheGeo, trim, 0, 0.545, 0, 0.058, 0.09, 0.058);
  warmPool(scene, x, grade + 0.012, z, 2.16, 0.50);
}

function drain(group: THREE.Group, x: number, z: number, yaw: number) {
  const grate = new THREE.Group();
  grate.position.set(x, grade + 0.012, z);
  grate.rotation.y = yaw;
  group.add(grate);
  box(grate, trim, 0, 0, 0, 0.83, 0.023, 0.21);
  box(grate, iron, 0, 0.012, 0, 0.76, 0.01, 0.158);
  for (let i = -6; i <= 6; i++) box(grate, trim, i * 0.055, 0.02, 0, 0.016, 0.014, 0.16);
}

function inlay(group: THREE.Group, x: number, z: number, yaw: number) {
  const marking = new THREE.Group();
  marking.position.set(x, grade + 0.008, z);
  marking.rotation.y = yaw;
  group.add(marking);
  for (const dx of [-0.155, 0.155]) for (const side of [-1, 1]) {
    box(marking, trim, dx, 0, side * 0.134, 0.27, 0.015, 0.018);
    box(marking, trim, dx + side * 0.134, 0, 0, 0.018, 0.015, 0.25);
  }
}

export function buildCourtyard(group: THREE.Group, scene: THREE.Scene) {
  scene.add(brickSurface());
  const outside = FLOOR_WIDTH / 2 + 0.66;
  const back = -FLOOR_DEPTH / 2 - 1.02;
  const front = FLOOR_DEPTH / 2 + 1.22;
  produceCrate(group, -outside - 0.09, grade, 0.0, -0.24);
  produceCrate(group, -outside - 0.29, grade + 0.32, -0.29, -0.39);
  boxShelf(group, outside + 0.17, -0.06);
  for (const side of [-1, 1]) {
    lantern(group, scene, side * (outside - 0.12), back + 0.04);
    herbPot(group, side * (outside + 0.52), back + 0.46, 0.91);
    herbPot(group, side * (outside + 0.06), front - 0.25, 1.12);
    drain(group, side * (outside - 0.51), 1.97, Math.PI / 2);
    inlay(group, side * (outside + 0.20), -2.08, side * Math.PI / 4);
    inlay(group, side * (outside - 0.29), front + 0.23, -side * Math.PI / 4);
  }
  drain(group, 0, front - 0.08, 0);
}
