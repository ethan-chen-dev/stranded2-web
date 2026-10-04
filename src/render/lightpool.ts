/**
 * 状态光源（火焰、电击、光状态）的固定点光源池。Three.js 的点光源数量变化会让所有材质重新编译着色器，
 * 所以预先建好 SIZE 盏，每帧把离镜头最近的可见请求分配上去，其余熄灭。
 * Blitz 的 LightRange 是衰减距离，这里换算为线性衰减、照射距离为 4 倍 range 的点光源。
 */
import * as THREE from 'three';
import type { StateLight } from '../game/stateeffects';

const SIZE = 6;
const RANGE_FACTOR = 4;
const INTENSITY_PER_RANGE = 2;

interface Request {
  x: number;
  y: number;
  z: number;
  color: [number, number, number];
  range: number;
  on: boolean;
  alive: boolean;
}

export class LightPool {
  readonly group = new THREE.Group();
  private readonly lights: THREE.PointLight[] = [];
  private readonly requests = new Set<Request>();

  constructor() {
    this.group.name = 'state-lights';
    for (let i = 0; i < SIZE; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 1, 1);
      this.lights.push(l);
      this.group.add(l);
    }
  }

  create(): StateLight {
    const r: Request = { x: 0, y: 0, z: 0, color: [255, 255, 255], range: 0, on: true, alive: true };
    this.requests.add(r);
    return {
      set: (x, y, z, color, range) => { r.x = x; r.y = y; r.z = z; r.color = color; r.range = range; },
      visible: on => { r.on = on; },
      dispose: () => { r.alive = false; this.requests.delete(r); },
    };
  }

  /** 镜头位置为 Blitz 坐标。 */
  update(camera: { x: number; y: number; z: number }): void {
    const active = [...this.requests].filter(r => r.on && r.range > 0)
      .sort((a, b) => dist(a, camera) - dist(b, camera));
    for (let i = 0; i < SIZE; i++) {
      const l = this.lights[i];
      const r = active[i];
      if (!r) { l.intensity = 0; continue; }
      l.position.set(r.x, r.y, -r.z);
      l.color.setRGB(r.color[0] / 255, r.color[1] / 255, r.color[2] / 255);
      l.distance = r.range * RANGE_FACTOR;
      l.intensity = r.range * INTENSITY_PER_RANGE;
    }
  }

  clear(): void {
    this.requests.clear();
    for (const l of this.lights) l.intensity = 0;
  }
}

function dist(r: Request, c: { x: number; y: number; z: number }): number {
  return Math.hypot(r.x - c.x, r.y - c.y, r.z - c.z);
}
