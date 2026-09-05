/**
 * 手持物品与近战攻击：命中判定、伤害、击杀、掉落，以及 attack1/hit/impact/kill 事件流。
 * 规则来自原版 game_weapons.bb、game_functions.bb、handle_objects.bb、handle_units.bb。
 */
import * as THREE from 'three';
import type { EntityRegistry, EntityRecord } from './entities';
import { CLS, STORED_INSIDE } from './entities';
import type { ScriptEngine } from '../script/engine';
import type { World } from '../render/world';
import type { SurvivalStats } from './stats';
import { EXHAUST_ATTACK } from './stats';
import type { ImpactInfo } from '../script/host';

export const HAND_COOLDOWN_MS = 400;
export const MELEE_RANGE = 50;
export const PICK_RADIUS = 5;
export const STATE_INVULNERABILITY = 17;
export const MELEE_BEHAVIOURS = new Set(['blade', 'fastblade', 'slowblade', 'hammer', 'spade', 'net', 'fishingrod', 'torch']);

export interface AttackDeps {
  registry: EntityRegistry;
  engine: ScriptEngine;
  world: World;
  stats: SurvivalStats;
  playerId: number;
  now(): number;
  random(min: number, max: number): number;
  /** 相机位置与朝向，Three 坐标。 */
  eye(): THREE.Vector3;
  dir(): THREE.Vector3;
  terrainY(x: number, zThree: number): number;
  message(text: string, font?: number): void;
  sound(file: string): void;
  onUnitDied?(rec: EntityRecord): void;
}

export interface PickResult {
  cls: number;
  id: number;
  point: THREE.Vector3;
  ground: boolean;
}

export type AttackResult = 'hit' | 'miss' | 'cooldown' | 'blocked' | 'unsupported';

/** 物品 behaviour 的第一个词（原版可带 `ammo:` 等附加段）。 */
export function primaryBehaviour(b: string): string {
  return b.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
}

export class Weapons {
  weaponTyp = 0;
  lastAttack = -Infinity;
  impact: ImpactInfo | null = null;
  private lastKill = false;
  private reportedUnsupported = new Set<string>();

  constructor(private readonly d: AttackDeps) {}

  weaponItem(): EntityRecord | undefined {
    if (this.weaponTyp === 0) return undefined;
    return this.d.registry.storedIn(CLS.unit, this.d.playerId, this.weaponTyp)[0];
  }

  takeInHand(typ: number): boolean {
    if (typ <= 0) {
      this.unequip();
      return true;
    }
    const item = this.d.registry.storedIn(CLS.unit, this.d.playerId, typ)[0];
    if (!item) return false;
    this.weaponTyp = typ;
    this.d.engine.entityEvent(CLS.item, item.id, 'inhand');
    return true;
  }

  unequip(): void {
    this.weaponTyp = 0;
  }

  behaviour(): string {
    if (this.weaponTyp === 0) return 'hand';
    return primaryBehaviour(this.d.registry.defFor(CLS.item, this.weaponTyp)?.behaviour ?? '');
  }

  attack1(): AttackResult {
    const item = this.weaponItem();
    if (this.weaponTyp !== 0 && !item) {
      this.unequip();
      return 'blocked';
    }
    const def = item?.def;
    const hand = this.weaponTyp === 0;
    const cooldown = hand ? HAND_COOLDOWN_MS : (def?.rate ?? 500);
    const now = this.d.now();
    if (now - this.lastAttack < cooldown) return 'cooldown';

    let skip = false;
    if (item && this.d.engine.runNow(CLS.item, item.id, 'attack1').skipevent) skip = true;
    if (this.d.engine.runNow(CLS.unit, this.d.playerId, 'attack1').skipevent) skip = true;
    if (hand && this.d.engine.runGlobalNow('usehand')) skip = true;
    if (skip) return 'blocked';

    const beh = this.behaviour();
    if (!hand && !MELEE_BEHAVIOURS.has(beh)) {
      if (!this.reportedUnsupported.has(beh)) {
        this.reportedUnsupported.add(beh);
        this.d.message(`武器类型 ${beh} 尚未实现`, 2);
      }
      return 'unsupported';
    }

    this.lastAttack = now;
    this.d.stats.exhaust(EXHAUST_ATTACK);
    const playerDef = this.d.registry.defFor(CLS.unit, 1);
    const range = hand ? (playerDef?.attackrange ?? 45) : MELEE_RANGE;
    const damage = hand ? (playerDef?.damage ?? 3) : (def?.damage ?? 0);
    this.d.sound(beh === 'fastblade' ? 'swing_fast.wav' : 'swing_slow.wav');

    const hit = this.pick(range);
    if (!hit) return 'miss';

    if (item && def?.weaponstate && !hit.ground) {
      const typ = this.d.engine.stateType(def.weaponstate);
      if (typ > 0 && !this.d.engine.states.has(hit.cls, hit.id, typ)) {
        this.d.engine.states.add(hit.cls, hit.id, typ);
        this.d.engine.entityEvent(hit.cls, hit.id, 'addstate', String(typ));
      }
    }

    this.impact = { cls: hit.ground ? 0 : hit.cls, id: hit.ground ? 0 : hit.id, kill: false, x: hit.point.x, y: hit.point.y, z: -hit.point.z, ground: hit.ground, damage, weapon: this.weaponTyp };
    if (hit.ground) return 'hit';

    const target = this.d.registry.get(hit.cls, hit.id);
    this.lastKill = false;
    const damaged = this.damage(hit.cls, hit.id, damage, 'player');
    this.impact.kill = this.lastKill;
    if (damaged) {
      if (item) this.d.engine.entityEvent(CLS.item, item.id, 'impact');
      if (hit.cls === CLS.object && target) this.findDrops(target);
    }
    return 'hit';
  }

