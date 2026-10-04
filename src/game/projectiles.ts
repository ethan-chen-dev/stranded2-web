/**
 * 投射物：远程武器的弹药与投掷物品。每 f 前进 speed，俯角每 f 增加 drag（上限 88 度），绕自身轴每 f 转 10 度；
 * 命中实体或落地后走 Weapons.strike 的命中流程，behaviour 为 throw 的落地后变回物品，rocket 与 toxicrocket 爆炸。
 * 飞行中按武器或弹药的状态与 behaviour 拖尾，出入水面有涟漪、水花与气泡，入水后火焰拖尾变成烟、火焰状态不再附加。
 * 坐标为 Blitz 坐标。规则来自原版 projectiles.bb。
 */
import * as THREE from 'three';
import { CLS, type EntityRegistry, type EntityRecord } from './entities';
import type { ScriptEngine } from '../script/engine';
import type { World } from '../render/world';
import type { Weapons } from './weapons';
import { P, type ParticleHandle } from '../render/particles';

export const TIMEOUT_MS = 15000;
export const MAX_PITCH = 88;
/** 命中判定时给实体包围球额外加的半径。 */
const HIT_PADDING = 3;
const DEG = Math.PI / 180;
const SPIN_PER_F = 10;
const ROCKET_RANGE = 100;
const STATE_INTOXICATION = 2;

/** 拖尾种类（Cpro_*）；none 时复制弹体模型做淡出残影。 */
export type Tail = 'none' | 'smoke' | 'fire' | 'poison' | 'blood' | 'wet' | 'healing' | 'tame' | 'asmoke' | 'asparkle' | 'asupersparkle' | 'aresfade';

const STATE_TAILS: Record<string, Tail> = {
  bleeding: 'blood', intoxication: 'poison', fire: 'fire', eternalfire: 'fire', 'eternal fire': 'fire', wet: 'wet', healing: 'healing', tame: 'tame', smoke: 'smoke',
};

export interface TailStyle {
  tail: Tail;
  color: [number, number, number];
  additive: boolean;
  set: [number, number];
}

/** pro_add 的拖尾判定：先看武器状态，再看弹药状态，最后看弹药 behaviour；在水里起飞的火焰拖尾变成烟。 */
export function projectileTail(weaponState: string, ammoState: string | null, behaviour: string, inWater: boolean): TailStyle {
  const style: TailStyle = { tail: 'none', color: [0, 0, 0], additive: false, set: [0, 0] };
  const byState = (s: string) => STATE_TAILS[s.trim().toLowerCase()];
  style.tail = byState(weaponState) ?? 'none';
  if (ammoState !== null) style.tail = byState(ammoState) ?? style.tail;
  const b = behaviour.trim().toLowerCase();
  const styled = (prefix: string, tail: Tail) => {
    style.tail = tail;
    const txt = b.slice(prefix.length);
    if (!txt.startsWith(':')) return;
    const parts = txt.slice(1).split(',').map(v => Number.parseFloat(v));
    const n = (i: number) => (Number.isFinite(parts[i]) ? parts[i] : 0);
    style.color = [Math.trunc(n(0)), Math.trunc(n(1)), Math.trunc(n(2))];
    style.additive = Math.trunc(n(3)) !== 0;
    style.set = [n(4), n(5)];
  };
  if (b.startsWith('notail')) style.tail = 'none';
  else if (b.startsWith('rocket') || b.startsWith('toxicrocket')) style.tail = 'fire';
  else if (b.startsWith('poison')) style.tail = 'poison';
  else if (b.startsWith('smoke')) style.tail = 'smoke';
  else if (b.startsWith('asmoke')) styled('asmoke', 'asmoke');
  else if (b.startsWith('asparkle')) styled('asparkle', 'asparkle');
  else if (b.startsWith('asupersparkle')) {
    styled('asupersparkle', 'asupersparkle');
    if (style.set[0] <= 0) style.set[0] = 3;
  } else if (b.startsWith('aresfade')) {
    styled('aresfade', 'aresfade');
    if (style.set[0] <= 0) style.set[0] = 0.15;
    if (style.set[1] === 0) style.set[1] = 0.2;
  }
  if (style.tail === 'fire' && inWater) style.tail = 'smoke';
  return style;
}

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
  roll: number;
  object?: THREE.Object3D;
  /** 当前在水下。 */
  water: boolean;
  /** 碰过水（tpro\wc），之后火焰状态不再附加。 */
  wet: boolean;
  style: TailStyle;
  tailAcc: number;
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
  particle?(x: number, y: number, z: number, typ: number, size?: number, a?: number): ParticleHandle | null;
  /** 复制弹体模型做残影；alpha、speed 为 Cp_fadeout 参数，resfade 时按 aresfade 参数缩放淡出。 */
  ghost?(object: THREE.Object3D, kind: { fade: { alpha: number; speed: number } } | { resfade: { speed: number; grow: number; color: [number, number, number]; additive: boolean; alpha: number; scale: [number, number, number] } }): void;
  materialFx?(x: number, y: number, z: number, mat: string): void;
  sound?(file: string): void;
  explosion?(x: number, y: number, z: number, range: number, damage: number, style: number): void;
  stateImpact?(stateTyp: number, x: number, y: number, z: number): void;
  effects?(): number;
  random?(min: number, max: number): number;
}

