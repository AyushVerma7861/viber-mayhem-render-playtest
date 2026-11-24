import * as THREE from 'three';
import { fitKitchenCamera, makeKitchenCamera } from './camera.ts';
import { buildCourtyard, chefBadge, warmPool } from './courtyard.ts';
import { makeViber } from './shared/viber-model.ts';
import { ballGeo, batchMeshes, bevel, box, latheGeo, mat, part, round, tubeGeo } from './shared/scene-parts.ts';
import { VIBERS } from './shared/vibers.ts';
import type { Viber } from './shared/vibers.ts';
import {
  APPROACHES, COUNTERS, FLOOR_DEPTH, FLOOR_WIDTH, PLATE_RADIUS, PLATE_REACH,
  SOLIDS, SUPPLY_GOALS, SUPPLY_POINTS, SUPPLY_RECTS, WALK_BOUNDARY, crossingAt, offset,
} from './layout.ts';
import type { Polygon, Vec } from './layout.ts';
import { distance } from './geometry.ts';
import { BAKE_TICKS, FOODS, TRAY_REFILL_TICKS, platePosition } from './simulation.ts';
import type { Food, PizzaEvent, PizzaPose } from './simulation.ts';
import type { PizzaDisplay, PizzaTimedEvent } from './network-state.ts';
import { TOPPING_TRANSFER_TICKS } from './chef-pose.ts';
import type { RunnerStride } from './kitchen-sounds.ts';
import { StationChef } from './station-chef.ts';

const cream = mat('#ecd1a8', 0, 0.43);
const steel = mat('#a8aaa1', 0, 0.31, 0.28);
const ink = mat('#193830', 0, 0.48);
const enamel = mat('#2e5b48', 0, 0.37, 0.07);
const brass = mat('#cda678', 0, 0.37, 0.32);
const lime = mat('#d8d46c', 0.10, 0.41);
const porcelain = mat('#f5dcba', 0, 0.43);
const grout = mat('#947467', 0, 0.86);
const viberScale = 0.72;
const ingredientBenchHeight = 0.74;
const plating = new Map<Food, THREE.Group>();

function footprint(polygon: Polygon): THREE.Shape {
  const shape = new THREE.Shape();
  polygon.forEach(({ x, z }, i) => i ? shape.lineTo(x, -z) : shape.moveTo(x, -z));
  shape.closePath();
  return shape;
}

function slab(group: THREE.Object3D, polygon: Polygon, material: THREE.Material, bottom: number, depth: number, bevelSize = 0) {
  const geometry = new THREE.ExtrudeGeometry(footprint(polygon), {
    depth, bevelEnabled: bevelSize > 0, bevelSegments: 1, bevelThickness: bevelSize, bevelSize,
  });
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = bottom;
  group.add(mesh);
}

function topping(food: Food, scale = 1): THREE.Group {
  const prototype = plating.get(food) ?? buildTopping(food);
  const group = prototype.clone();
  group.scale.setScalar(scale);
  return group;
}

