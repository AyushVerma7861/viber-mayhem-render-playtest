import * as THREE from 'three';
import { pizzaCarton } from './courtyard.ts';
import { COUNTERS } from './layout.ts';
import type { Vec } from './layout.ts';
import { makeChefArm, makeViber } from './shared/viber-model.ts';
import { batchMeshes, bevel, latheGeo, mat, part, round } from './shared/scene-parts.ts';
import type { Viber } from './shared/vibers.ts';
import { BAKE_TICKS, COOK_TRAVEL_TICKS } from './simulation.ts';
import type { Food } from './simulation.ts';
import type { PizzaPlayerView } from './network-state.ts';
import {
  BOX_TICK, clamp, DISPATCH_TICK, ease, idlePhase, LID_CLOSE_TICKS, poseChefArm,
  pulse, SERVICE_SURFACE, solveChefArm, TOPPING_TRANSFER_TICKS,
} from './chef-pose.ts';

const crust = mat('#cb7b39', 0, 0.71);
const metal = mat('#c4c5b9', 0, 0.36, 0.28);
const enamel = mat('#254b40', 0, 0.53);
const trim = mat('#bd8c55', 0, 0.44, 0.26);
const cloth = mat('#e6d8b9', 0, 0.9);
const peelWood = mat('#946443', 0, 0.69);
const dough = mat('#e6bd78', 0, 0.88);
const serviceHeight = SERVICE_SURFACE;
const standHeight = 0.330;
const shaft = mat('#4e5548', 0, 0.8);

