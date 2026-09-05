/** 准星焦点：视线 48 单位内、距视线 5 单位以内的最近可见物品。 */
import * as THREE from 'three';
import type { World } from '../render/world';
import type { EntityRecord } from './entities';

export const USE_RANGE = 48;
export const USE_RADIUS = 5;

export class Pickup {
  private readonly radii = new WeakMap<THREE.Object3D, number>();

  constructor(private readonly camera: THREE.Camera, private readonly world: World) {}

  private radiusOf(o: THREE.Object3D): number {
    let r = this.radii.get(o);
    if (r === undefined) {
      const box = new THREE.Box3().setFromObject(o);
      r = box.isEmpty() ? 5 : box.getSize(new THREE.Vector3()).length() / 2;
      this.radii.set(o, r);
    }
    return r;
  }

  focus(): EntityRecord | null {
    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    let best: EntityRecord | null = null;
    let bestT = Infinity;
    for (const e of this.world.visibleItems()) {
      if (!e.object) continue;
      const center = e.object.getWorldPosition(new THREE.Vector3());
      const rel = center.clone().sub(origin);
      const t = rel.dot(dir);
      const r = this.radiusOf(e.object);
      if (t < -r || t > USE_RANGE + r) continue;
      const along = Math.max(Math.min(t, USE_RANGE), 0);
      const closest = origin.clone().add(dir.clone().multiplyScalar(along));
      const gap = center.distanceTo(closest) - r;
      if (gap <= USE_RADIUS && along < bestT) {
        best = e;
        bestT = along;
      }
    }
    return best;
  }

  /** 视线 48 单位处的落点（Three 坐标），用于使用键指向地面或海面。 */
  aimPoint(): THREE.Vector3 {
    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    return origin.add(dir.multiplyScalar(USE_RANGE));
  }
}