function buildTopping(food: Food): THREE.Group {
  const group = new THREE.Group();
  if (food === 'tomato') {
    part(group, ballGeo, mat('#ed4429', 0, 0.26), 0, 0.12, 0, 0.18, 0.14, 0.17);
    part(group, tubeGeo, mat('#476438'), 0, 0.259, 0, 0.018, 0.058, 0.018).rotation.z = 0.42;
    for (let leaf = 0; leaf < 5; leaf++) {
      const a = leaf * Math.PI * 0.4;
      part(group, ballGeo, mat('#608049'), Math.sin(a) * 0.041, 0.251, Math.cos(a) * 0.041, 0.018, 0.012, 0.053).rotation.y = a;
    }
  } else if (food === 'cheese') {
    const wedge = new THREE.CylinderGeometry(0.20, 0.20, 0.15, 3, 1);
    part(group, wedge, mat('#ffc240'), 0, 0.075, 0, 1.2, 1, 1.26).rotation.y = -0.45;
    for (const [x, z] of [[-0.04, 0.08], [0.081, 0.025], [-0.073, -0.043]]) {
      part(group, latheGeo, mat('#d88629'), x, 0.154, z, 0.024, 0.006, 0.021);
    }
  } else if (food === 'meat') {
    for (const [x, y, z, size] of [[-0.03, 0.034, 0.036, 0.174], [0.049, 0.069, -0.032, 0.155], [-0.008, 0.104, 0.006, 0.159]]) {
      part(group, latheGeo, mat('#a83231'), x, y, z, size, 0.044, size * 0.81);
      part(group, latheGeo, mat('#e26a57', 0, 0.58), x, y + 0.022, z, size * 0.91, 0.014, size * 0.73);
    }
    for (const [x, z] of [[-0.072, -0.032], [0.048, 0.050], [0.099, -0.024], [-0.034, 0.061], [0.035, -0.069]]) {
      part(group, ballGeo, mat('#ffdb9c'), x, 0.135, z, 0.023, 0.008, 0.015);
    }
  } else {
    const green = ['#67a341', '#83b94b', '#4a8539'];
    for (let i = 0; i < 7; i++) {
      const a = i * 2.39996;
      const r = i < 4 ? 0.087 : 0.052;
      const leaf = part(group, ballGeo, mat(green[i % 3], 0, 0.54), Math.sin(a) * r, 0.049 + i * 0.012,
        Math.cos(a) * r, 0.076, 0.030, 0.124);
      leaf.rotation.set(0.34 + i * 0.063, a, -0.22);
    }
    bevel(group, mat('#c4d772'), 0.025, 0.138, 0.046, 0.019, 0.013, 0.117).rotation.y = -0.55;
  }
  const result = new THREE.Group();
  batchMeshes(group, result);
  plating.set(food, result);
  return result;
}

function tiles(group: THREE.Object3D) {
  const density = 96;
  const tileSize = 54;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(FLOOR_WIDTH * density);
  canvas.height = Math.round(FLOOR_DEPTH * density);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#a77f68';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const colors = ['#dfbf9e', '#e1b893', '#ebc8a4', '#e9c29d', '#e1b28f'];
  for (let row = 0, y = 0; y < canvas.height; row++, y += tileSize) {
    for (let col = 0, x = row % 2 ? -tileSize / 3 : 0; x < canvas.width; col++, x += tileSize) {
      const centerX = (x + tileSize / 2) / density - FLOOR_WIDTH / 2;
      const centerZ = (y + tileSize / 2) / density - FLOOR_DEPTH / 2;
      const crossing = crossingAt({ x: centerX, z: centerZ }) >= 0;
      ctx.fillStyle = crossing ? '#e8b77f' : colors[(row * 7 + col * 11 + row * col) % colors.length];
      ctx.beginPath();
      ctx.roundRect(x + 1.2, y + 1.2, tileSize - 2.4, tileSize - 2.4, 1.6);
      ctx.fill();
      ctx.fillStyle = '#fff3d943';
      ctx.fillRect(x + 2, y + 1, tileSize - 4, 2);
      ctx.fillStyle = '#694a3422';
      ctx.fillRect(x + 3, y + tileSize - 2, tileSize - 6, 1);
      for (let speck = 0; speck < 12; speck++) {
        const pick = (row * 199 + col * 163 + speck * 311) ^ (row * col * 17 + speck * 6457);
        ctx.fillStyle = speck % 3 ? '#ac7c581b' : '#fff0d530';
        ctx.fillRect(x + 4 + (pick >>> 0) % (tileSize - 7), y + 4 + ((pick >>> 5) % (tileSize - 7)), 1.1, 1.0);
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const geometry = new THREE.ShapeGeometry(footprint(WALK_BOUNDARY));
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < position.count; i++) {
    uv.setXY(i, 0.5 + position.getX(i) / FLOOR_WIDTH, 0.5 + position.getY(i) / FLOOR_DEPTH);
  }
  geometry.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: texture, roughness: 0.79 }));
  ground.position.y = 0.016;
  ground.receiveShadow = true;
  group.add(ground);
}

