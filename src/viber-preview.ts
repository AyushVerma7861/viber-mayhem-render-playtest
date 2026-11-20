import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeViber } from './viber-model.ts';
import { mat, part, tubeGeo } from './scene-parts.ts';
import type { Rig } from './scene-parts.ts';
import type { Viber } from './vibers.ts';

export class ViberPreview {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(33, 1, 0.1, 25);
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private models = new Map<Viber, Rig>();
  private current?: Rig;
  private active = false;
  private frame = 0;
  private poseAt?: number;
  private pointer?: { id: number; x: number; y: number; moved: boolean };
  private reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private pedestalTrim = new THREE.MeshStandardMaterial({ roughness: 0.48, metalness: 0.25, emissiveIntensity: 0.24 });

  constructor(private stage: HTMLElement, private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.camera.position.set(2.52, 1.83, 4.12);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.8, 0);
    this.controls.enablePan = false;
    this.controls.minDistance = 3.75;
    this.controls.maxDistance = 7.2;
    this.controls.minPolarAngle = 0.85;
    this.controls.maxPolarAngle = 1.62;
    this.controls.rotateSpeed = 0.65;
    this.controls.update();
    this.controls.saveState();
    this.controls.addEventListener('change', () => this.invalidate());

    this.scene.add(new THREE.HemisphereLight('#fff4e4', '#a281a6', 2.35));
    const key = new THREE.DirectionalLight('#ffdfbc', 3.05);
    key.position.set(3.5, 5, 4);
    const rim = new THREE.DirectionalLight('#d1dbff', 1.65);
    rim.position.set(-2, 3, -4);
    this.scene.add(key, rim);
    part(this.scene, tubeGeo, mat('#251915', 0, 0.55), 0, -0.115, 0, 0.89, 0.17, 0.89);
    part(this.scene, tubeGeo, this.pedestalTrim, 0, -0.062, 0, 0.9, 0.024, 0.9);
    part(this.scene, tubeGeo, mat('#48342d', 0, 0.52), 0, -0.03, 0, 0.87, 0.06, 0.87);

    canvas.addEventListener('pointerdown', event => {
      if (this.pointer) {
        this.pointer.moved = true;
        return;
      }
      if (event.button === 0) this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    });
    canvas.addEventListener('pointermove', event => {
      const press = this.pointer;
      if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 7) press.moved = true;
    });
    canvas.addEventListener('pointerup', event => {
      const press = this.pointer;
      if (press?.id !== event.pointerId) return;
      this.pointer = undefined;
      if (!press.moved) this.pose();
    });
    canvas.addEventListener('pointercancel', () => { this.pointer = undefined; });
    canvas.addEventListener('keydown', event => {
      const actions: Record<string, () => void> = {
        ArrowLeft: () => this.rotate(-0.43),
        ArrowRight: () => this.rotate(0.43),
        '+': () => this.zoom(0.9),
        '=': () => this.zoom(0.9),
        '-': () => this.zoom(1.12),
        Home: () => this.reset(),
        Enter: () => this.pose(),
      };
      const action = actions[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    });

    new ResizeObserver(() => this.resize()).observe(stage);
  }

  select(viber: Viber): void {
    if (this.current) this.scene.remove(this.current.root);
    let rig = this.models.get(viber);
    if (!rig) {
      rig = makeViber(viber);
      rig.torso.position.y = 0.43;
      rig.halo.visible = false;
      this.models.set(viber, rig);
    }
    this.current = rig;
    this.pedestalTrim.color.set(viber.color);
    this.pedestalTrim.emissive.set(viber.color);
    this.poseAt = undefined;
    rig.turn.position.y = 0;
    rig.turn.rotation.z = 0;
    this.scene.add(rig.root);
    this.reset();
  }

  show(active: boolean): void {
    this.active = this.controls.enabled = active;
    if (active) {
      this.resize();
    } else if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
  }

  rotate(angle: number): void {
    const target = this.controls.target;
    const position = this.camera.position.sub(target);
    position.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle).add(target);
    this.controls.update();
  }

  reset(): void {
    this.controls.reset();
    this.invalidate();
  }

  private zoom(scale: number): void {
    const target = this.controls.target;
    this.camera.position.sub(target).multiplyScalar(scale).add(target);
    this.controls.update();
  }

  private pose(): void {
    if (!this.current || this.reduceMotion.matches) return;
    this.poseAt = performance.now();
    this.invalidate();
  }

  private resize(): void {
    const width = this.stage.clientWidth;
    const height = this.stage.clientHeight;
    if (!this.active || !width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.invalidate();
  }

  private invalidate(): void {
    if (this.active && !this.frame) this.frame = requestAnimationFrame(now => {
      this.frame = 0;
      if (this.poseAt !== undefined && this.current) {
        const age = Math.min((now - this.poseAt) / 460, 1);
        const spring = Math.sin(Math.PI * age);
        this.current.turn.position.y = spring * 0.14;
        this.current.turn.rotation.z = Math.sin(2 * Math.PI * age) * spring * 0.12;
        if (age < 1) this.invalidate();
        else this.poseAt = undefined;
      }
      this.renderer.render(this.scene, this.camera);
    });
  }
}
