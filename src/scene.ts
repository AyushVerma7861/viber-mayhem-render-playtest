import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildKitchen, KITCHEN_FRAMING, makeCooker, makeTrolley } from './kitchen-scene.ts';
import { makeViber } from './viber-model.ts';
import type { Viber } from './vibers.ts';
import { ballGeo, batchMeshes, box, mat, part, ring, round, tubeGeo } from './scene-parts.ts';
import type { Rig } from './scene-parts.ts';
import { KITCHEN_ARENA } from './arena.ts';
import {
  CART_BODY_LENGTH, CART_BODY_WIDTH, CART_HUB_DEPTH, CART_HUB_OFFSET,
  CAST, FUSE_TICKS, LIMIT, PLAYER_RADIUS, ROUTES, STUN_TICKS, routePoint,
} from './simulation.ts';
import type { MatchView, Player } from './simulation.ts';
import type { LocalPose } from './online-movement.ts';

const steel = mat('#344959');
const structure = mat('#182933');
const trim = mat('#4b646f');
const rubber = mat('#101e29');
const ivory = mat('#c2d4d4');
const yellow = mat('#f9bf69', 0.28);
const cyan = mat('#67dce7', 0.32);

function beam(group: THREE.Object3D, material: THREE.Material, a: THREE.Vector3, b: THREE.Vector3,
  width: number, height: number): void {
  const center = a.clone().lerp(b, 0.5);
  const item = box(group, material, center.x, center.y, center.z, a.distanceTo(b), height, width);
  item.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), b.clone().sub(a).normalize());
}

