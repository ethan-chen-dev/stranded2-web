/**
 * 手持物品与近战攻击：命中判定、伤害、击杀、掉落，以及 attack1/hit/impact/kill 事件流。
 * 规则来自原版 game_weapons.bb、game_functions.bb、handle_objects.bb、handle_units.bb。
 */
import * as THREE from 'three';
import { P, type ParticleHandle } from '../render/particles';
import type { EntityRegistry, EntityRecord } from './entities';
import { CLS, STORED_INSIDE } from './entities';
import type { ScriptEngine } from '../script/engine';
import type { World } from '../render/world';
import type { SurvivalStats } from './stats';
import { EXHAUST_ATTACK } from './stats';
import type { ImpactInfo } from '../script/host';
import type { FireOptions } from './projectiles';
import type { EntityDef } from '../formats/inf';

export const HAND_COOLDOWN_MS = 400;
export const MELEE_RANGE = 50;
export const PICK_RADIUS = 5;
export const STATE_INVULNERABILITY = 17;
/** 各材质的命中音效数量（sfx/mat_<材质><n>.wav），与原版 material_fx 一致。 */
const MATERIAL_SOUNDS: Record<string, number> = { flesh: 5, wood: 2, stone: 1, leaf: 4, metal: 1, dust: 1, fruit: 2, glass: 2 };

const STATE_FIRE = 4;
export const MELEE_BEHAVIOURS = new Set(['blade', 'fastblade', 'slowblade', 'hammer', 'spade', 'net', 'fishingrod', 'torch']);
/** 需要弹药并发射投射物的武器。 */
export const RANGED_BEHAVIOURS = new Set(['bow', 'slingshot', 'launcher', 'catapult']);
/** 需要弹药、即时命中的火器；射程为武器 speed。 */
export const FIREARM_BEHAVIOURS = new Set(['pistol', 'gun', 'machinegun']);
/** 把手持物品本身投出去的武器。 */
export const THROW_BEHAVIOURS = new Set(['selfthrow', 'spear', 'killthrow', 'throw']);

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
  /** 单位被玩家打中且未死亡时的回调，用于 AI 受击反应。 */
  onUnitHurt?(rec: EntityRecord): void;
  /** material_fx：受击处按材质生成粒子并播放音效（Blitz 坐标）；未接入时只播放材质音效。 */
  materialFx?(x: number, y: number, z: number, mat: string): void;
  /** 生成粒子（Blitz 坐标）；未接入时没有挥砍弧光、命中闪光、枪口烟与水花。 */
  particle?(x: number, y: number, z: number, typ: number, size?: number, a?: number): ParticleHandle | null;
  /** 特效档位 set_effects。 */
  effects?(): number;
  /** 被摧毁物体的模型倾倒下沉（Cp_fall），播完后移除。 */
  objectFall?(model: THREE.Object3D): void;
}

export interface StrikeTarget {
  cls: number;
  id: number;
  /** Blitz 坐标的命中点。 */
  x: number;
  y: number;
  z: number;
  ground: boolean;
}

export interface PickResult {
  cls: number;
  id: number;
  point: THREE.Vector3;
  ground: boolean;
}

export type AttackResult = 'hit' | 'miss' | 'fired' | 'cooldown' | 'blocked' | 'unsupported';