let steamTexture: THREE.CanvasTexture | undefined;
function steam() {
  if (!steamTexture) {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.translate(20, 32);
    ctx.scale(0.66, 1);
    const shade = ctx.createRadialGradient(0, 0, 1, 0, 0, 28);
    shade.addColorStop(0, 'rgba(255, 239, 212, 0.85)');
    shade.addColorStop(0.45, 'rgba(255, 239, 212, 0.42)');
    shade.addColorStop(1, 'rgba(255, 239, 212, 0)');
    ctx.fillStyle = shade;
    ctx.fillRect(-30, -32, 60, 64);
    steamTexture = new THREE.CanvasTexture(canvas);
    steamTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return new THREE.Sprite(new THREE.SpriteMaterial({
    map: steamTexture, transparent: true, depthWrite: false, opacity: 0,
  }));
}

function finishedPizza(group: THREE.Group) {
  const base = new THREE.Group();
  const lip = new THREE.TorusGeometry(0.248, 0.036, 7, 30);
  part(base, latheGeo, crust, 0, 0.038, 0, 0.271, 0.075, 0.271);
  part(base, latheGeo, mat('#c8512d'), 0, 0.078, 0, 0.246, 0.016, 0.246);
  part(base, lip, mat('#e2a050', 0, 0.67), 0, 0.082, 0, 1, 1, 1).rotation.x = Math.PI / 2;
  part(base, latheGeo, mat('#ffd186', 0, 0.63), 0, 0.09, 0, 0.228, 0.019, 0.228);
  batchMeshes(base, group);
  const ingredients = new Map<Food, THREE.Group>();
  for (const [food, color, shift] of [
    ['tomato', '#d74a2d', 0], ['meat', '#a63d35', 0.57],
    ['cheese', '#fff0a2', 1.1], ['lettuce', '#689b44', 1.55],
  ] as const) {
    const layer = new THREE.Group();
    const pieces = new THREE.Group();
    group.add(layer);
    for (let i = 0; i < 5; i++) {
      const a = i * 2.39996 + shift;
      const r = i % 2 === 0 ? 0.162 : 0.101;
      part(pieces, latheGeo, mat(color), Math.cos(a) * r, 0.109 + shift * 0.003,
        Math.sin(a) * r, food === 'tomato' ? 0.037 : 0.024, 0.020, 0.027).rotation.y = a;
    }
    batchMeshes(pieces, layer);
    ingredients.set(food, layer);
  }
  return ingredients;
}

type Delivery = { tick: number; plate: Vec };

export class StationChef {
  readonly deliveries: Delivery[] = [];
  private readonly rig;
  private readonly arms;
  private readonly shoulder = new THREE.Vector3();
  private readonly wrist = new THREE.Vector3();
  private readonly elbow = new THREE.Vector3();
  private readonly pizza = new THREE.Group();
  private readonly ingredients = finishedPizza(this.pizza);
  private readonly base = new THREE.Group();
  private readonly peel = new THREE.Group();
  private readonly carton = new THREE.Group();
  private readonly lid = pizzaCarton(this.carton, 0.67, 0.61);
  private readonly steams = [steam(), steam(), steam()];
  private readonly utensil = new THREE.Group();
  private readonly padGlow;

  constructor(private readonly id: number, scenery: THREE.Group, scene: THREE.Scene, viber: Viber) {
    const { center, inward } = COUNTERS[id];
    const stand = new THREE.Group();
    stand.position.set(center.x, 0, center.z);
    stand.rotation.y = Math.atan2(inward.x, inward.z);
    scene.add(stand);
    const plinth = new THREE.Group();
    plinth.position.copy(stand.position);
    plinth.rotation.copy(stand.rotation);
    scenery.add(plinth);
    bevel(plinth, shaft, 0, -0.277, -0.805, 1.29, 0.133, 1.06);
    for (const side of [-1, 1]) bevel(plinth, enamel, side * 0.46, 0.02, -0.781, 0.166, 0.465, 0.85);
    bevel(plinth, shaft, 0, -0.104, -1.029, 1.12, 0.226, 0.286);
    bevel(plinth, enamel, 0, 0.244, -0.796, 1.21, 0.137, 1.02);
    bevel(plinth, trim, 0, 0.294, -0.804, 1.235, 0.030, 1.046);
    bevel(plinth, enamel, 0, 0.316, -0.804, 1.138, 0.028, 0.974);
    for (const x of [-0.31, 0, 0.31]) bevel(plinth, trim, x, 0.331, -1.232, 0.172, 0.006, 0.039);

    this.rig = makeViber(viber, 'station');
    this.rig.root.position.set(0, standHeight, -0.755);
    this.rig.root.scale.setScalar(0.76);
    this.rig.torso.position.y = 0.373;
    this.rig.shadow.visible = false;
    stand.add(this.rig.root, this.pizza, this.base, this.peel, this.carton, ...this.steams);
    this.arms = [makeChefArm(viber, this.rig.torso, -1), makeChefArm(viber, this.rig.torso, 1)];

    const grate = mat('#df5a24', 0.15, 0.64).clone();
    this.padGlow = grate;
    const heater = bevel(stand, grate, 0, 0.766, 0.04, 1.04, 0.008, 0.013);
    heater.castShadow = false;
    part(this.base, latheGeo, dough, 0, 0.03, 0, 0.242, 0.060, 0.242);
    part(this.base, latheGeo, mat('#b65031'), 0, 0.064, 0, 0.203, 0.014, 0.203);
    this.base.position.set(0, serviceHeight, -0.01);
    round(this.peel, peelWood, 0, 0.018, 0.02, 0.59, 0.036, 0.51);
    bevel(this.peel, peelWood, 0, 0.063, -0.37, 0.094, 0.052, 0.29);
    this.carton.position.set(0.53, serviceHeight - 0.004, -0.12);
    bevel(plinth, enamel, 0.744, 0.743, -0.477, 0.71, 0.068, 0.208);
    this.arms[1].hand.add(this.utensil);
    this.utensil.position.set(0, -0.026, 0.110);
    if (id === 1) {
      for (const x of [-0.034, 0.034]) bevel(this.utensil, metal, x, -0.014, 0.109, 0.023, 0.037, 0.223).rotation.y = x * 2.6;
      bevel(this.utensil, metal, 0, 0, -0.012, 0.083, 0.045, 0.068);
    } else if (id === 3) {
      bevel(this.utensil, cloth, 0.016, -0.048, 0.029, 0.203, 0.028, 0.168).rotation.y = -0.22;
      bevel(this.utensil, mat('#76aa99'), 0.020, -0.033, 0.022, 0.185, 0.007, 0.029).rotation.y = -0.22;
    }
  }

  receive(plate: Vec, tick: number): void {
    this.deliveries.push({ tick, plate });
  }

  reset(): void {
    this.deliveries.length = 0;
  }

  render(player: PizzaPlayerView, tick: number, moving: boolean, motion: boolean): void {
    const elapsed = player.serviceAt >= 0 ? tick - player.serviceAt : -1;
    const receiving = this.deliveries.at(-1);
    const deliveryProgress = receiving ? clamp((tick - receiving.tick) / TOPPING_TRANSFER_TICKS) : 1;
    const recent = pulse(deliveryProgress);
    const mixing = elapsed >= 0 && elapsed < BAKE_TICKS;
    const baked = elapsed >= BAKE_TICKS && elapsed < BOX_TICK;
    const pack = ease((elapsed - DISPATCH_TICK) / COOK_TRAVEL_TICKS);
    const reset = ease((elapsed - BOX_TICK) / COOK_TRAVEL_TICKS);
    const idleClock = idlePhase(this.id, tick) / 61;
    const idle = elapsed < 0 ? pulse(idleClock) : 0;
    const { center, tangent } = COUNTERS[this.id];
    const dx = player.position.x - center.x, dz = player.position.z - center.z;
    const near = moving && dx * dx + dz * dz < 4.1;
    const direction = near ? THREE.MathUtils.clamp((dx * tangent.x + dz * tangent.z) * 0.29, -0.33, 0.33) : 0;
    const work = mixing ? pulse((elapsed - 7) / (BAKE_TICKS - 7)) : 0;
    const boxing = pulse(pack);
    const effort = motion ? Math.max(recent, work * 0.86, boxing) : 0;
    const shift = motion ? Math.sin(tick * 0.041 + this.id * 1.6) : 0;
    this.rig.torso.rotation.set(0.018 + effort * 0.16 + (near ? 0.035 : 0), 0, shift * 0.023);
    this.rig.torso.position.z = effort * 0.066;
    this.rig.head.rotation.set(effort * 0.18 - shift * 0.029,
      direction * (1 - effort) + (motion ? shift * 0.063 : 0), (motion ? idle * 0.06 : 0));
    this.base.visible = mixing;
    this.pizza.visible = baked;
    const bakingHeat = elapsed < BAKE_TICKS ? work : baked ? 1 - pack : 0;
    this.padGlow.emissiveIntensity = 0.05 + bakingHeat * 0.89;
    this.ingredients.forEach((mesh, food) => { mesh.visible = baked && player.delivered.includes(food); });
    const slide = motion ? pack : 0;
    const lift = motion ? boxing * 0.053 : 0;
    this.pizza.position.set(0.53 * slide, serviceHeight + lift + 0.025 * slide, -0.01 - 0.11 * slide);
    this.peel.visible = motion && elapsed >= DISPATCH_TICK && elapsed < BOX_TICK;
    this.peel.position.set(this.pizza.position.x, this.pizza.position.y - 0.033, this.pizza.position.z);
    this.peel.rotation.y = 0.08 + slide * 0.44;
    const readyCarton = this.id === 2 && elapsed < 0;
    this.carton.visible = elapsed >= DISPATCH_TICK - 9 || readyCarton;
    this.carton.position.x = readyCarton ? 0.72 : 0.53 + 0.19 * reset;
    this.carton.position.z = readyCarton ? -0.469 + (motion ? idle * 0.058 : 0) : -0.12 - 0.34 * reset;
    const lidOpen = motion && !readyCarton ? ease((elapsed - DISPATCH_TICK + 9) / 9) *
      (1 - ease((elapsed - BOX_TICK) / LID_CLOSE_TICKS)) : 0;
    this.lid.rotation.x = -(Math.PI / 2 - 0.11) * lidOpen;
    const receivingArm = (this.deliveries.length + 1) % 2;
    this.utensil.visible = motion && (this.id === 1 ? recent > 0.065 || idle > 0.16 : this.id === 3 && idle > 0.12 && recent < 0.06);
    const utensilArm = recent > 0 || this.id === 3 ? receivingArm : 1;
    if (this.utensil.visible && this.utensil.parent !== this.arms[utensilArm].hand) {
      this.arms[utensilArm].hand.add(this.utensil);
    }
    this.arms.forEach((arm, index) => {
      const side = index === 0 ? -1 : 1;
      const lead = index === this.id % 2;
      const breathing = motion ? Math.sin(tick * 0.035 + this.id * 0.88 + index * 1.37) : 0;
      const restX = side * (lead ? 0.413 : 0.369) + breathing * 0.023;
      const restY = (lead ? 0.936 : 0.951) + breathing * 0.017;
      const restZ = (lead ? -0.238 : -0.436) + breathing * 0.038;
      this.wrist.set(restX, restY, restZ);
      let yaw = side * 0.12, pitch = lead ? 0.05 : -0.08, grip = 0.12;
      if (motion && index === receivingArm && recent > 0) {
        const reach = ease(deliveryProgress / 0.29) * (1 - ease((deliveryProgress - 0.73) / 0.27));
        const place = ease((deliveryProgress - 0.30) / 0.61);
        this.wrist.x = THREE.MathUtils.lerp(restX, side * (0.31 + place * 0.36), reach);
        this.wrist.y = THREE.MathUtils.lerp(restY, 1.01 + recent * 0.07, reach);
        this.wrist.z = THREE.MathUtils.lerp(restZ, -0.005 - place * 0.08, reach);
        yaw += side * (place * 0.57 - 0.30) * reach;
        pitch = 0.06 + reach * 0.13;
        grip = 0.12 + pulse((deliveryProgress - 0.19) / 0.71) * 0.83;
      } else if (motion && mixing) {
        const knead = work * (0.77 + 0.23 * Math.sin(elapsed * 0.40 + index * Math.PI));
        this.wrist.x = THREE.MathUtils.lerp(restX, side * 0.234, knead);
        this.wrist.y = THREE.MathUtils.lerp(restY, 0.958 + 0.061 * Math.abs(Math.sin(elapsed * 0.35 + index)), knead);
        this.wrist.z = THREE.MathUtils.lerp(restZ, -0.054, knead);
        yaw = -side * knead * 0.44;
        pitch = knead * 0.17;
        grip = 0.17 + knead * 0.32;
      } else if (motion && elapsed >= DISPATCH_TICK - 7 && elapsed <= BOX_TICK + 4) {
        const take = ease((elapsed - DISPATCH_TICK + 7) / 9) * (1 - ease((elapsed - BOX_TICK) / 4));
        const rotation = this.peel.rotation.y;
        const backward = lead ? 0.46 : 0.28;
        const across = lead ? 0 : side * 0.253;
        const px = this.peel.position.x - Math.sin(rotation) * backward + Math.cos(rotation) * across;
        const pz = this.peel.position.z - Math.cos(rotation) * backward - Math.sin(rotation) * across;
        this.wrist.x = THREE.MathUtils.lerp(restX, px, take);
        this.wrist.y = THREE.MathUtils.lerp(restY, this.peel.position.y + (lead ? 0.142 : 0.132), take);
        this.wrist.z = THREE.MathUtils.lerp(restZ, pz, take);
        yaw = THREE.MathUtils.lerp(yaw, rotation, take);
        pitch = 0.085 * take;
        grip = THREE.MathUtils.lerp(grip, lead ? 0.91 : 0.47, take);
      } else if (motion && index === 1 && elapsed > BOX_TICK + 4) {
        const press = pulse((elapsed - BOX_TICK - 3) / LID_CLOSE_TICKS);
        this.wrist.x = THREE.MathUtils.lerp(restX, this.carton.position.x, press);
        this.wrist.y += (0.155 + 0.14 * lidOpen) * press;
        this.wrist.z = THREE.MathUtils.lerp(restZ, this.carton.position.z - 0.072, press);
        pitch = press * 0.19;
      } else if (motion && index === utensilArm && idle > 0) {
        const wipe = this.id === 3 ? Math.sin(idleClock * 6.2) * 0.27 : 0.115;
        this.wrist.x += idle * wipe;
        this.wrist.z = THREE.MathUtils.lerp(restZ, this.id === 2 ? -0.425 : -0.064, idle);
        this.wrist.y += idle * (this.id === 3 ? -0.021 : 0.094);
        yaw += idle * 0.23;
        grip = 0.12 + idle * 0.28;
      }
      this.shoulder.set(side * 0.276, 0.348, 0.036).applyEuler(this.rig.torso.rotation)
        .add(this.rig.torso.position).multiplyScalar(this.rig.root.scale.x).add(this.rig.root.position);
      solveChefArm(this.shoulder, this.wrist, this.elbow, side);
      poseChefArm(arm, this.rig, this.shoulder, this.elbow, this.wrist, yaw, pitch, grip);
    });
    this.steams.forEach((sprite, index) => {
      const age = (elapsed - BAKE_TICKS - index * 5) / 24;
      sprite.visible = motion && age > 0 && age < 1;
      if (!sprite.visible) return;
      sprite.position.set((index - 1) * 0.062 + Math.sin(age * 4 + index) * 0.07,
        serviceHeight + 0.12 + age * 0.41, -0.04 - age * 0.11);
      sprite.scale.set(0.103 + age * 0.079, 0.156 + age * 0.121, 1);
      sprite.material.opacity = pulse(age) * 0.33;
    });
  }
}
