import * as THREE from 'three';
import { PLAYER_RADIUS } from './simulation.ts';
import { batchMeshes, bevel, box, mat, part, ring } from './scene-parts.ts';
import type { Rig } from './scene-parts.ts';
import type { Viber } from './vibers.ts';

const ink = mat('#1b2026', 0, 0.31);
const sole = mat('#292b32', 0, 0.83);
const bone = mat('#e6e0cf', 0, 0.47);
const copper = mat('#a8694c', 0, 0.50);
const sand = mat('#bb9a72', 0, 0.57);
const bark = mat('#6b5a45');
const cool = mat('#9bb8fa', 0.22, 0.19);
const mint = mat('#65dace', 0.14, 0.24);
const silver = mat('#a6ac99', 0, 0.29, 0.48);
const pal = {
  'viber-10': { head: '#315748', body: '#315748', sleeve: '#33594b', hand: '#796953' },
  'viber-31': { head: '#b83d2c', body: '#252729', sleeve: '#b83d2c', hand: '#e0d9c9' },
  'viber-84': { head: '#e2dbcb', body: '#e2dbcb', sleeve: '#d6cebd', hand: '#bf4533' },
  'agent-123': { head: '#9683bc', body: '#9180bb', sleeve: '#e4dece', hand: '#cbaa80' },
} as const;

function plate(head: THREE.Group, material: THREE.Material, x: number, y: number, w: number, h: number): void {
  bevel(head, ink, x, y, 0.389, w + 0.042, h + 0.040, 0.057);
  bevel(head, material, x, y, 0.425, w, h, 0.035);
}

function cap(head: THREE.Group, color: string): void {
  const plastic = mat(color, 0, 0.41);
  bevel(head, ink, 0, 1.063, -0.01, 0.901, 0.039, 0.76);
  bevel(head, plastic, 0, 1.152, -0.018, 0.89, 0.16, 0.75);
  bevel(head, plastic, 0, 1.188, -0.42, 0.82, 0.090, 0.18);
  bevel(head, ink, 0, 1.231, -0.050, 0.552, 0.026, 0.423);
  bevel(head, plastic, 0, 1.266, -0.050, 0.53, 0.074, 0.40);
  for (const x of [-0.30, 0.30]) box(head, ink, x, 1.126, -0.396, 0.118, 0.015, 0.016);
}

