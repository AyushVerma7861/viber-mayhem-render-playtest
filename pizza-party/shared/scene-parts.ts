import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const boxGeo = new THREE.BoxGeometry();
export const ballGeo = new THREE.SphereGeometry(1, 16, 12);
export const tubeGeo = new THREE.CylinderGeometry(1, 1, 1, 12);
export const latheGeo = new THREE.CylinderGeometry(1, 1, 1, 32);
const roundGeo = new RoundedBoxGeometry(1, 1, 1, 2, 0.13);
const bevelGeo = new RoundedBoxGeometry(1, 1, 1, 1, 0.036);
const materials = new Map<string, THREE.MeshStandardMaterial>();

export function mat(color: string, glow = 0, roughness = 0.72, metalness = 0): THREE.MeshStandardMaterial {
  const key = [color, glow, roughness, metalness].join('/');
  if (!materials.has(key)) {
    materials.set(key, new THREE.MeshStandardMaterial({
      color, roughness, metalness, emissive: glow ? color : '#000000', emissiveIntensity: glow,
    }));
  }
  return materials.get(key)!;
}

export function part(group: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material,
  x: number, y: number, z: number, w: number, h: number, d: number): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(w, h, d);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

export function box(group: THREE.Object3D, material: THREE.Material, x: number, y: number,
  z: number, w: number, h: number, d: number): THREE.Mesh {
  return part(group, boxGeo, material, x, y, z, w, h, d);
}

export function round(group: THREE.Object3D, material: THREE.Material, x: number, y: number,
  z: number, w: number, h: number, d: number): THREE.Mesh {
  return part(group, roundGeo, material, x, y, z, w, h, d);
}

export function bevel(group: THREE.Object3D, material: THREE.Material, x: number, y: number,
  z: number, w: number, h: number, d: number): THREE.Mesh {
  return part(group, bevelGeo, material, x, y, z, w, h, d);
}

export function ring(color: string, radius: number, width: number): THREE.Mesh {
  const geometry = new THREE.RingGeometry(radius - width, radius, 48);
  geometry.rotateX(-Math.PI / 2);
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.88, depthWrite: false, side: THREE.DoubleSide,
  }));
}

export type Rig = {
  root: THREE.Group;
  turn: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  boots: THREE.Object3D[];
  arms: THREE.Object3D[];
  shadow: THREE.Mesh;
  halo: THREE.Mesh;
  labelHeight: number;
};

// Bake static parts in local coordinates while leaving moving actors and lights separate.
export function batchMeshes(source: THREE.Group, target: THREE.Object3D,
  ground: readonly THREE.Material[] = []): void {
  source.updateMatrixWorld(true);
  const local = source.matrixWorld.clone().invert();
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  source.traverse(item => {
    if (!(item instanceof THREE.Mesh)) return;
    const material = item.material as THREE.Material;
    const geometry = item.geometry.index ? item.geometry.toNonIndexed() : item.geometry.clone();
    geometry.applyMatrix4(local.clone().multiply(item.matrixWorld));
    if (!batches.has(material)) batches.set(material, []);
    batches.get(material)!.push(geometry);
  });
  for (const [material, shapes] of batches) {
    const mesh = new THREE.Mesh(mergeGeometries(shapes), material);
    mesh.castShadow = !ground.includes(material);
    mesh.receiveShadow = true;
    target.add(mesh);
    shapes.forEach(shape => shape.dispose());
  }
}
