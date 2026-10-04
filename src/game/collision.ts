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

/** 沿射线方向可前进的距离：命中点到面的垂直净空保留 radius，再换算回射线方向。 */
function clearance(hitDistance: number, dir: THREE.Vector3, normal: THREE.Vector3, radius: number): number {
  const cos = Math.abs(dir.dot(normal));
  if (cos < 1e-4) return hitDistance;
  return Math.max((hitDistance * cos - radius) / cos, 0);
}

const DIRS8: THREE.Vector3[] = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  return new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
});

const DOWN = new THREE.Vector3(0, -1, 0);

export class ObjectCollider {
  readonly items: Collidable[] = [];
  private readonly ray = new THREE.Raycaster();

  constructor(entries: { object: THREE.Object3D; col: number }[]) {
    for (const e of entries) this.add(e.object, e.col);
  }

  /** 物体进入场景（建造、脚本创建、换模型）时加入；col 不碰撞的忽略。 */
  add(object: THREE.Object3D, col: number): void {
    if (!collides(col) || this.items.some(c => c.object === object)) return;
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    this.items.push({ object, center, radius });
  }

  /** 物体离开场景（砍倒、摧毁、移除）时去掉，否则会留下看不见的墙。 */
  remove(object: THREE.Object3D): void {
    const i = this.items.findIndex(c => c.object === object);
    if (i >= 0) this.items.splice(i, 1);
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
      const normal = nearest.face ? nearest.face.normal.clone().transformDirection(nearest.object.matrixWorld) : dir.clone().negate();
      normal.y = 0;
      if (normal.lengthSq() === 0) return dir.multiplyScalar(Math.max(nearest.distance - radius, 0));
      normal.normalize();
      const allowed = clearance(nearest.distance, dir, normal, radius);
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
    const normal = nearest.face ? nearest.face.normal.clone().transformDirection(nearest.object.matrixWorld) : dir.clone().negate();
    normal.y = 0;
    if (normal.lengthSq() === 0) return dir.multiplyScalar(Math.max(nearest.distance - radius, 0));
    return dir.multiplyScalar(clearance(nearest.distance, dir, normal.normalize(), radius));
  }

  /** 从 top 竖直向下到 bottom 之间第一个物体表面的高度（Three 坐标），用于下落的物品落在物体上。 */
  floorBelow(x: number, top: number, bottom: number, z: number): number | null {
    const origin = new THREE.Vector3(x, top + 0.5, z);
    const objs = this.nearby(origin, top - bottom + 1).map(c => c.object);
    if (objs.length === 0) return null;
    const hit = this.hit(origin, DOWN, top - bottom + 0.5, objs);
    return hit ? hit.point.y : null;
  }

  /** 从 from 到 to 的线段碰到物体时，返回退回 radius 后的停止点（Three 坐标），否则 null。 */
  segment(from: THREE.Vector3, to: THREE.Vector3, radius: number): THREE.Vector3 | null {
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 1e-6) return null;
    dir.divideScalar(len);
    const objs = this.nearby(from, len + radius).map(c => c.object);
    if (objs.length === 0) return null;
    const hit = this.hit(from, dir, len + radius, objs);
    if (!hit) return null;
    return from.clone().add(dir.multiplyScalar(Math.max(0, hit.distance - radius)));
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