export class Projectiles {
  readonly list: Projectile[] = [];
  private nextId = 1;

  constructor(private readonly d: ProjectileDeps) {}

  private def(typ: number) {
    return this.d.registry.defFor(CLS.item, typ);
  }

  fire(opts: FireOptions): Projectile {
    const inWater = opts.y < 0;
    const ammoState = opts.typ !== opts.weaponTyp ? this.def(opts.typ)?.weaponstate ?? '' : null;
    const style = projectileTail(this.def(opts.weaponTyp)?.weaponstate ?? '', ammoState, this.def(opts.typ)?.behaviour ?? '', inWater);
    const p: Projectile = { ...opts, id: this.nextId++, born: this.d.now(), roll: 0, water: inWater, wet: inWater, style, tailAcc: 0 };
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
      p.roll = (p.roll + SPIN_PER_F * f) % 360;
      this.water(p);
      this.tail(p, dtMs);
      const hit = this.collide(p, from);
      if (hit) {
        const rocket = this.rocket(p);
        this.d.weapons.strike({ cls: hit.cls, id: hit.id, x: hit.x, y: hit.y, z: hit.z, ground: false }, rocket ? 0 : p.damage, p.weaponTyp, p.ammoTyp, p.wet);
        this.impact(p);
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

  private rocket(p: Projectile): 'rocket' | 'toxicrocket' | null {
    const b = (this.def(p.typ)?.behaviour ?? '').trim().toLowerCase();
    return b.startsWith('rocket') ? 'rocket' : b.startsWith('toxicrocket') ? 'toxicrocket' : null;
  }

  /** 出入水面：入水涟漪、水花与 blubb 声，火焰拖尾熄成烟；水下每 20 毫秒一半机会冒泡；出水涟漪。 */
  private water(p: Projectile): void {
    const fx = this.d.particle;
    const r = (a: number, b: number) => a + Math.random() * (b - a);
    if (!p.water && p.y < 0) {
      p.water = true;
      p.wet = true;
      fx?.(p.x, 1, p.z, P.rwave, r(5, 10), r(0.9, 1.5));
      fx?.(p.x, 1, p.z, P.splash, r(15, 20), 1);
      this.d.sound?.('blubb.wav');
      if (p.style.tail === 'fire') {
        p.style.tail = 'smoke';
        this.d.sound?.('fizzle.wav');
        fx?.(p.x, p.y, p.z, P.smoke, r(3, 5), r(0.6, 0.9))?.color(240, 240, 240).additive();
      }
    } else if (p.water && p.y > 0) {
      p.water = false;
      fx?.(p.x, 1, p.z, P.rwave, r(5, 10), r(0.9, 1.5));
      this.d.sound?.('blubb.wav');
    }
  }

  /** 每 20 毫秒按拖尾种类生成粒子；特效档位 0 时没有拖尾。 */
  private tail(p: Projectile, dtMs: number): void {
    const fx = this.d.particle;
    const effects = this.d.effects?.() ?? 1;
    if (!fx || effects <= 0) return;
    p.tailAcc += dtMs;
    if (p.tailAcc < 20) return;
    p.tailAcc %= 20;
    const r = (a: number, b: number) => a + Math.random() * (b - a);
    const rand = (a: number, b: number) => this.d.random?.(a, b) ?? Math.floor(r(a, b + 1));
    const { x, y, z } = p;
    const { color, additive, set } = p.style;
    const blend = (h: ParticleHandle | null) => h?.color(...color).blend(additive ? 3 : 1);
    switch (p.style.tail) {
      case 'none':
        if (p.object) this.d.ghost?.(p.object, { fade: { alpha: 0.3, speed: effects === 1 ? 0.025 : 0.018 } });
        break;
      case 'smoke': { const h = fx(x, y, z, P.smoke, r(1, 5), r(0.6, 0.9)); if (h) h.r = 0.025; break; }
      case 'fire': {
        if (effects === 2 && rand(1, 3) === 1) fx(x, y, z, P.firespark, rand(2, 6), 1);
        const h = fx(x, y, z, P.smoke, r(3, 5), r(0.9, 1.5))?.color(255, rand(50, 255), 0).additive();
        if (h) h.r = 0.04;
        break;
      }
      case 'poison': { const h = fx(x, y, z, P.smoke, r(1, 5), r(0.9, 1.5))?.color(0, rand(150, 255), 0).additive(); if (h) h.r = 0.02; break; }
      case 'blood': fx(x, y, z, P.subsplatter, r(1, 5), r(0.9, 1.5)); break;
      case 'wet': break;
      case 'healing': fx(x, y, z, P.starflare, r(1, 5), r(0.4, 1))?.translate(r(-5, 5), r(-5, 5), r(-5, 5)).color(rand(0, 100), 255, 0); break;
      case 'tame': fx(x, y, z, P.starflare, r(1, 5), r(0.4, 1))?.translate(r(-5, 5), r(-5, 5), r(-5, 5)).color(255, 75, r(100, 200)); break;
      case 'asmoke': blend(fx(x, y, z, P.smoke, r(1, 5), r(0.6, 0.9))); break;
      case 'asparkle': { const h = blend(fx(x, y, z, P.starflare, r(1, 5), r(0.9, 1.4))); if (h) h.r = r(0.01, 0.02); break; }
      case 'asupersparkle':
        for (let i = 0; i < Math.trunc(set[0]); i++) {
          const h = blend(fx(x, y, z, P.starflare, r(1, 5), r(0.9, 1.4))?.translate(r(-5, 5), r(-5, 5), r(-5, 5)) ?? null);
          if (h) h.r = r(0.02, 0.04);
        }
        break;
      case 'aresfade':
        if (p.object) {
          const def = this.def(p.typ);
          this.d.ghost?.(p.object, { resfade: { speed: set[0], grow: set[1], color, additive, alpha: def?.alpha ?? 1, scale: def?.scale ?? [1, 1, 1] } });
        }
        break;
    }
  }

  /** 命中后：弹体材质特效、火箭爆炸、毒气火箭的绿雾与中毒、武器与弹药状态的命中特效（没被水熄灭时）。 */
  private impact(p: Projectile): void {
    const { x, y, z } = p;
    this.d.materialFx?.(x, y, z, this.def(p.typ)?.mat ?? '');
    const kind = this.rocket(p);
    const r = (a: number, b: number) => a + Math.random() * (b - a);
    const rand = (a: number, b: number) => this.d.random?.(a, b) ?? Math.floor(r(a, b + 1));
    if (kind === 'rocket') {
      this.d.explosion?.(x, y, z, ROCKET_RANGE, p.damage, 1);
    } else if (kind === 'toxicrocket') {
      const fx = this.d.particle;
      for (let i = 0; i < 3; i++) fx?.(x, y, z, P.explode, r(2, 5), r(1, 1.5))?.color(0, rand(150, 255), 0);
      for (let i = 0, n = rand(3, 5); i <= n; i++) fx?.(x, y, z, P.spark, rand(1, 2), 3)?.color(0, 255, 0);
      fx?.(x, y, z, P.smoke, r(3, 5), r(1, 1.5))?.color(0, rand(150, 255), 0).additive();
      this.d.sound?.(`explode${rand(1, 4)}.wav`);
      this.d.explosion?.(x, y, z, ROCKET_RANGE, p.damage, 0);
      for (const u of this.d.registry.all(CLS.unit)) {
        if (!u.dead && Math.hypot(u.x - x, u.y - y, u.z - z) < ROCKET_RANGE) this.d.engine.stateRules.set(CLS.unit, u.id, STATE_INTOXICATION);
      }
    }
    for (const typ of p.typ === p.weaponTyp ? [p.weaponTyp] : [p.weaponTyp, p.typ]) {
      const state = this.def(typ)?.weaponstate;
      if (!state) continue;
      const st = this.d.engine.stateType(state);
      if (st > 0 && !(p.wet && (st === 4))) this.d.stateImpact?.(st, x, y, z);
    }
  }

  private land(p: Projectile): void {
    p.y = this.d.terrainY(p.x, p.z);
    const rocket = this.rocket(p);
    const skip = this.d.weapons.strike({ cls: 0, id: 0, x: p.x, y: p.y, z: p.z, ground: true }, rocket ? 0 : p.damage, p.weaponTyp, p.ammoTyp, p.wet);
    this.impact(p);
    const beh = (this.def(p.typ)?.behaviour ?? '').trim().toLowerCase();
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
    p.object.rotation.set(-p.pitch * DEG, p.yaw * DEG, p.roll * DEG, 'YXZ');
  }

  private remove(p: Projectile): void {
    const i = this.list.indexOf(p);
    if (i >= 0) this.list.splice(i, 1);
    if (p.object) this.d.world.group.remove(p.object);
  }
}
