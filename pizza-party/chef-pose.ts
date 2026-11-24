import * as THREE from 'three';
import { BAKE_TICKS, COOK_TRAVEL_TICKS, COOK_WAIT_TICKS, HZ } from './simulation.ts';
import type { makeChefArm } from './shared/viber-model.ts';
import type { Rig } from './shared/scene-parts.ts';

export const TOPPING_TRANSFER_TICKS = 15;
export const DISPATCH_TICK = BAKE_TICKS + COOK_WAIT_TICKS;
export const BOX_TICK = DISPATCH_TICK + COOK_TRAVEL_TICKS;
export const LID_CLOSE_TICKS = 13;
export const SERVICE_SURFACE = 0.792;
export const HAND_CLEARANCE = 0.119;
export const IDLE_PERIOD_TICKS = [4.25, 4.73, 5.21, 5.69].map(seconds => Math.round(seconds * HZ));
const upperLength = 0.294, lowerLength = 0.349;
const up = new THREE.Vector3(0, 1, 0);
const ray = new THREE.Vector3(), bend = new THREE.Vector3();
const upper = new THREE.Vector3(), lower = new THREE.Vector3();
const upperRotation = new THREE.Quaternion(), forearmRotation = new THREE.Quaternion();
const torsoInverse = new THREE.Quaternion();
const glovePose = new THREE.Euler(0, 0, 0, 'YXZ');

export const clamp = (value: number) => Math.max(0, Math.min(1, value));
export function ease(value: number) {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
}
export const pulse = (value: number) => value <= 0 || value >= 1 ? 0 : Math.sin(Math.PI * value);
export const idlePhase = (id: number, tick: number) => (tick + id * 83) % IDLE_PERIOD_TICKS[id];

export function solveChefArm(shoulder: THREE.Vector3, wrist: THREE.Vector3, elbow: THREE.Vector3, side: number) {
  wrist.y = Math.max(wrist.y, SERVICE_SURFACE + HAND_CLEARANCE);
  ray.copy(wrist).sub(shoulder);
  const requested = ray.length();
  const reach = THREE.MathUtils.clamp(requested, 0.17, upperLength + lowerLength - 0.012);
  if (requested < 0.001) ray.set(0, 0, 1);
  else ray.multiplyScalar(1 / requested);
  wrist.copy(shoulder).addScaledVector(ray, reach);
  wrist.y = Math.max(wrist.y, SERVICE_SURFACE + HAND_CLEARANCE);
  bend.set(side, 0.14, -0.17);
  bend.addScaledVector(ray, -bend.dot(ray)).normalize();
  const along = (upperLength ** 2 - lowerLength ** 2 + reach ** 2) / (2 * reach);
  const rise = Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2));
  elbow.copy(shoulder).addScaledVector(ray, along).addScaledVector(bend, rise);
  // The bent elbow can sweep over the rear lip. Keep the sleeve above it.
  elbow.y = Math.max(elbow.y, SERVICE_SURFACE + HAND_CLEARANCE + 0.005);
}

export function poseChefArm(arm: ReturnType<typeof makeChefArm>, body: Rig, shoulder: THREE.Vector3,
  elbow: THREE.Vector3, wrist: THREE.Vector3, yaw: number, pitch: number, grip: number) {
  const upperLength = upper.copy(elbow).sub(shoulder).length();
  const lowerLength = lower.copy(wrist).sub(elbow).length();
  // The reach is solved in counter space and placed into the torso's own joint.
  const bodyScale = body.root.scale.x;
  torsoInverse.copy(body.torso.quaternion).invert();
  upperRotation.setFromUnitVectors(up, upper.normalize());
  arm.shoulder.position.copy(shoulder).sub(body.root.position).multiplyScalar(1 / bodyScale)
    .sub(body.torso.position).applyQuaternion(torsoInverse);
  arm.shoulder.quaternion.copy(upperRotation).premultiply(torsoInverse);
  arm.shoulder.scale.setScalar(1 / bodyScale);
  arm.sleeve.scale.y = upperLength;
  arm.elbow.position.y = upperLength;
  forearmRotation.setFromUnitVectors(up, lower.normalize());
  arm.elbow.quaternion.copy(upperRotation).invert().multiply(forearmRotation);
  arm.forearm.scale.y = lowerLength;
  arm.hand.position.y = lowerLength;

  const forearmYaw = Math.atan2(lower.x, lower.z);
  const turn = Math.atan2(Math.sin(forearmYaw - yaw), Math.cos(forearmYaw - yaw));
  const followPitch = THREE.MathUtils.clamp(-lower.y * 0.54, -0.21, 0.19);
  glovePose.set(THREE.MathUtils.clamp(pitch + followPitch, -0.28, 0.29),
    yaw + turn * 0.32, -0.12 * turn, 'YXZ');
  arm.hand.quaternion.setFromEuler(glovePose).premultiply(forearmRotation.invert());
  arm.fingers.rotation.x = clamp(grip) * 0.48;
}