  /**
   * 命中判定：先用包围球粗筛，再对场景网格做射线求交取最近者；
   * 没有网格的单位用碰撞胶囊近似。地形按每 2 单位采样，先到者为准。
   */
  pick(range: number): PickResult | null {
    const origin = this.d.eye();
    const dir = this.d.dir();
    let best: PickResult | null = null;
    let bestT = Infinity;
    const ray = new THREE.Raycaster(origin, dir, 0, range + PICK_RADIUS);
    const sphereHit = (center: THREE.Vector3, radius: number): number | null => {
      const rel = center.clone().sub(origin);
      const t = rel.dot(dir);
      if (t < -radius || t > range + radius) return null;
      const closest = origin.clone().add(dir.clone().multiplyScalar(Math.max(t, 0)));
      const gap = center.distanceTo(closest);
      const r = radius + PICK_RADIUS;
      if (gap > r) return null;
      return Math.max(t - Math.sqrt(Math.max(r * r - gap * gap, 0)), 0);
    };
    const meshHit = (rec: EntityRecord): number | null => {
      const obj = rec.object!;
      obj.updateMatrixWorld(true);
      const hits = ray.intersectObject(obj, true);
      if (hits.length === 0) return null;
      return hits[0].distance;
    };
    const consider = (rec: EntityRecord, t: number | null) => {
      if (t === null || t > range || t >= bestT) return;
      bestT = t;
      best = { cls: rec.cls, id: rec.id, point: origin.clone().add(dir.clone().multiplyScalar(t)), ground: false };
    };
    for (const rec of this.d.registry.all(CLS.object)) {
      if (!rec.object || (rec.def?.col ?? 1) <= 0) continue;
      const b = this.bounds(rec);
      if (sphereHit(this.center(rec), b.radius) === null) continue;
      consider(rec, meshHit(rec) ?? sphereHit(this.center(rec), Math.min(b.radius, 20)));
    }
    for (const rec of this.d.registry.all(CLS.unit)) {
      if (rec.id === this.d.playerId) continue;
      const def = rec.def;
      const capsule = new THREE.Vector3(rec.x, rec.y, -rec.z);
      const radius = def ? Math.max(def.colxr, def.colyr) : 20;
      if (sphereHit(capsule, radius) === null) continue;
      consider(rec, rec.object ? (meshHit(rec) ?? sphereHit(capsule, def?.colxr ?? radius)) : sphereHit(capsule, radius));
    }
    for (const rec of this.d.world.visibleItems()) {
      if (!rec.object) continue;
      const b = this.bounds(rec);
      if (sphereHit(this.center(rec), b.radius) === null) continue;
      consider(rec, meshHit(rec) ?? sphereHit(this.center(rec), b.radius));
    }
    for (let t = 0; t <= Math.min(range, bestT); t += 2) {
      const p = origin.clone().add(dir.clone().multiplyScalar(t));
      if (p.y <= this.d.terrainY(p.x, p.z)) {
        return { cls: 0, id: 0, point: p, ground: true };
      }
    }
    return best;
  }

  private readonly radii = new WeakMap<THREE.Object3D, { center: THREE.Vector3; radius: number }>();