export function makeViber(viber: Viber): Rig {
  const root = new THREE.Group();
  const turn = new THREE.Group();
  const torso = new THREE.Group();
  const details = new THREE.Group();
  const colors = pal[viber.id];
  root.add(turn);
  turn.add(torso);
  bevel(details, mat(colors.body, 0, 0.59), 0, 0.155, 0, 0.565, 0.50, 0.45);
  bevel(details, sole, 0, -0.109, 0.012, 0.535, 0.145, 0.43);
  bevel(details, ink, 0, 0.426, 0.005, 0.830, 0.048, 0.718);
  bevel(details, mat(colors.head, 0, 0.40), 0, 0.754, 0.005, 0.845, 0.670, 0.725);

  let labelHeight = 1.92;
  if (viber.id === 'viber-10') {
    cap(details, '#395f48');
    for (const side of [-1, 1]) {
      plate(details, mint, side * 0.203, 0.659, 0.326, 0.309);
      bevel(details, bone, side * 0.203, 0.651, 0.457, 0.152, 0.160, 0.047);
      bevel(details, bone, side * 0.253, 0.873, 0.392, 0.092, 0.094, 0.08);
      box(details, mint, side * 0.247, 0.002, 0.230, 0.075, 0.037, 0.026);
    }
    box(details, ink, 0, 0.178, 0.24, 0.108, 0.30, 0.075);
    bevel(details, sole, 0, 0.295, 0.244, 0.295, 0.073, 0.067);
  } else if (viber.id === 'viber-31') {
    labelHeight = 2.09;
    for (const [i, height] of [0.225, 0.399, 0.486, 0.320].entries()) {
      const z = 0.29 - i * 0.178;
      box(details, ink, 0, 1.09, z, 0.185, 0.055, 0.153);
      bevel(details, copper, 0, 1.107 + height / 2, z, 0.163, height, 0.134);
    }
    for (const side of [-1, 1]) {
      plate(details, bone, side * 0.208, 0.667, 0.272, 0.284);
      box(details, ink, side * 0.208, 0.58, 0.468, 0.096, 0.088, 0.102);
    }
    box(details, copper, 0, 0.469, 0.407, 0.085, 0.175, 0.101);
    box(details, ink, 0, 0.530, 0.426, 0.097, 0.087, 0.097);
    bevel(details, copper, 0.09, 0.243, 0.240, 0.235, 0.165, 0.081);
    box(details, silver, 0.177, 0.280, 0.286, 0.034, 0.035, 0.021);
    bevel(details, bark, 0.32, 0.493, -0.301, 0.23, 0.57, 0.215);
    bevel(details, bone, 0.32, 0.866, -0.306, 0.103, 0.392, 0.106);
    box(details, silver, 0.44, 0.423, -0.293, 0.027, 0.238, 0.10);
  } else if (viber.id === 'viber-84') {
    const red = mat('#bf4533', 0, 0.44);
    cap(details, '#b64334');
    box(details, ink, 0, 0.692, 0.398, 0.869, 0.112, 0.057);
    box(details, red, 0, 0.699, 0.432, 0.836, 0.072, 0.041);
    for (const side of [-1, 1]) {
      bevel(details, ink, side * 0.212, 0.653, 0.463, 0.174, 0.179, 0.061);
      bevel(details, mat('#30363f', 0, 0.15), side * 0.212, 0.657, 0.497, 0.139, 0.135, 0.015);
    }
    box(details, ink, 0, 0.520, 0.420, 0.097, 0.096, 0.098);
    box(details, bark, 0, 0.261, 0.239, 0.479, 0.102, 0.07);
    box(details, ink, 0, 0.177, 0.235, 0.501, 0.094, 0.075);
    bevel(details, red, 0, 0.264, 0.285, 0.176, 0.092, 0.086);
    box(details, bark, 0, -0.027, 0.064, 0.578, 0.10, 0.52);
    box(details, red, 0.165, 0.328, -0.280, 0.370, 0.373, 0.19);
  } else {
    labelHeight = 1.98;
    bevel(details, ink, 0, 0.666, 0.373, 0.844, 0.413, 0.068);
    for (const side of [-1, 1]) {
      bevel(details, cool, side * 0.223, 0.749, 0.423, 0.197, 0.098, 0.055);
      box(details, silver, side * 0.188, 0.109, 0.305, 0.029, 0.02, 0.014);
    }
    box(details, sole, 0, 0.551, 0.418, 0.369, 0.148, 0.115);
    box(details, bone, 0, 0.549, 0.490, 0.299, 0.088, 0.060);
    box(details, ink, 0, 1.080, -0.018, 0.624, 0.048, 0.618);
    bevel(details, bone, 0, 1.192, -0.018, 0.591, 0.251, 0.589);
    bevel(details, bone, 0.028, 1.363, 0.083, 0.111, 0.127, 0.105);
    box(details, sand, -0.316, 1.124, -0.15, 0.146, 0.194, 0.159);
    box(details, ink, 0, 0.160, 0.245, 0.459, 0.229, 0.070);
    bevel(details, cool, 0, 0.162, 0.287, 0.412, 0.177, 0.029);
    bevel(details, sand, 0, 0.015, 0.112, 0.579, 0.110, 0.405);
  }
  batchMeshes(details, torso);

  const arms = [-1, 1].map(side => {
    const arm = new THREE.Group();
    bevel(arm, mat(colors.sleeve, 0, 0.59), 0, -0.091, 0, 0.178, 0.200, 0.223);
    bevel(arm, mat(colors.hand, 0, 0.49), 0, -0.230, 0.008, 0.169, 0.104, 0.211);
    if (viber.id === 'viber-31') box(arm, ink, 0, -0.177, 0.008, 0.18, 0.069, 0.22);
    arm.position.set(side * 0.357, 0.355, 0.01);
    torso.add(arm);
    return arm;
  });
  const boots = [-1, 1].map(side => {
    const boot = new THREE.Group();
    const viber84 = viber.id === 'viber-84';
    bevel(boot, viber84 ? bark : sole, 0, 0.013, 0,
      viber.id === 'viber-31' ? 0.269 : 0.357, 0.203, 0.432);
    bevel(boot, viber.id === 'viber-10' ? mint : viber84 ? bark : ink, 0, -0.096, 0, 0.349, 0.061, 0.443);
    bevel(boot, viber84 ? sand : sole, 0, -0.043, 0.214, 0.286, 0.032, 0.015);
    boot.position.set(side * 0.192, 0.126, 0.055);
    turn.add(boot);
    return boot;
  });
  const shadow = part(root, new THREE.CircleGeometry(1, 28),
    new THREE.MeshBasicMaterial({ color: '#502b26', transparent: true, opacity: 0.25, depthWrite: false }),
    0, 0.062, 0, 0.55, 0.44, 1);
  shadow.rotation.x = -Math.PI / 2;
  const halo = ring(viber.color, PLAYER_RADIUS + 0.175, 0.042);
  halo.position.y = 0.075;
  root.add(halo);
  return { root, turn, torso, boots, arms, shadow, halo, labelHeight };
}