function buildIsland(group: THREE.Group, index: number) {
  const { center, south, points } = SOLIDS[index];
  const warmer = index === 1;
  slab(group, points, ink, 0.015, 0.12);
  slab(group, points, enamel, 0.11, 0.455);
  slab(group, points, brass, 0.565, 0.030);
  slab(group, points, warmer ? steel : porcelain, 0.601, 0.084, 0.023);
  for (const shift of (warmer ? [-0.48, 0.48] : [0])) {
    bevel(group, ink, center.x + shift, 0.335, south, 0.89, 0.364, 0.041);
    for (const y of [0.225, 0.285, 0.345]) bevel(group, enamel, center.x + shift, y, south + 0.027, 0.76, 0.026, 0.029);
    bevel(group, lime, center.x + shift, 0.447, south + 0.013, 0.338, 0.053, 0.095);
  }
  for (const shift of [-0.69, 0.69]) for (const edge of [-1, 1]) {
    part(group, tubeGeo, brass, center.x + shift, 0.699, center.z + edge * 0.596, 0.036, 0.013, 0.036);
  }
  if (!warmer) chefBadge(group, center.x - 0.65, 0.342, south + 0.011, 0.244);
  if (warmer) {
    bevel(group, steel, center.x, 0.707, center.z, 1.74, 0.073, 0.59);
    bevel(group, mat('#292927', 0, 0.57), center.x, 0.746, center.z, 1.58, 0.027, 0.48);
    for (const dz of [-0.16, -0.08, 0, 0.08, 0.16]) {
      bevel(group, mat('#ed631e', 0.68, 0.53), center.x, 0.764, center.z + dz, 1.40, 0.016, 0.029);
      bevel(group, mat('#ffc36d', 0.57, 0.57), center.x, 0.777, center.z + dz - 0.015, 1.34, 0.011, 0.024);
    }
    for (const side of [-1, 1]) {
      const handle = new THREE.TorusGeometry(0.096, 0.023, 6, 12, Math.PI * 1.65);
      part(group, handle, brass, center.x + side * 0.91, 0.38, south + 0.034, 0.79, 1, 1).rotation.z = side * 0.45;
    }
  }
}

function counter(group: THREE.Group, index: number, viber: Viber) {
  const { center, inward } = COUNTERS[index];
  const stand = new THREE.Group();
  stand.position.set(center.x, 0, center.z);
  stand.rotation.y = Math.atan2(inward.x, inward.z);
  group.add(stand);
  const accent = mat(viber.color, 0.07, 0.51);
  bevel(stand, ink, 0, 0.28, 0, 2.67, 0.53, 0.83);
  round(stand, enamel, 0, 0.40, 0, 2.63, 0.44, 0.80);
  bevel(stand, brass, 0, 0.612, 0.023, 2.66, 0.038, 0.864);
  bevel(stand, porcelain, 0, 0.690, 0.02, 2.72, 0.134, 0.93);
  bevel(stand, steel, 0, 0.753, 0.04, 1.20, 0.042, 0.61);
  bevel(stand, mat('#575a50', 0, 0.37, 0.22), 0, 0.775, 0.04, 1.10, 0.015, 0.552);
  for (const side of [-1, 1]) {
    bevel(stand, ink, 0, 0.348, side * 0.398, 1.42, 0.324, 0.056);
    for (const y of [0.217, 0.273, 0.329, 0.384]) bevel(stand, enamel, 0, y, side * 0.434, 1.31, 0.028, 0.034);
    bevel(stand, accent, 0, 0.455, side * 0.435, 0.59, 0.066, 0.062);
    chefBadge(stand, 0.89, 0.343, side * 0.414, 0.226).rotation.y = side > 0 ? 0 : Math.PI;
  }
  for (const side of [-1, 1]) {
    bevel(stand, accent, side * 1.254, 0.401, 0.414, 0.078, 0.231, 0.048);
    bevel(stand, accent, side * 1.254, 0.401, -0.414, 0.078, 0.231, 0.048);
    round(stand, steel, side * 0.89, 0.762, 0.09, 0.49, 0.065, 0.57);
    bevel(stand, cream, side * 0.89, 0.796, 0.10, 0.393, 0.025, 0.465);
    for (const edge of [-1, 1]) part(stand, tubeGeo, brass, side * 1.23, 0.761, edge * 0.342, 0.030, 0.014, 0.030);
  }
}