function floorType(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 448;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#344752';
  ctx.fillRect(0, 0, 768, 448);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 12; col++) {
      const shade = 0.06 + 0.05 * Math.sin(row * 51 + col * 16);
      ctx.fillStyle = 'rgba(4,17,28,' + shade + ')';
      ctx.fillRect(col * 64, row * 56, 63, 55);
      ctx.fillStyle = 'rgba(182,221,219,.12)';
      ctx.fillRect(col * 64, row * 56, 64, 1);
      ctx.fillRect(col * 64, row * 56, 1, 56);
    }
  }
  for (let i = 0; i < 12000; i++) {
    const x = ((i * 19577) % 63689) % 768;
    const y = ((i * 9281) % 98377) % 448;
    ctx.fillStyle = i % 3 ? 'rgba(179,222,215,.055)' : 'rgba(7,10,19,.14)';
    ctx.fillRect(x, y, 1 + i % 4, 1);
  }
  ctx.strokeStyle = '#8faaa799';
  ctx.lineWidth = 2;
  for (const x of [129, 639]) {
    for (const y of [99, 349]) {
      ctx.beginPath();
      ctx.arc(x, y, 23, 0.25, Math.PI * 1.8);
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#a2b9b35c';
  ctx.textAlign = 'center';
  ctx.font = 'bold 25px monospace';
  ctx.fillText('FREIGHT  /  02', 384, 221);
  ctx.font = 'bold 10px monospace';
  ctx.fillText('KEEP THE CROSSING CLEAR', 384, 238);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function yard(scene: THREE.Scene): THREE.Mesh[][] {
  const scenery = new THREE.Group();
  const signals: THREE.Mesh[][] = [[], []];
  const deck = new THREE.MeshStandardMaterial({ map: floorType(), roughness: 0.98 });
  const surface = part(scenery, new THREE.PlaneGeometry(1, 1), deck, 0, 0.012, 0, 18.8, 10.8, 1);
  surface.rotation.x = -Math.PI / 2;
  box(scenery, structure, 0, -0.42, 0, 20.0, 0.85, 11.8);
  box(scenery, mat('#243846'), 0, -0.84, 0, 20.5, 0.22, 12.15);
  box(scenery, mat('#172630'), 0, -1.06, 0, 19.8, 0.25, 11.6);

  for (const side of [-1, 1]) {
    box(scenery, trim, 0, 0.02, side * 5.58, 19.4, 0.14, 0.39);
    box(scenery, rubber, 0, -0.17, side * 5.82, 19.6, 0.25, 0.18);
    for (let x = -9.1; x <= 9.12; x += 0.48) {
      box(scenery, yellow, x, 0.096, side * 5.53, 0.25, 0.017, 0.095).rotation.y = -0.45;
    }
    for (const x of [-8.6, -5.7, -2.85, 0, 2.85, 5.7, 8.6]) {
      box(scenery, steel, x, -0.44, side * 5.94, 0.24, 0.51, 0.18);
      box(scenery, structure, x, -1.7, side * 5.2, 0.75, 1.35, 0.78);
      if (side < 0) {
        box(scenery, steel, x, 0.39, -5.68, 0.17, 0.79, 0.24);
        box(scenery, yellow, x, 0.79, -5.68, 0.19, 0.075, 0.23);
      }
    }
    if (side < 0) box(scenery, trim, 0, 0.61, -5.68, 18, 0.12, 0.18);
  }

  for (const lane of [0, 1]) {
    const light = lane === 0 ? yellow : cyan;
    const track = lane === 0 ? mat('#9c7647', 0.09) : mat('#538b95', 0.12);
    const strip = mat('#263844');
    const sleeper = mat('#1b2c36');
    for (let i = 0; i < 56; i++) {
      const a = routePoint(lane, i / 56);
      const b = routePoint(lane, (i + 1.01) / 56);
      const heading = Math.atan2(b.z - a.z, b.x - a.x);
      const dx = -Math.sin(heading);
      const dz = Math.cos(heading);
      const midX = (a.x + b.x) / 2;
      const midZ = (a.z + b.z) / 2;
      const len = Math.hypot(a.x - b.x, a.z - b.z);
      box(scenery, strip, midX, 0.015, midZ, len + 0.01, 0.015, 1.49).rotation.y = -heading;
      box(scenery, sleeper, midX, 0.036, midZ, 0.136, 0.028, 1.27).rotation.y = -heading;
      for (const side of [-1, 1]) {
        box(scenery, track, midX + side * dx * 0.46, 0.055, midZ + side * dz * 0.46,
          len + 0.014, 0.039, 0.072).rotation.y = -heading;
        if (i % 3 === 1) {
          box(scenery, light, midX + side * dx * 0.80, 0.027, midZ + side * dz * 0.80,
            0.22, 0.013, 0.039).rotation.y = -heading - 0.35;
        }
      }
    }
    for (const end of [0.063, 0.937]) {
      const { x, z } = routePoint(lane, end);
      for (const side of [-1, 1]) {
        box(scenery, structure, x, 0.7, z + side * 0.85, 0.48, 1.62, 0.23);
        box(scenery, light, x, 1.03, z + side * 0.978, 0.31, 0.068, 0.02);
      }
      box(scenery, steel, x, 1.53, z, 0.53, 0.22, 1.92);
      box(scenery, rubber, x, 1.59, z, 0.56, 0.062, 1.99);
      if (end < 0.1) {
        const bulb = mat(ROUTES[lane].color, 0.45).clone();
        for (const offset of [-0.56, 0, 0.56]) {
          signals[lane].push(box(scene, bulb, x, 1.65, z + offset, 0.39, 0.076, 0.15));
        }
      } else {
        box(scenery, light, x, 1.62, z, 0.33, 0.055, 0.55);
      }
      box(scenery, structure, x * 1.13, -0.43, z, 2.9, 0.65, 2.15);
    }
  }

  for (const x of [-7.9, -3.7, 2.6, 8.0]) {
    box(scenery, structure, x, 0.48, -7.1, 1.24, 1.17, 0.89);
    box(scenery, steel, x, 1.10, -7.1, 1.36, 0.12, 0.95);
    for (const shift of [-0.37, 0, 0.37]) {
      box(scenery, trim, x + shift, 0.54, -6.64, 0.095, 0.9, 0.055);
    }
  }
  for (const x of [-10.4, 10.4]) {
    box(scenery, structure, x, 1.05, -6.35, 0.19, 2.85, 0.23);
    box(scenery, steel, x, 2.48, -6.12, 0.52, 0.16, 0.72);
    box(scenery, yellow, x, 2.37, -5.95, 0.35, 0.07, 0.2);
    beam(scenery, trim, new THREE.Vector3(x, 1.7, -6.34), new THREE.Vector3(x, 2.42, -5.83), 0.075, 0.075);
  }

  const base = mat('#15232d');
  box(scenery, base, 0, -2.75, 0, 65, 0.3, 55);
  const grid = mat('#243743');
  for (let i = -28; i <= 28; i += 2) {
    box(scenery, grid, i, -2.592, 0, 0.018, 0.009, 50);
    box(scenery, grid, 0, -2.591, i, 60, 0.009, 0.018);
  }

  batchMeshes(scenery, scene, [base, grid, deck]);
  return signals;
}

function courier(id: number): Rig {
  const root = new THREE.Group();
  const turn = new THREE.Group();
  const torso = new THREE.Group();
  root.add(turn);
  turn.add(torso);
  const color = CAST[id].color;
  const jacket = mat(color);
  const piping = mat(color, 0.22);
  const suit = mat('#293844');
  const visor = mat('#131d2c');
  const eyes = mat('#edfff3', 0.82);
  round(torso, suit, 0, 0.15, -0.19, 0.67, 0.63, 0.48);
  round(torso, jacket, 0, 0.21, 0.01, 0.76, 0.67, 0.58);
  round(torso, suit, 0, 0.006, 0.039, 0.71, 0.16, 0.57);
  round(torso, ivory, 0, 0.035, 0.334, 0.17, 0.12, 0.052);
  const arms = [-1, 1].map(side => {
    round(torso, piping, side * 0.392, 0.27, 0, 0.14, 0.19, 0.25);
    const arm = round(torso, jacket, side * 0.44, 0.13, 0, 0.16, 0.32, 0.22);
    arm.rotation.z = side * 0.15;
    return arm;
  });
  round(torso, jacket, 0, 0.71, 0.017, 0.76, 0.53, 0.66);
  round(torso, visor, 0, 0.69, 0.317, 0.62, 0.31, 0.11);
  for (const side of [-1, 1]) {
    round(torso, eyes, 0.12 * side, 0.708, 0.377, 0.056, 0.085, 0.025);
    round(torso, suit, 0.38 * side, 0.69, 0, 0.073, 0.17, 0.18);
  }
  const aerial = id % 2 ? -0.235 : 0.235;
  box(torso, suit, aerial, 0.997, -0.05, 0.042, 0.18 + id * 0.028, 0.042);
  part(torso, ballGeo, piping, aerial, 1.09 + id * 0.014, -0.05, 0.062, 0.062, 0.062);
  const boots = [-1, 1].map(side => round(turn, suit, side * 0.21, 0.126, 0.055, 0.29, 0.26, 0.49));
  const halo = ring(color, PLAYER_RADIUS + 0.19, id === 0 ? 0.05 : 0.028);
  halo.position.y = 0.075;
  const shadow = part(root, new THREE.CircleGeometry(1, 28),
    new THREE.MeshBasicMaterial({ color: '#081017', transparent: true, opacity: 0.44, depthWrite: false }),
    0, 0.054, 0, 0.55, 0.43, 1);
  shadow.rotation.x = -Math.PI / 2;
  shadow.castShadow = shadow.receiveShadow = false;
  root.add(halo);
  return { root, turn, torso, boots, arms, shadow, halo, labelHeight: 1.64 };
}

function freight(lane: number): THREE.Group {
  const group = new THREE.Group();
  const accent = lane === 0 ? yellow : cyan;
  const body = lane === 0 ? mat('#dc8453') : mat('#4a9cb0');
  const shadow = part(group, new THREE.CircleGeometry(1, 28),
    new THREE.MeshBasicMaterial({ color: '#071521', transparent: true, opacity: 0.59, depthWrite: false }),
    -0.04, 0.098, -0.025, 1.37, 0.60, 1);
  shadow.rotation.x = -Math.PI / 2;
  shadow.castShadow = shadow.receiveShadow = false;
  round(group, rubber, 0, 0.25, 0, CART_BODY_LENGTH, 0.24, CART_BODY_WIDTH);
  round(group, body, 0.07, 0.48, 0, 2.30, 0.43, 1.00);
  round(group, body, -0.35, 0.78, 0, 1.39, 0.28, 0.92);
  round(group, trim, -0.39, 0.94, 0, 1.32, 0.12, 0.83);
  box(group, rubber, -0.36, 1.017, 0, 0.49, 0.061, 0.71);
  round(group, accent, -0.36, 1.055, 0, 0.34, 0.055, 0.19);
  for (const x of [-0.75, 0.75]) {
    for (const side of [-1, 1]) {
      const wheel = part(group, tubeGeo, rubber, x, 0.25, side * 0.49, 0.235, 0.16, 0.235);
      wheel.rotation.x = Math.PI / 2;
      const hub = part(group, tubeGeo, trim, x, 0.25, side * CART_HUB_OFFSET, 0.095, CART_HUB_DEPTH, 0.095);
      hub.rotation.x = Math.PI / 2;
      round(group, accent, 1.19, 0.51, side * 0.307, 0.10, 0.13, 0.15);
      box(group, rubber, -0.15 + x * 0.35, 0.74, side * 0.46, 0.24, 0.075, 0.032);
    }
  }
  return group;
}

export class YardView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera();
  private rigs: Rig[] = [];
  private viberRigs = new Map<Viber, Rig>();
  private signals: THREE.Mesh[][];
  private carts = new Map<string, { lane: number; mesh: THREE.Group }>();
  private cartPool: THREE.Group[][] = [[], []];
  private cores = new THREE.Group();
  private crystal?: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshStandardMaterial>;
  private cooker?: ReturnType<typeof makeCooker>;
  private danger = ring('#ffcb66', 0.85, 0.11);
  private blast = new THREE.Group();
  private ventLid?: THREE.Group;
  private blastAt = -Infinity;
  private width = 1;
  private height = 1;
  private reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private pixelRatio: number;
  private software: boolean;
  private frameWindow = { from: 0, frames: 0, slowWindows: 0 };
  private point = new THREE.Vector3();

  constructor(private stage: HTMLElement, canvas: HTMLCanvasElement, private kitchen = false,
    private detail = false) {
    this.pixelRatio = detail ? THREE.MathUtils.clamp(devicePixelRatio, 1.35, 2)
      : Math.min(devicePixelRatio, 1.55);
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: detail || !matchMedia('(any-pointer: coarse)').matches, powerPreference: 'high-performance',
    });
    const gl = this.renderer.getContext();
    const rendererInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererName = rendererInfo ? gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL) : '';
    this.software = /swiftshader|llvmpipe|software rasterizer|basic render driver/i.test(rendererName);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = kitchen ? 0.98 : 1.37;
    this.scene.background = new THREE.Color(kitchen ? '#402931' : '#14232d');
    if (!kitchen) this.scene.fog = new THREE.FogExp2('#15242e', 0.023);
    if (kitchen) {
      const elevation = THREE.MathUtils.degToRad(27);
      const distance = Math.hypot(19.66, 21.68);
      const focusY = 0.34;
      const focusZ = -0.68;
      this.camera.position.set(0, focusY + Math.sin(elevation) * distance, focusZ + Math.cos(elevation) * distance);
      this.camera.lookAt(0, focusY, focusZ);
    } else {
      this.camera.position.set(0, 19, 19);
      this.camera.lookAt(0, -0.12, 0);
    }
    this.scene.add(new THREE.HemisphereLight(kitchen ? '#fff0df' : '#def7ff',
      kitchen ? '#b1929c' : '#43505a', kitchen ? 1.54 : 2.2));
    const sun = new THREE.DirectionalLight(kitchen ? '#ffe6c9' : '#ffe2af', kitchen ? 2.48 : 2.65);
    sun.position.set(-8, 15, kitchen ? -2 : 7);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(kitchen ? '#c8e2eb' : '#7cd6ff', kitchen ? 0.94 : 1.35);
    rim.position.set(6, 5, -8);
    this.scene.add(rim);

    this.signals = kitchen ? buildKitchen(this.scene) : yard(this.scene);
    if (kitchen && (detail || !this.software)) this.lightKitchen(sun);
    this.rigs = kitchen ? [] : CAST.map((_, id) => courier(id));
    for (const rig of this.rigs) this.scene.add(rig.root);
    for (const lane of [0, 1]) {
      for (let i = 0; i < 4; i++) this.cartPool[lane].push(this.makeCart(lane));
    }
    if (kitchen) {
      this.cooker = makeCooker();
      this.cores.add(this.cooker.cooker);
    } else {
      this.crystal = new THREE.Mesh(new THREE.IcosahedronGeometry(0.25, 0), mat('#ffd05e', 1.05).clone());
      const bands = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.021, 8, 24), mat('#fff2b4', 0.65));
      bands.rotation.x = Math.PI * 0.37;
      this.cores.add(this.crystal, bands);
    }
    this.scene.add(this.cores, this.danger, this.blast);
    const wave = ring('#ffd582', 0.85, 0.06);
    this.blast.add(wave);
    for (let i = 0; i < (kitchen ? 18 : 12); i++) {
      const shape = kitchen ? ballGeo : new THREE.OctahedronGeometry(1);
      const finish = kitchen ? new THREE.MeshBasicMaterial({ color: i % 3 ? '#f4fff9' : '#dcece9',
        transparent: true, opacity: 0, depthWrite: false }) : i % 3 ? yellow : ivory;
      part(this.blast, shape, finish, 0, 0, 0, 0.1, 0.16, 0.1);
    }
    this.blast.visible = false;
    if (kitchen) {
      this.ventLid = new THREE.Group();
      part(this.ventLid, tubeGeo, mat('#a3b0b3', 0, 0.32, 0.76), 0, 0, 0, 0.30, 0.055, 0.30);
      round(this.ventLid, mat('#392725'), 0, 0.07, 0, 0.18, 0.08, 0.11);
      this.ventLid.visible = false; this.scene.add(this.ventLid);
    }
    new ResizeObserver(() => this.resize()).observe(stage);
    this.resize();
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      stage.dispatchEvent(new Event('graphics-lost'));
    });
    canvas.addEventListener('webglcontextrestored', () => {
      if (kitchen && (detail || !this.software)) this.lightKitchen(sun);
      stage.dispatchEvent(new Event('graphics-restored'));
    });
  }

  private reflection?: THREE.WebGLRenderTarget;

  private lightKitchen(sun: THREE.DirectionalLight): void {
    this.reflection?.dispose();
    const environment = new RoomEnvironment();
    const generator = new THREE.PMREMGenerator(this.renderer);
    this.reflection = generator.fromScene(environment, 0.04, 0.1, 48, { size: 128 });
    this.scene.environment = this.reflection.texture;
    this.scene.environmentIntensity = 0.55;
    environment.dispose();
    generator.dispose();

    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(this.detail ? 2048 : 1024);
    Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 12, bottom: -12, near: 0.5, far: 44 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.00018;
    sun.shadow.normalBias = 0.034;
    sun.shadow.intensity = 0.63;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
  }

  setVibers(cast: readonly Viber[]): void {
    for (const rig of this.rigs) this.scene.remove(rig.root);
    this.rigs = cast.map(viber => {
      const existing = this.viberRigs.get(viber);
      if (existing) return existing;
      const rig = makeViber(viber);
      rig.root.traverse(item => { item.castShadow = false; });
      this.viberRigs.set(viber, rig);
      return rig;
    });
    for (const rig of this.rigs) this.scene.add(rig.root);
    this.reset();
  }

  private makeCart(lane: number): THREE.Group {
    return this.kitchen ? makeTrolley(lane) : freight(lane);
  }

  reset(): void {
    this.blastAt = -Infinity;
    this.blast.visible = false;
    if (this.ventLid) this.ventLid.visible = false;
    if (this.kitchen) for (const rig of this.rigs) rig.turn.rotation.y = 0;
  }

  overload(player: Readonly<Player>, time: number): void {
    this.blast.position.set(player.position.x, 0.085, player.position.z);
    this.blastAt = time;
  }

  project(id: number, element: HTMLElement): void {
    const rig = this.rigs[id];
    const position = rig.root.position;
    this.point.set(position.x, rig.labelHeight, position.z).project(this.camera);
    element.style.left = (this.point.x + 1) * this.width / 2 + 'px';
    element.style.top = (1 - this.point.y) * this.height / 2 + 'px';
  }

  draw(match: MatchView, alpha: number, time: number, localPose?: LocalPose): void {
    const span = time - this.frameWindow.from;
    if (!this.detail && span > 1500) {
      const slow = this.frameWindow.frames > 0 && this.frameWindow.frames * 1000 / span < 38;
      const slowWindows = slow ? this.frameWindow.slowWindows + 1 : 0;
      const floor = this.kitchen ? (this.software ? 0.70 : 0.84) : 0.66;
      if (slowWindows >= (this.kitchen ? 2 : 1) && this.pixelRatio > floor) {
        this.pixelRatio = Math.max(floor, this.pixelRatio * (this.kitchen && !this.software ? 0.91 : 0.82));
        this.renderer.setPixelRatio(this.pixelRatio);
      }
      this.frameWindow = { from: time, frames: 0, slowWindows };
    }
    this.frameWindow.frames++;
    const lerp = THREE.MathUtils.lerp;
    for (const player of match.players) {
      const rig = this.rigs[player.id];
      rig.root.visible = player.alive;
      if (!player.alive) continue;
      const predicted = localPose?.id === player.id ? localPose : undefined;
      rig.root.position.set(predicted?.position.x ?? lerp(player.previous.x, player.position.x, alpha), 0,
        predicted?.position.z ?? lerp(player.previous.z, player.position.z, alpha));
      const heading = predicted?.heading ?? player.heading;
      const rotation = Math.atan2(Math.sin(heading - rig.turn.rotation.y), Math.cos(heading - rig.turn.rotation.y));
      rig.turn.rotation.y += rotation * 0.28;
      const drive = predicted?.drive ?? player.drive;
      const moving = Math.min(1, Math.hypot(drive.x, drive.z) / 4);
      const cycle = (match.tick + alpha) * 0.37 + player.id * 0.8;
      const stun = Math.max(0, player.stunnedUntil - match.tick);
      const sway = this.reduceMotion ? 0 : Math.sin(cycle * 0.63) * 0.15;
      rig.torso.position.y = (stun ? 0.27 : 0.43) + Math.abs(Math.sin(cycle)) * 0.08 * moving;
      rig.torso.rotation.set(stun ? -0.42 : 0.14 * moving, 0, stun ? 0.52 + sway : 0);
      for (const [i, boot] of rig.boots.entries()) {
        const step = Math.sin(cycle + i * Math.PI) * moving;
        boot.position.z = 0.055 + step * 0.24;
        boot.position.y = 0.126 + Math.max(step, 0) * 0.12;
        boot.rotation.x = step * 0.27;
        rig.arms[i].rotation.x = this.kitchen && match.holder === player.id ? -0.92 : -step * 0.62;
      }
      rig.shadow.scale.x = 0.54 + 0.07 * moving;
      rig.halo.visible = match.holder !== player.id;
    }
    const activeCarts = new Set<string>();
    for (const cart of match.carts) {
      const key = cart.lane + ':' + cart.start;
      activeCarts.add(key);
      let entry = this.carts.get(key);
      if (!entry) {
        const mesh = this.cartPool[cart.lane].pop() ?? this.makeCart(cart.lane);
        entry = { lane: cart.lane, mesh };
        this.carts.set(key, entry);
        this.scene.add(mesh);
      }
      const { mesh } = entry;
      mesh.position.set(lerp(cart.previous.x, cart.position.x, alpha), 0,
        lerp(cart.previous.z, cart.position.z, alpha));
      mesh.rotation.y = -cart.heading;
    }
    for (const [key, { lane, mesh }] of this.carts) {
      if (activeCarts.has(key)) continue;
      this.scene.remove(mesh);
      this.cartPool[lane].push(mesh);
      this.carts.delete(key);
    }
    for (const [lane, lights] of this.signals.entries()) {
      const warning = match.lanes[lane]?.warned && match.phase === 'play';
      const material = lights[0].material as THREE.MeshStandardMaterial;
      material.emissiveIntensity = warning ? (this.reduceMotion ? 1.3 : 1.3 + 0.65 * Math.sin(match.tick * 0.26)) : 0.37;
    }
    const holder = match.holder === null ? undefined : this.rigs[match.holder].root.position;
    this.cores.visible = this.danger.visible = !!holder;
    if (holder) {
      const urgent = match.remaining < FUSE_TICKS * 0.28;
      const pulse = urgent && !this.reduceMotion ? 0.94 + 0.14 * Math.sin(match.tick * 0.44) : 1;
      this.cores.scale.setScalar(this.cooker ? 1.22 : pulse);
      if (this.cooker) {
        const pressure = 1 - match.remaining / FUSE_TICKS;
        const cycle = match.tick + alpha;
        const facing = this.rigs[match.holder!].turn.rotation.y;
        this.cores.position.set(holder.x + Math.sin(facing) * 0.61, 0.72, holder.z + Math.cos(facing) * 0.61);
        this.cores.rotation.set(0, facing, 0);
        this.cooker.lid.rotation.z = this.reduceMotion ? 0 : Math.sin(cycle * (0.26 + pressure * 0.6)) * pressure ** 2 * 0.17;
        this.cooker.lid.position.y = this.reduceMotion ? 0 : Math.abs(Math.sin(cycle * 0.66)) * pressure ** 3 * 0.055;
        this.cooker.needle.rotation.z = 1.13 - pressure * 2.26;
        this.cooker.gauge.emissiveIntensity = 0.12 + pressure * 0.22;
        for (const [i, puff] of this.cooker.steam.entries()) {
          puff.visible = this.reduceMotion ? i < 2 : i < 2 + Math.floor(pressure * 4);
          const age = this.reduceMotion ? 0.3 + i * 0.2 : (cycle / (58 - pressure * 31) + i / 6) % 1;
          puff.position.set(-0.13 - age * (0.12 + pressure * 0.2), 0.29 + age * (0.45 + pressure * 0.38),
            -0.035 + Math.sin(age * 4 + i) * age * 0.13);
          puff.scale.setScalar(0.045 + age * (0.10 + pressure * 0.15));
          (puff.material as THREE.MeshBasicMaterial).opacity = (1 - age) * (0.46 + pressure * 0.25);
        }
      } else if (this.crystal) {
        this.cores.position.set(holder.x + 0.64, 0.92 + Math.sin(match.tick * 0.095) * 0.075, holder.z + 0.16);
        this.cores.rotation.set(0.19, match.tick * 0.06, 0.36);
        this.crystal.material.color.set(urgent ? '#ff8955' : '#ffc960');
        this.crystal.material.emissive.copy(this.crystal.material.color);
      }
      this.danger.position.set(holder.x, 0.077, holder.z);
      this.danger.scale.setScalar(pulse);
      if (this.kitchen) (this.danger.material as THREE.MeshBasicMaterial).color.set(urgent ? '#f6b175' : '#ace2c5');
      (this.danger.material as THREE.MeshBasicMaterial).opacity = match.tick < match.passAt ? 0.52 : 1;
    }
    const age = (time - this.blastAt) / (this.kitchen ? 1150 : 620);
    this.blast.visible = age >= 0 && age < 1;
    if (this.blast.visible) {
      const wave = this.blast.children[0] as THREE.Mesh;
      wave.visible = !this.kitchen;
      wave.scale.setScalar(0.6 + age * 2.5);
      (wave.material as THREE.MeshBasicMaterial).opacity = (1 - age) * 0.88;
      for (let i = 1; i < this.blast.children.length; i++) {
        const piece = this.blast.children[i];
        piece.visible = this.kitchen || !this.reduceMotion;
        const angle = i * Math.PI / 6;
        if (this.kitchen) {
          const spread = this.reduceMotion ? 0.35 : 0.12 + age * 1.45;
          piece.position.set(Math.cos(angle) * spread * (0.6 + i % 3 * 0.18),
            0.42 + age * 1.6 + (i % 4) * 0.13, Math.sin(angle) * spread * 0.72);
          piece.scale.setScalar(0.16 + Math.sin(age * Math.PI) * (0.34 + i % 3 * 0.11));
          (piece as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.opacity = (1 - age) * 0.66;
        } else {
          piece.position.set(Math.cos(angle) * age * 2.4,
            Math.sin(age * Math.PI) * (0.55 + (i % 4) * 0.21), Math.sin(angle) * age * 2.4);
          piece.scale.setScalar((1 - age) * 0.13);
          piece.rotation.set(age * 3, angle, age * 2);
        }
      }
    }
    if (this.ventLid) {
      this.ventLid.visible = this.blast.visible && !this.reduceMotion;
      if (this.ventLid.visible) {
        this.ventLid.position.set(this.blast.position.x + age * 0.7,
          0.8 + Math.sin(age * Math.PI) * 1.7, this.blast.position.z - age * 0.35);
        this.ventLid.rotation.set(age * 4.4, age * 2, age * 1.8);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    this.width = Math.max(this.stage.clientWidth, 1);
    this.height = Math.max(this.stage.clientHeight, 1);
    const aspect = this.width / this.height;
    let centerY = 0;
    let halfHeight: number;
    if (this.kitchen) {
      const { rear, front, halfWidth } = KITCHEN_FRAMING;
      this.camera.updateMatrixWorld(true);
      const view = this.camera.matrixWorldInverse;
      const top = this.point.set(0, rear.y, rear.z).applyMatrix4(view).y;
      const bottom = this.point.set(0, front.y, front.z).applyMatrix4(view).y;
      centerY = (top + bottom) / 2;
      halfHeight = Math.max((top - bottom) / 2 + 0.42, halfWidth / aspect);
    } else {
      halfHeight = Math.max(5.75, 11.8 / aspect, LIMIT.z * 0.9);
    }
    this.camera.left = -halfHeight * aspect;
    this.camera.right = halfHeight * aspect;
    this.camera.top = centerY + halfHeight;
    this.camera.bottom = centerY - halfHeight;
    this.camera.near = 0.1;
    this.camera.far = 80;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height, false);
  }
}
