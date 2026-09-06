/**
 * 投射物：远程武器的弹药与投掷物品。每 f 前进 speed，俯角每 f 增加 drag（上限 88 度）；
 * 命中实体或落地后走 Weapons.strike 的命中流程，behaviour 为 throw 的落地后变回物品。
 * 坐标为 Blitz 坐标。规则来自原版 projectiles.bb。
 */
import * as THREE from 'three';
import { CLS, type EntityRegistry, type EntityRecord } from './entities';
import type { ScriptEngine } from '../script/engine';
import type { World } from '../render/world';
import type { Weapons } from './weapons';

export const TIMEOUT_MS = 15000;
export const MAX_PITCH = 88;
/** 命中判定时给实体包围球额外加的半径。 */
const HIT_PADDING = 3;
const DEG = Math.PI / 180;

export interface FireOptions {
  /** 投射物的物品类型（弹药或被投掷的物品）。 */
  typ: number;
  weaponTyp: number;
  ammoTyp: number;
  spawner: number;
  x: number;
  y: number;
  z: number;
  pitch: number;
  yaw: number;
  speed: number;
  drag: number;
  damage: number;
}

export interface Projectile extends FireOptions {
  id: number;
  born: number;
  object?: THREE.Object3D;
}

export interface ProjectileDeps {
  registry: EntityRegistry;
  world: World;
  engine: ScriptEngine;
  weapons: Weapons;
  playerId: number;
  terrainY(x: number, zBlitz: number): number;
  now(): number;
  /** 异步创建投射物的场景对象；省略时不显示。 */
  model?(typ: number): Promise<THREE.Object3D | null>;
}

export class Projectiles {
  readonly list: Projectile[] = [];
  private nextId = 1;

  constructor(private readonly d: ProjectileDeps) {}

  fire(opts: FireOptions): Projectile {
    const p: Projectile = { ...opts, id: this.nextId++, born: this.d.now() };
    this.list.push(p);
    this.d.model?.(opts.typ).then(obj => {
      if (!obj || !this.list.includes(p)) return;
      p.object = obj;
      this.d.world.group.add(obj);
      this.place(p);
    });
    return p;
  }

  update(dtMs: number): void {
    const f = dtMs / 20;
    const now = this.d.now();
    for (const p of [...this.list]) {
      if (now - p.born > TIMEOUT_MS) { this.remove(p); continue; }
      const step = p.speed * f;
      const yaw = p.yaw * DEG;
      const pitch = p.pitch * DEG;
      const from = { x: p.x, y: p.y, z: p.z };
      p.x += -Math.sin(yaw) * Math.cos(pitch) * step;
      p.y += -Math.sin(pitch) * step;
      p.z += Math.cos(yaw) * Math.cos(pitch) * step;
      p.pitch = Math.min(p.pitch + p.drag * f, MAX_PITCH);
      const hit = this.collide(p, from);
      if (hit) {
        this.d.weapons.strike({ cls: hit.cls, id: hit.id, x: hit.x, y: hit.y, z: hit.z, ground: false }, p.damage, p.weaponTyp, p.ammoTyp);
        this.remove(p);
        continue;
      }
      if (p.y <= this.d.terrainY(p.x, p.z)) {
        this.land(p);
        continue;
      }
      this.place(p);
    }
  }

  private land(p: Projectile): void {
    p.y = this.d.terrainY(p.x, p.z);
    const skip = this.d.weapons.strike({ cls: 0, id: 0, x: p.x, y: p.y, z: p.z, ground: true }, p.damage, p.weaponTyp, p.ammoTyp);
    const beh = (this.d.registry.defFor(CLS.item, p.typ)?.behaviour ?? '').trim().toLowerCase();
    if (beh.startsWith('throw') && !skip) {
      const item = this.d.world.create(CLS.item, p.typ, p.x, p.z, 1);
      if (item) {
        item.y = p.y;
        this.d.world.sync(item);
        this.d.engine.entityEvent(CLS.item, item.id, 'drop');
      }
    }
    this.remove(p);
  }

  /** 线段与实体包围球求交，取最近者；跳过发射者与尸体。 */
  private collide(p: Projectile, from: { x: number; y: number; z: number }): { cls: number; id: number; x: number; y: number; z: number } | null {
    const dx = p.x - from.x;
    const dy = p.y - from.y;
    const dz = p.z - from.z;
    const len2 = dx * dx + dy * dy + dz * dz;
    let best: { cls: number; id: number; x: number; y: number; z: number; t: number } | null = null;
    const test = (rec: EntityRecord, cx: number, cy: number, cz: number, radius: number): void => {
      const t = len2 === 0 ? 0 : Math.min(Math.max(((cx - from.x) * dx + (cy - from.y) * dy + (cz - from.z) * dz) / len2, 0), 1);
      const px = from.x + dx * t;
      const py = from.y + dy * t;
      const pz = from.z + dz * t;
      const r = radius + HIT_PADDING;
      if ((px - cx) ** 2 + (py - cy) ** 2 + (pz - cz) ** 2 > r * r) return;
      if (best && t >= best.t) return;
      best = { cls: rec.cls, id: rec.id, x: px, y: py, z: pz, t };
    };
    for (const rec of this.d.registry.all(CLS.unit)) {
      if (rec.dead || (rec.cls === CLS.unit && rec.id === p.spawner)) continue;
      const def = rec.def;
      test(rec, rec.x, rec.y, rec.z, def ? Math.max(def.colxr, def.colyr) : 20);
    }
    for (const rec of this.d.registry.all(CLS.object)) {
      const def = rec.def;
      if (!def || def.col <= 0) continue;
      test(rec, rec.x, rec.y + def.colyr, rec.z, Math.max(def.colxr, def.colyr));
    }
    for (const rec of this.d.world.visibleItems()) test(rec, rec.x, rec.y, rec.z, 5);
    return best;
  }

  private place(p: Projectile): void {
    if (!p.object) return;
    p.object.position.set(p.x, p.y, -p.z);
    p.object.rotation.set(-p.pitch * DEG, p.yaw * DEG, 0);
  }

  private remove(p: Projectile): void {
    const i = this.list.indexOf(p);
    if (i >= 0) this.list.splice(i, 1);
    if (p.object) this.d.world.group.remove(p.object);
  }
}