function counterFront(scene: THREE.Scene, id: number, viber: Viber) {
  const { trigger, inward } = COUNTERS[id];
  const mat = new THREE.MeshBasicMaterial({ color: viber.color, transparent: true, opacity: 0.27, depthWrite: false });
  const zone = new THREE.Mesh(new THREE.PlaneGeometry(2.48, 0.31), mat);
  zone.rotation.set(-Math.PI / 2, 0, Math.atan2(inward.x, inward.z));
  zone.position.set(trigger.x, 0.032, trigger.z);
  scene.add(zone);
}

function planter(group: THREE.Group, x: number, z: number) {
  bevel(group, ink, x, 0.19, z, 1.0, 0.41, 0.61);
  round(group, mat('#b66a54'), x, 0.41, z, 1.04, 0.23, 0.69);
  bevel(group, mat('#513e2c'), x, 0.54, z, 0.88, 0.036, 0.53);
  for (const [dx, dz, height, tint] of [[-0.23, 0.02, 0.55, '#83a84e'], [0.17, -0.05, 0.43, '#56965d'], [0.38, 0.06, 0.29, '#a1b956']] as const) {
    const leaf = part(group, ballGeo, mat(tint), x + dx, 0.49 + height * 0.55, z + dz, 0.22, height * 0.58, 0.21);
    leaf.rotation.z = dx;
  }
}