/** 物品 behaviour 里的 `ammo:<武器类型>` 段表示可作该武器的弹药。 */
export function isAmmoFor(def: EntityDef | undefined, weaponTyp: number): boolean {
  return (def?.behaviour ?? '').split(/[\s,]+/).includes(`ammo:${weaponTyp}`);
}

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
  /** 投射物发射器，由会话注入；缺省时远程武器不可用。 */
  launcher?: { fire(opts: FireOptions): void };

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
    if (hand || MELEE_BEHAVIOURS.has(beh)) return this.melee(now, hand, def, beh);
    if (RANGED_BEHAVIOURS.has(beh) || FIREARM_BEHAVIOURS.has(beh)) return this.shoot(now, item!, def!, FIREARM_BEHAVIOURS.has(beh));
    if (THROW_BEHAVIOURS.has(beh)) return this.throwItem(now, item!, def!);
    if (!this.reportedUnsupported.has(beh)) {
      this.reportedUnsupported.add(beh);
      this.d.message(`Weapon type ${beh} is not implemented yet`, 3);
    }
    return 'unsupported';
  }

  private melee(now: number, hand: boolean, def: EntityDef | undefined, beh: string): AttackResult {
    this.lastAttack = now;
    this.d.stats.exhaust(EXHAUST_ATTACK);
    const playerDef = this.d.registry.defFor(CLS.unit, 1);
    const range = hand ? (playerDef?.attackrange ?? 45) : MELEE_RANGE;
    const damage = hand ? (playerDef?.damage ?? 3) : (def?.damage ?? 0);
    this.d.sound(beh === 'fastblade' ? 'swing_fast.wav' : 'swing_slow.wav');

    const hit = this.pick(range);
    this.d.particle?.(this.d.random(-1, 2), 0, 0, P.attack, 12, 0.5);
    if (!hit) return 'miss';
    const at = { x: hit.point.x, y: hit.point.y, z: -hit.point.z };
    this.strike({ cls: hit.cls, id: hit.id, ...at, ground: hit.ground }, damage, this.weaponTyp, this.weaponTyp);
    if (!hit.ground) this.d.particle?.(at.x, at.y, at.z, P.impact, 4 + Math.random() * 8, 0.4 + Math.random() * 0.2)?.order(-1);
    return 'hit';
  }

  /** 背包里第一件可作当前武器弹药的物品。 */
  ammoFor(weaponTyp: number): EntityRecord | undefined {
    return this.d.registry.storedIn(CLS.unit, this.d.playerId).find(it => isAmmoFor(it.def, weaponTyp));
  }

  private shoot(now: number, item: EntityRecord, def: EntityDef, hitscan: boolean): AttackResult {
    const ammo = this.ammoFor(def.id);
    if (!ammo || !ammo.def) {
      this.d.message('No ammunition', 3);
      this.d.sound('fail.wav');
      this.d.engine.entityEvent(CLS.item, item.id, 'noammo');
      return 'blocked';
    }
    if (!hitscan && !this.launcher) return 'unsupported';
    this.lastAttack = now;
    this.d.stats.exhaust(EXHAUST_ATTACK);
    const ammoDef = ammo.def;
    const ammoTyp = ammo.typ;
    const damage = def.damage * ammoDef.damage;
    this.d.registry.consume(ammo.id, 1);
    this.d.sound(hitscan ? 'shot.wav' : def.behaviour === 'launcher' ? 'launch.wav' : 'bow.wav');
    if (def.behaviour === 'launcher' && (this.d.effects?.() ?? 1) > 0) {
      const eye = this.d.eye();
      const r = (a: number, b: number) => a + Math.random() * (b - a);
      for (let i = 0; i < 5; i++) this.d.particle?.(eye.x + r(-3, 3), eye.y + r(-3, 3), -eye.z + r(-3, 3), P.smoke, r(5, 7), r(0.4, 0.7));
    }
    if (hitscan) {
      const hit = this.pick(def.speed);
      this.gunFx(hit ? { x: hit.point.x, y: hit.point.y, z: -hit.point.z, ground: hit.ground } : null, def.speed);
      if (!hit) return 'miss';
      this.strike({ cls: hit.cls, id: hit.id, x: hit.point.x, y: hit.point.y, z: -hit.point.z, ground: hit.ground }, damage, def.id, ammoTyp);
      return 'hit';
    }
    this.launcher!.fire({ typ: ammoTyp, weaponTyp: def.id, ammoTyp, spawner: this.d.playerId, ...this.muzzle(), speed: def.speed, drag: def.drag + ammoDef.drag, damage });
    return 'fired';
  }

  /**
   * 枪的特效（game_weapons.bb）：枪口烟；弹道穿过水面处的涟漪、水花与水下气泡；打在地面冒烟。弹道线不画。
   */
  private gunFx(hit: { x: number; y: number; z: number; ground: boolean } | null, range: number): void {
    const p = this.d.particle;
    if (!p) return;
    const eye = this.d.eye();
    const from = { x: eye.x, y: eye.y, z: -eye.z };
    const r = (a: number, b: number) => a + Math.random() * (b - a);
    if ((this.d.effects?.() ?? 1) > 0) for (let i = 0; i < 5; i++) p(from.x + r(-3, 3), from.y + r(-3, 3), from.z + r(-3, 3), P.smoke, r(5, 7), r(0.15, 0.4));
    const dir = this.d.dir();
    const to = hit ?? { x: from.x + dir.x * range, y: from.y + dir.y * range, z: from.z - dir.z * range };
    if ((from.y < 0) !== (to.y < 0)) {
      const t = from.y / (from.y - to.y);
      const wx = from.x + (to.x - from.x) * t;
      const wz = from.z + (to.z - from.z) * t;
      p(wx, 1, wz, P.rwave, r(5, 10), r(0.9, 1.5));
      if (from.y >= 0) p(wx, 1, wz, P.splash, r(15, 20), 1);
    }
    if (to.y < 0) for (let s = 0; s <= 1; s += 0.1) {
      const y = from.y + (to.y - from.y) * s;
      if (y < 0 && this.d.random(1, 2) === 1) p(from.x + (to.x - from.x) * s, y, from.z + (to.z - from.z) * s, P.bubbles, r(1, 3), r(0.3, 0.5));
    }
    if (hit?.ground) p(hit.x, hit.y, hit.z, P.smoke, r(5, 10), r(0.3, 1.5));
  }

  private throwItem(now: number, item: EntityRecord, def: EntityDef): AttackResult {
    if (!this.launcher) return 'unsupported';
    this.lastAttack = now;
    this.d.stats.exhaust(EXHAUST_ATTACK);
    this.d.registry.consume(item.id, 1);
    if (!this.weaponItem()) this.unequip();
    this.d.sound('throw.wav');
    this.launcher.fire({ typ: def.id, weaponTyp: def.id, ammoTyp: def.id, spawner: this.d.playerId, ...this.muzzle(), speed: def.speed, drag: def.drag, damage: def.damage });
    return 'fired';
  }

  /** 相机位置与朝向换算为 Blitz 坐标与角度；原版前进方向为 (-sin yaw, cos yaw)，pitch 正值向下。 */
  private muzzle(): { x: number; y: number; z: number; pitch: number; yaw: number } {
    const eye = this.d.eye();
    const dir = this.d.dir();
    const yaw = Math.atan2(-dir.x, -dir.z) * 180 / Math.PI;
    const pitch = -Math.asin(Math.max(-1, Math.min(1, dir.y))) * 180 / Math.PI;
    return { x: eye.x, y: eye.y, z: -eye.z, pitch, yaw };
  }

  /**
   * 命中处理：武器与弹药的 weaponstate 附加到目标，设置 impact 环境，造成伤害，
   * 对背包里的武器与弹药触发 impact 事件（不在背包时以类型脚本执行），命中物体时按 find 掉落。
   * 返回 impact 脚本是否 skipevent。
   */
  strike(hit: StrikeTarget, damage: number, weaponTyp: number, ammoTyp: number, wet = false): boolean {
    const typs = weaponTyp === ammoTyp || ammoTyp === 0 ? [weaponTyp] : [weaponTyp, ammoTyp];
    if (!hit.ground) {
      for (const typ of typs) {
        const state = this.d.registry.defFor(CLS.item, typ)?.weaponstate;
        if (!state) continue;
        const st = this.d.engine.stateType(state);
        // state_depleted：穿过水的投射物带不上火
        if (st > 0 && !(wet && st === STATE_FIRE)) this.d.engine.stateRules.set(hit.cls, hit.id, st);
      }
    }
    this.impact = { cls: hit.ground ? 0 : hit.cls, id: hit.ground ? 0 : hit.id, kill: false, x: hit.x, y: hit.y, z: hit.z, ground: hit.ground, damage, weapon: weaponTyp };
    let damaged = false;
    const target = hit.ground ? undefined : this.d.registry.get(hit.cls, hit.id);
    if (!hit.ground) {
      this.lastKill = false;
      damaged = this.damage(hit.cls, hit.id, damage, 'player', { x: hit.x, y: hit.y, z: hit.z });
      this.impact.kill = this.lastKill;
    }
    let skip = false;
    if (damaged || hit.ground) {
      for (const typ of typs) {
        if (typ <= 0) continue;
        const inst = this.d.registry.storedIn(CLS.unit, this.d.playerId, typ)[0];
        if (inst) {
          if (this.d.engine.runNow(CLS.item, inst.id, 'impact').skipevent) skip = true;
          continue;
        }
        const script = this.d.registry.defFor(CLS.item, typ)?.script;
        if (script && this.d.engine.runText(script, { cls: -2, id: 0, event: 'impact', info: '' }, `item ${typ} impact`) === 'skipevent') skip = true;
      }
      if (damaged && hit.cls === CLS.object && target) this.findDrops(target);
    }
    return skip;
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
  damage(cls: number, id: number, amount: number, causer: 'player' | 'other', at?: { x: number; y: number; z: number }): boolean {
    if (cls === CLS.unit && id === this.d.playerId) {
      this.d.stats.health = Math.max(0, this.d.stats.health - amount);
      return true;
    }
    const rec = this.d.registry.get(cls, id);
    if (!rec) return false;
    if (causer === 'player') this.d.engine.entityEvent(cls, id, 'hit');
    if (!this.d.engine.states.has(cls, id, STATE_INVULNERABILITY)) rec.health -= amount;
    if (this.d.materialFx) {
      const p = at ?? { x: rec.x, y: rec.y + (cls === CLS.unit ? rec.def?.eyes ?? 0 : 0), z: rec.z };
      this.d.materialFx(p.x, p.y, p.z, rec.def?.mat ?? '');
    } else {
      this.materialSound(rec.def?.mat ?? '');
    }
    if (rec.health <= 0) {
      rec.health = 0;
      this.kill(rec);
    } else if (cls === CLS.unit && causer === 'player') {
      this.d.onUnitHurt?.(rec);
    }
    return true;
  }

  /** 按材质播放命中音效，没有对应材质时静默。 */
  private materialSound(mat: string): void {
    const n = MATERIAL_SOUNDS[mat.trim().toLowerCase()];
    if (!n) return;
    this.d.sound(`mat_${mat.trim().toLowerCase()}${this.d.random(1, n)}.wav`);
  }

  /**
   * drop_childs(...,1)：挂在外面的子物品留在原处自由下落；收在里面的散落到物体包围盒内
   * （x 在 ±半宽、高度在 0..半宽、z 在 -半深..0，后者沿用原版笔误 sz#）。
   */
  private dropChildren(rec: EntityRecord): void {
    const box = rec.object ? new THREE.Box3().setFromObject(rec.object) : null;
    const size = box && !box.isEmpty() ? box.getSize(new THREE.Vector3()) : new THREE.Vector3();
    const xs = size.x / 2;
    const zs = size.z / 2;
    const r = (a: number, b: number) => a + Math.random() * (b - a);
    for (const item of [...this.d.registry.all(CLS.item)]) {
      if (item.parentClass !== CLS.object || item.parentId !== rec.id) continue;
      if (item.parentMode === STORED_INSIDE) {
        item.x = rec.x + r(-xs, xs);
        item.y = rec.y + r(0, xs);
        item.z = rec.z + r(-zs, 0);
        item.parentMode = 0;
      }
      item.parentClass = 0;
      item.parentId = 0;
      this.d.world.sync(item);
    }
  }

  kill(rec: EntityRecord): void {
    this.lastKill = true;
    switch (rec.cls) {
      case CLS.object: {
        this.d.engine.runNow(CLS.object, rec.id, 'kill');
        if (rec.def?.behaviour === 'tree') this.d.sound('treefall.wav');
        this.dropChildren(rec);
        const model = this.d.world.takeModel(rec);
        this.d.world.remove(rec);
        if (model) this.d.objectFall?.(model);
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
      this.d.message(`Collected ${name} (${stored})`, 4);
      this.d.sound('collect.wav');
      const left = this.d.registry.get(CLS.item, item.id);
      if (left && left.parentMode !== STORED_INSIDE) this.d.registry.remove(CLS.item, item.id);
    } else {
      this.d.registry.remove(CLS.item, item.id);
      this.d.message('No space left', 3);
      this.d.sound('fail.wav');
    }
  }
}