  private bounds(rec: EntityRecord): { center: THREE.Vector3; radius: number } {
    const obj = rec.object!;
    let b = this.radii.get(obj);
    if (!b) {
      const box = new THREE.Box3().setFromObject(obj);
      const local = box.isEmpty() ? { center: new THREE.Vector3(), radius: 20 } : { center: box.getCenter(new THREE.Vector3()).sub(obj.position), radius: box.getSize(new THREE.Vector3()).length() / 2 };
      b = local;
      this.radii.set(obj, b);
    }
    return b;
  }

  private center(rec: EntityRecord): THREE.Vector3 {
    return this.bounds(rec).center.clone().add(new THREE.Vector3(rec.x, rec.y, -rec.z));
  }

  /** 触发 hit、扣生命、必要时击杀；返回是否命中了实体。 */
  damage(cls: number, id: number, amount: number, causer: 'player' | 'other'): boolean {
    if (cls === CLS.unit && id === this.d.playerId) {
      this.d.stats.health = Math.max(0, this.d.stats.health - amount);
      return true;
    }
    const rec = this.d.registry.get(cls, id);
    if (!rec) return false;
    if (causer === 'player') this.d.engine.entityEvent(cls, id, 'hit');
    if (!this.d.engine.states.has(cls, id, STATE_INVULNERABILITY)) rec.health -= amount;
    if (rec.health <= 0) {
      rec.health = 0;
      this.kill(rec);
    }
    return true;
  }

  kill(rec: EntityRecord): void {
    this.lastKill = true;
    switch (rec.cls) {
      case CLS.object: {
        this.d.engine.runNow(CLS.object, rec.id, 'kill');
        if (rec.def?.behaviour === 'tree') this.d.sound('treefall.wav');
        for (const item of this.d.registry.all(CLS.item)) {
          if (item.parentClass === CLS.object && item.parentId === rec.id && item.parentMode !== STORED_INSIDE) {
            item.parentClass = 0;
            item.parentId = 0;
            item.x = rec.x;
            item.z = rec.z;
            item.y = this.d.terrainY(rec.x, -rec.z);
            this.d.world.sync(item);
          }
        }
        this.d.engine.states.free(CLS.object, rec.id);
        this.d.world.remove(rec);
        break;
      }
      case CLS.unit: {
        if (rec.dead) break;
        for (const loot of rec.def?.loots ?? []) {
          const count = this.d.random(1, loot.max);
          const item = this.d.registry.make(CLS.item, loot.typ, rec.x, rec.y, rec.z, count);
          item.parentClass = CLS.unit;
          item.parentId = rec.id;
          item.parentMode = STORED_INSIDE;
        }
        this.d.engine.runNow(CLS.unit, rec.id, 'kill');
        rec.dead = true;
        rec.health = 0;
        rec.healthMax = 0;
        this.d.engine.states.free(CLS.unit, rec.id);
        this.d.onUnitDied?.(rec);
        break;
      }
      case CLS.item: {
        if (rec.count > 1) {
          rec.count -= 1;
          rec.health = rec.def?.health ?? 100;
          break;
        }
        this.d.engine.runNow(CLS.item, rec.id, 'kill');
        this.d.world.remove(rec);
        break;
      }
      default:
        break;
    }
  }

  /** 按 find= 条目掉落：过滤手持要求、findratio 概率、ratio 加权随机、数量 min..max，直接放进玩家背包。 */
  findDrops(rec: EntityRecord): void {
    const def = rec.def;
    if (!def) return;
    const entries = def.finds.filter(f => f.reqTyp === 0 || f.reqTyp === this.weaponTyp);
    const total = entries.reduce((s, f) => s + f.ratio, 0);
    if (total === 0) return;
    if (this.d.random(1, 100) > Math.floor(def.findratio)) return;
    const r = this.d.random(0, total);
    let acc = 0;
    for (const f of entries) {
      if (r >= acc && r <= acc + f.ratio) {
        const count = this.d.random(f.min, f.max);
        this.give(f.typ, count);
        return;
      }
      acc += f.ratio;
    }
  }

  private give(typ: number, count: number): void {
    const item = this.d.registry.make(CLS.item, typ, 0, 0, 0, count);
    const stored = this.d.registry.store(item.id, CLS.unit, this.d.playerId);
    const name = this.d.registry.defFor(CLS.item, typ)?.name ?? `#${typ}`;
    if (stored > 0) {
      this.d.message(`Collected ${name} (${stored})`, 1);
      this.d.sound('collect.wav');
      const left = this.d.registry.get(CLS.item, item.id);
      if (left && left.parentMode !== STORED_INSIDE) this.d.registry.remove(CLS.item, item.id);
    } else {
      this.d.registry.remove(CLS.item, item.id);
      this.d.message('没有空间了', 2);
      this.d.sound('fail.wav');
    }
  }
}