export class PizzaView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = makeKitchenCamera();
  private readonly point = new THREE.Vector3();
  private readonly rigs;
  private readonly supplyProps = SUPPLY_POINTS.map(() => FOODS.map(food => topping(food, 1.70)));
  private readonly refillBars: { mesh: THREE.Mesh; lamp: THREE.MeshBasicMaterial }[] = [];
  private readonly carriedProps = VIBERS.map(() => FOODS.map(food => topping(food, 1.18)));
  private readonly servedProps = VIBERS.map(() => [-0.89, 0.89].map(() => FOODS.map(food => topping(food, 0.92))));
  private readonly deliveryTrays = VIBERS.map(() => [new THREE.Group(), new THREE.Group()]);
  private readonly chefs: StationChef[] = [];
  private warmerLight!: THREE.MeshBasicMaterial;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private canvas: HTMLCanvasElement, private readonly roster: readonly Viber[] = VIBERS) {
    this.rigs = roster.map(viber => makeViber(viber));
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setClearColor('#142b29', 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.025;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.add(new THREE.HemisphereLight('#fff2df', '#687c73', 1.56));
    const key = new THREE.DirectionalLight('#ffdfae', 2.23);
    key.position.set(-5, 10, 4.6);
    key.castShadow = true;
    key.shadow.camera.left = -9.2;
    key.shadow.camera.right = 9.2;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -7;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 26;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.00018;
    key.shadow.normalBias = 0.025;
    key.shadow.radius = 2;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight('#ceeaff', 0.58);
    fill.position.set(4, 5, -7);
    this.scene.add(fill);
    this.buildKitchen();

    this.rigs.forEach((rig, id) => {
      rig.root.scale.setScalar(viberScale);
      this.scene.add(rig.root);
      const tray = new THREE.Group();
      tray.position.set(0, 0.60, PLATE_REACH / viberScale);
      rig.turn.add(tray);
      const radius = PLATE_RADIUS / viberScale;
      part(tray, latheGeo, mat('#ded6c4'), 0, 0, 0, radius, 0.077, radius);
      part(tray, latheGeo, mat('#fff2de', 0.085, 0.41), 0, 0.043, 0, radius * 0.97, 0.031, radius * 0.97);
      part(tray, latheGeo, mat('#c9bb9d'), 0, 0.061, 0, radius * 0.71, 0.008, radius * 0.71);
      this.carriedProps[id].forEach(item => { item.position.y = 0.059; tray.add(item); });
      rig.halo.visible = true;
    });
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  private resize(): void {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (width < 2 || height < 2) return;
    fitKitchenCamera(this.camera, width, height);
    this.renderer.setSize(width, height, false);
  }

  private buildKitchen(): void {
    const scenery = new THREE.Group();
    buildCourtyard(scenery, this.scene);
    slab(this.scene, WALK_BOUNDARY, grout, -0.045, 0.050);
    slab(scenery, WALK_BOUNDARY, mat('#5a4838'), -0.346, 0.165, 0.083);
    slab(scenery, WALK_BOUNDARY, mat('#876b56'), -0.199, 0.097, 0.049);
    slab(scenery, WALK_BOUNDARY, ink, -0.111, 0.083, 0.021);
    tiles(this.scene);
    for (const [i, a] of WALK_BOUNDARY.entries()) {
      const b = WALK_BOUNDARY[(i + 1) % WALK_BOUNDARY.length];
      const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
      const dx = b.x - a.x, dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      const angle = -Math.atan2(dz, dx);
      bevel(scenery, ink, x, 0.024, z, length, 0.086, 0.121).rotation.y = angle;
      bevel(scenery, lime, x, 0.078, z, length, 0.042, 0.091).rotation.y = angle;
    }

    const benches = new THREE.Group();
    benches.scale.y = ingredientBenchHeight;
    scenery.add(benches);
    SOLIDS.forEach((_, i) => buildIsland(i === 1 ? scenery : benches, i));
    this.warmerLight = warmPool(this.scene, SOLIDS[1].center.x, 0.021, SOLIDS[1].center.z, 3.16, 0.28);
    SUPPLY_POINTS.forEach(({ x, z }, index) => {
      const { side } = SUPPLY_RECTS[index];
      const { position: spot } = APPROACHES[SUPPLY_GOALS[index][0]];
      bevel(benches, cream, x, 0.706, z, 0.96, 0.047, 0.56);
      round(benches, steel, x, 0.744, z, 0.90, 0.077, 0.50);
      round(benches, mat('#45514c', 0, 0.43), x, 0.780, z, 0.82, 0.038, 0.43);
      const edge = z + side * 0.263;
      bevel(benches, ink, x, 0.793, edge, 0.56, 0.032, 0.074);
      const lamp = new THREE.MeshBasicMaterial({ color: '#e0ec8b' });
      const mesh = box(this.scene, lamp, x, 0.813 * ingredientBenchHeight, edge, 0.48, 0.010, 0.042);
      mesh.castShadow = mesh.receiveShadow = false;
      this.refillBars.push({ mesh, lamp });
      const paint = mat('#59816a', 0, 0.92);
      bevel(scenery, paint, x, 0.020, spot.z - side * 0.11, 0.72, 0.008, 0.038);
      for (const end of [-1, 1]) {
        bevel(scenery, paint, x + end * 0.34, 0.020, spot.z + side * 0.007, 0.041, 0.008, 0.27);
      }
      const toppings = new THREE.Group();
      toppings.position.set(x, 0.820 * ingredientBenchHeight, z);
      this.supplyProps[index].forEach(item => toppings.add(item));
      this.scene.add(toppings);
    });
    COUNTERS.forEach((_, id) => {
      counter(scenery, id, this.roster[id]);
      counterFront(this.scene, id, this.roster[id]);
      this.chefs.push(new StationChef(id, scenery, this.scene, this.roster[id]));
      this.servedProps[id].forEach((items, index) => {
        const tray = this.deliveryTrays[id][index];
        items.forEach(item => tray.add(item));
        this.scene.add(tray);
      });
    });
    planter(scenery, -FLOOR_WIDTH / 2 + 0.7, -FLOOR_DEPTH / 2 - 0.14);
    planter(scenery, FLOOR_WIDTH / 2 - 0.7, FLOOR_DEPTH / 2 + 0.14);

    batchMeshes(scenery, this.scene);
  }

  project(position: Vec, height = 0): { x: number; y: number } {
    this.point.set(position.x, height, position.z).project(this.camera);
    return { x: (this.point.x + 1) * this.canvas.clientWidth / 2, y: (1 - this.point.y) * this.canvas.clientHeight / 2 };
  }

  runnerLabel(id: number): { x: number; y: number } {
    const { root, labelHeight } = this.rigs[id];
    return this.project(root.position, root.position.y + root.scale.y * labelHeight);
  }

  reset(): void {
    this.chefs.forEach(chef => chef.reset());
  }

  event(match: PizzaDisplay, event: PizzaEvent & Partial<PizzaTimedEvent>): void {
    if (event.type === 'deliver' && event.counter !== undefined) {
      this.chefs[event.counter].receive(event.plate ?? platePosition(match.players[event.player]), event.tick ?? match.tick);
    } else if (event.type === 'ready') this.chefs[event.player].reset();
  }

  render(match: PizzaDisplay, alpha: number, strides: readonly RunnerStride[], local?: { seat: number; pose: PizzaPose }): void {
    const motion = !this.reducedMotion.matches;
    const tick = match.tick + alpha;
    this.warmerLight.opacity = 0.29 + (motion ? Math.sin(tick * 0.076) * 0.032 : 0);
    match.supplies.forEach((food, index) => {
      const refillAt = match.trayReadyAt[index];
      const ready = match.tick >= refillAt;
      const { mesh, lamp } = this.refillBars[index];
      const fill = ready ? 1 : THREE.MathUtils.clamp(1 - (refillAt - tick) / TRAY_REFILL_TICKS, 0.12, 1);
      mesh.scale.x = 0.48 * fill;
      lamp.color.set(ready ? '#e0ec8b' : '#e8a05a');
      this.supplyProps[index].forEach((item, i) => {
        item.visible = ready && FOODS[i] === food;
        if (item.visible) {
          const arrival = motion && refillAt > 0 ? THREE.MathUtils.clamp((tick - refillAt) / 7, 0, 1) : 1;
          item.scale.setScalar(1.70 * (1 - 0.21 * (1 - arrival) ** 2));
        }
      });
    });
    for (const player of match.players) {
      const rig = this.rigs[player.id];
      const predicted = local?.seat === player.id ? local.pose : undefined;
      const moved = distance(player.previous, player.position) > 0.007;
      const stride = strides[player.id];
      const walk = moved && motion ? Math.sin(Math.PI * THREE.MathUtils.lerp(stride.previous, stride.current, alpha)) : 0;
      const bump = motion ? Math.max(0, 1 - (match.tick - player.bumpAt) / 11) : 0;
      rig.root.position.set(
        predicted?.position.x ?? THREE.MathUtils.lerp(player.previous.x, player.position.x, alpha),
        Math.abs(walk) * 0.032,
        predicted?.position.z ?? THREE.MathUtils.lerp(player.previous.z, player.position.z, alpha),
      );
      const heading = predicted?.heading ?? THREE.MathUtils.lerp(player.previousHeading, player.heading, alpha);
      rig.turn.rotation.y = heading;
      const sideways = player.recoil.x * Math.cos(heading) - player.recoil.z * Math.sin(heading);
      const forward = player.recoil.x * Math.sin(heading) + player.recoil.z * Math.cos(heading);
      rig.torso.rotation.z = walk * 0.045 - (motion ? sideways * 0.085 : 0);
      rig.torso.rotation.x = motion ? forward * 0.075 : 0;
      rig.boots.forEach((boot, index) => { boot.rotation.x = walk * (index ? -0.56 : 0.56); });
      rig.arms.forEach(arm => { arm.rotation.x = -1.03 + bump * 0.17; });
      this.carriedProps[player.id].forEach((item, index) => { item.visible = player.carried === FOODS[index]; });

      const chef = this.chefs[player.id];
      chef.render(player, tick, moved, motion);
      const { center, inward, tangent } = COUNTERS[player.id];
      const showToppings = player.serviceAt < 0 || tick - player.serviceAt < BAKE_TICKS;
      this.servedProps[player.id].forEach((items, slot) => {
        const delivered = showToppings ? player.delivered[slot] : undefined;
        items.forEach((item, index) => { item.visible = delivered === FOODS[index]; });
        if (!delivered) return;
        const tray = this.deliveryTrays[player.id][slot];
        const { x, z } = offset(offset(center, inward, 0.10), tangent, slot === 0 ? -0.89 : 0.89);
        const receipt = chef.deliveries[slot];
        const travel = receipt && motion ? THREE.MathUtils.clamp((tick - receipt.tick) / TOPPING_TRANSFER_TICKS, 0, 1) : 1;
        const slide = 1 - (1 - travel) * (1 - travel);
        tray.position.set(
          THREE.MathUtils.lerp(receipt?.plate.x ?? x, x, slide),
          THREE.MathUtils.lerp(0.495, 0.809, slide) + Math.sin(travel * Math.PI) * 0.24,
          THREE.MathUtils.lerp(receipt?.plate.z ?? z, z, slide),
        );
      });
    }
    this.renderer.render(this.scene, this.camera);
  }
}
