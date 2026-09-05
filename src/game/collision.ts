/** 玩家与物体的射线近似碰撞：三高度射线沿位移方向滑动，八方向射线推出。 */
import * as THREE from 'three';

export interface Collidable {
  object: THREE.Object3D;
  center: THREE.Vector3;
  radius: number;
}

export function collides(col: number): boolean {
  return col === 1 || col === 3 || col === 4;
}

const DIRS8: THREE.Vector3[] = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  return new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
});

export class ObjectCollider {
  readonly items: Collidable[] = [];
  private readonly ray = new THREE.Raycaster();

  constructor(entries: { object: THREE.Object3D; col: number }[]) {
    for (const e of entries) {
      if (!collides(e.col)) continue;
      e.object.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(e.object);
      if (box.isEmpty()) continue;
      const center = box.getCenter(new THREE.Vector3());
      const radius = box.getSize(new THREE.Vector3()).length() / 2;
      this.items.push({ object: e.object, center, radius });
    }
  }

  nearby(pos: THREE.Vector3, range: number): Collidable[] {
    return this.items.filter(c => c.center.distanceTo(pos) <= range + c.radius);
  }

  private hit(origin: THREE.Vector3, dir: THREE.Vector3, far: number, objs: THREE.Object3D[]): THREE.Intersection | null {
    this.ray.set(origin, dir);
    this.ray.near = 0;
    this.ray.far = far;
    const hits = this.ray.intersectObjects(objs, true);
    return hits.length ? hits[0] : null;
  }

  /** 返回修正后的水平位移。pos 为单位原点（地面上方 halfHeight）。 */
  resolveMove(pos: THREE.Vector3, delta: THREE.Vector3, radius: number, halfHeight: number): THREE.Vector3 {
    let move = delta.clone();
    move.y = 0;
    if (move.lengthSq() === 0) return move;
    const objs = this.nearby(pos, radius + move.length() + 64).map(c => c.object);
    if (objs.length === 0) return move;
    const heights = [-halfHeight + 4, 0, halfHeight - 2];
    for (let attempt = 0; attempt < 2; attempt++) {
      const len = move.length();
      if (len === 0) break;
      const dir = move.clone().normalize();
      let nearest: THREE.Intersection | null = null;
      for (const h of heights) {
        const origin = new THREE.Vector3(pos.x, pos.y + h, pos.z);
        const hit = this.hit(origin, dir, radius + len, objs);
        if (hit && (!nearest || hit.distance < nearest.distance)) nearest = hit;
      }
      if (!nearest) return move;
      const allowed = Math.max(nearest.distance - radius, 0);
      const normal = nearest.face ? nearest.face.normal.clone().transformDirection(nearest.object.matrixWorld) : dir.clone().negate();
      normal.y = 0;
      if (normal.lengthSq() === 0) return dir.multiplyScalar(allowed);
      normal.normalize();
      const remaining = move.clone().sub(dir.clone().multiplyScalar(allowed));
      const slide = remaining.sub(normal.clone().multiplyScalar(remaining.dot(normal)));
      const done = dir.multiplyScalar(allowed);
      if (attempt === 1 || slide.lengthSq() < 1e-6) return done;
      pos = pos.clone().add(done);
      move = slide;
      const prefix = done;
      const rest = this.resolveOnce(pos, move, radius, heights, objs);
      return prefix.add(rest);
    }
    return move;
  }

  private resolveOnce(pos: THREE.Vector3, move: THREE.Vector3, radius: number, heights: number[], objs: THREE.Object3D[]): THREE.Vector3 {
    const len = move.length();
    if (len === 0) return move;
    const dir = move.clone().normalize();
    let nearest: THREE.Intersection | null = null;
    for (const h of heights) {
      const hit = this.hit(new THREE.Vector3(pos.x, pos.y + h, pos.z), dir, radius + len, objs);
      if (hit && (!nearest || hit.distance < nearest.distance)) nearest = hit;
    }
    if (!nearest) return move;
    return dir.multiplyScalar(Math.max(nearest.distance - radius, 0));
  }

  /** 腰高度八方向射线，距离小于半径时沿法线推出；返回推出向量。 */
  pushOut(pos: THREE.Vector3, radius: number): THREE.Vector3 {
    const out = new THREE.Vector3();
    const objs = this.nearby(pos, radius + 64).map(c => c.object);
    if (objs.length === 0) return out;
    for (const d of DIRS8) {
      const hit = this.hit(pos, d, radius, objs);
      if (hit) out.add(d.clone().multiplyScalar(-(radius - hit.distance)));
    }
    return out;
  }
}
