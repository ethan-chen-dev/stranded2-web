/**
 * 状态的规则与每帧效果，依据 handle_states.bb：set_state（叠加强度、火与潮湿互相抵消、雨雪/耐火材质/水下不能起火、
 * 火焰与电击挂点光源）、free_state、update_state（流血、中毒、燃烧、冻伤、骨折、电击按 5 秒扣血，治疗每秒回血，
 * 火焰蔓延，各状态的粒子、光源与画面效果）以及 state_impactfx。
 * 计时沿用原版 in_gtXgo：按游戏时间每 X 毫秒触发一次。
 */
import { CLS, type EntityRecord } from './entities';
import type { ScriptEngine, StateRecord } from '../script/engine';
import { P, type ParticleHandle } from '../render/particles';

export const ST = {
  bleeding: 1, intoxication: 2, pus: 3, fire: 4, eternalfire: 5, frostbite: 6, fracture: 7, electroshock: 8,
  bloodrush: 9, dizzy: 10, wet: 11, fuddle: 12, healing: 16, invulnerability: 17, tame: 18,
  flare: 22, smoke: 23, light: 24, particles: 25, ghost: 55,
} as const;

/** load_materials.bb 的 Dmat_nofire：这些材质不会着火。 */
const NOFIRE_MATERIALS = new Set(['stone', 'dirt', 'dust', 'metal', 'water', 'glass']);
/** incam：离镜头水平 500 以内才生成状态粒子。 */
const INCAM_RANGE = 500;
const FIRE_SOUND_RANGE = 100;
const BASE_POWER = 3;
const GHOST_RANGE = 75;

export interface StatePosition {
  x: number;
  y: number;
  z: number;
  /** 实体高度加 state 偏移（tmp_ry），低于 0 时火焰熄灭。 */
  baseY: number;
}

/** 点光源的创建、更新与移除由渲染层实现。 */
export interface StateLight {
  set(x: number, y: number, z: number, color: [number, number, number], range: number): void;
  visible(on: boolean): void;
  dispose(): void;
}

export interface StateDeps {
  engine: ScriptEngine;
  playerId: number;
  get(cls: number, id: number): EntityRecord | undefined;
  material(cls: number, id: number): string;
  /** parent_statepos：有 state 偏移时取实体位置加偏移，否则取模型上随机顶点。 */
  position(cls: number, id: number): StatePosition | null;
  /** parent_stateposstatic：有固定偏移（光源只在这时挂上）。 */
  staticPosition(cls: number, id: number): boolean;
  camera(): { x: number; y: number; z: number };
  particle(x: number, y: number, z: number, typ: number, size?: number, a?: number): ParticleHandle | null;
  sound(file: string, at?: { x: number; y: number; z: number }): void;
  /** 每个燃烧实体一条循环火声，null 停止。 */
  loop(key: string, file: string | null): void;
  /** ha_damage：返回 true 表示实体因此死亡。 */
  damage(cls: number, id: number, amount: number): boolean;
  heal(cls: number, id: number, amount: number): void;
  createLight(): StateLight;
  blocksFire(): boolean;
  /** 火焰蔓延：离 (x, z) 不超过 range 的物体。 */
  objectsNear(x: number, z: number, range: number): EntityRecord[];
  fireRange: number;
  fireLightSize: number;
  fireLightBrightness: number;
  /** 读档时状态按存档原样恢复，不受添加规则限制。 */
  restoring(): boolean;
  /** incam 与光源可见距离按视距系数 set_viewfac 放大。 */
  viewFac: number;
  /** 玩家的动态模糊覆盖值（mb_override），0 为不覆盖；dizzy 时左右反转。 */
  playerBlur(amount: number, invertX: boolean): void;
  /** 建成后的幽灵状态解除时恢复碰撞。 */
  restoreCollision(id: number): void;
  random(min: number, max: number): number;
  rnd(min: number, max: number): number;
}

interface Extra {
  light?: StateLight;
}

export class StateEffects {
  private readonly extra = new WeakMap<StateRecord, Extra>();
  private readonly acc = new Map<number, number>();

  constructor(private readonly d: StateDeps) {
    d.engine.states.veto = (cls, id, typ) => !d.restoring() && !this.allowed(cls, id, typ);
    d.engine.stateRules = { set: (cls, id, typ) => this.set(cls, id, typ), free: (cls, id, typ) => this.free(cls, id, typ) };
  }

  /** 读档后给需要光源的状态挂上光源。 */
  restoreLights(): void {
    for (const r of this.states.records) {
      if (this.extra.has(r)) continue;
      if ((r.typ === ST.fire || r.typ === ST.eternalfire) && this.d.staticPosition(r.cls, r.id)) this.attachLight(r, [255, 255, 0], 50);
      else if (r.typ === ST.electroshock) this.attachLight(r, [0, 0, 255], 75);
      else if (r.typ === ST.light) this.attachLight(r, r.color ?? [255, 255, 255], r.size ?? 10);
    }
  }

  private get states() {
    return this.d.engine.states;
  }

  private power(rec: StateRecord): number {
    return Number(rec.value) || 0;
  }

  /** set_state 里不改动其他状态的否决条件：雨雪、耐火材质、水下。 */
  private allowed(cls: number, id: number, typ: number): boolean {
    if (typ !== ST.fire) return true;
    if (this.d.blocksFire()) return false;
    if (NOFIRE_MATERIALS.has(this.d.material(cls, id))) return false;
    const rec = this.d.get(cls, id);
    return !rec || rec.y >= 0;
  }

  /**
   * set_state：同类状态先释放并把强度累加到新状态（基础 3）；火与潮湿互相抵消，抵消时嘶声冒白烟；
   * 永恒之火遇潮湿只冒烟。返回是否添加成功。
   */
  set(cls: number, id: number, typ: number): boolean {
    let carried = 0;
    for (const old of this.states.records.filter(r => r.cls === cls && r.id === id && r.typ === typ)) {
      carried += this.power(old);
      this.free(cls, id, typ);
    }
    if (!this.allowed(cls, id, typ)) return false;
    let power = BASE_POWER + carried;
    if (typ === ST.fire || typ === ST.wet) {
      const other = this.states.find(cls, id, typ === ST.fire ? ST.wet : ST.fire);
      if (other) {
        const otherPower = this.power(other);
        other.value = String(otherPower - power);
        if (otherPower - power <= 0) this.free(cls, id, other.typ);
        power -= otherPower;
        this.fizzle(cls, id, 1);
        if (power <= 0) return false;
      }
    }
    if (typ === ST.wet && this.states.has(cls, id, ST.eternalfire)) this.fizzle(cls, id, 3);
    if (typ === ST.eternalfire) {
      power -= BASE_POWER;
      if (this.states.has(cls, id, ST.wet)) {
        this.free(cls, id, ST.wet);
        this.fizzle(cls, id, 3);
      }
    }
    if (typ === ST.bloodrush) power = 2;
    const rec = this.states.add(cls, id, typ);
    if (!this.states.records.includes(rec)) return false;
    rec.value = String(power);
    if ((typ === ST.fire || typ === ST.eternalfire) && this.d.staticPosition(cls, id)) this.attachLight(rec, [255, 255, 0], 50);
    if (typ === ST.electroshock) this.attachLight(rec, [0, 0, 255], 75);
    if (typ === ST.light) {
      rec.color = rec.color ?? [255, 255, 255];
      rec.size = rec.size ?? 10;
      this.attachLight(rec, rec.color, rec.size);
    }
    if (typ === ST.flare) {
      rec.color = rec.color ?? [255, 255, 255];
      rec.size = rec.size ?? 50;
    }
    this.d.engine.entityEvent(cls, id, 'addstate', String(typ));
    return true;
  }

  /** free_state：释放光源并触发 freestate。 */
  free(cls: number, id: number, typ?: number): number {
    const removed = this.states.free(cls, id, typ);
    for (const r of removed) {
      this.release(r);
      this.d.engine.entityEvent(cls, id, 'freestate', String(r.typ));
    }
    return removed.length;
  }

  /** 实体被删除时清理它的全部状态资源。 */
  freeAll(cls: number, id: number): void {
    for (const r of this.states.free(cls, id)) this.release(r);
  }

  /** 雨雪熄灭全部火焰（e_environment_setweather）。 */
  clearFire(): void {
    for (const r of this.states.records.filter(s => s.typ === ST.fire)) this.free(r.cls, r.id, ST.fire);
  }

  /** state_impactfx：武器或投射物附带状态命中时的特效。 */
  impact(typ: number, x: number, y: number, z: number): void {
    const { d } = this;
    if (typ === ST.intoxication) {
      for (let i = 0, n = d.random(3, 5); i <= n; i++) d.particle(x, y, z, P.spark, d.random(1, 2), 3)?.color(0, 255, 0);
      d.particle(x, y, z, P.smoke, d.rnd(8, 14), d.rnd(1, 1.5))?.color(0, d.random(150, 255), 0).additive();
    } else if (typ === ST.fire || typ === ST.eternalfire) {
      d.particle(x, y, z, P.flames, 5, 1);
      for (let i = 0, n = d.random(3, 5); i <= n; i++) d.particle(x, y, z, P.firespark, d.random(2, 6), 1);
      for (let i = 0, n = d.random(3, 5); i <= n; i++) d.particle(x, y, z, P.spark, d.random(1, 2), 3);
    }
  }

  private release(r: StateRecord): void {
    const ex = this.extra.get(r);
    ex?.light?.dispose();
    this.extra.delete(r);
    if (r.typ === ST.fire || r.typ === ST.eternalfire) this.d.loop(fireKey(r), null);
    if (r.typ === ST.ghost && r.cls === CLS.object) this.d.restoreCollision(r.id);
  }

  private attachLight(rec: StateRecord, color: [number, number, number], range: number): void {
    const light = this.d.createLight();
    const pos = this.d.position(rec.cls, rec.id);
    if (pos) light.set(pos.x, pos.y, pos.z, color, range);
    this.extra.set(rec, { light });
  }

  private fizzle(cls: number, id: number, puffs: number): void {
    const rec = this.d.get(cls, id);
    if (!rec) return;
    this.d.sound('fizzle.wav', rec);
    for (let i = 0; i < puffs; i++) {
      const j = puffs > 1 ? 5 : 0;
      this.d.particle(rec.x + this.d.rnd(-j, j), rec.y + this.d.rnd(-j, j), rec.z + this.d.rnd(-j, j), P.smoke, this.d.rnd(3, 5), this.d.rnd(0.6, 0.9))
        ?.color(240, 240, 240).additive();
    }
  }

  private tick(period: number, gameMs: number, dtMs: number): boolean {
    return Math.floor(gameMs / period) !== Math.floor((gameMs - dtMs) / period);
  }

  /** update_state：每帧调用；gameMs 为游戏时间。 */
  update(dtMs: number, gameMs: number): void {
    const { d } = this;
    const t = (p: number) => this.tick(p, gameMs, dtMs);
    const go50 = t(50), go100 = t(100), go500 = t(500), go1000 = t(1000), go5000 = t(5000);
    const cam = d.camera();
    const incam = (x: number, z: number) => Math.hypot(x - cam.x, z - cam.z) < INCAM_RANGE * d.viewFac;
    let blur = 0;
    let invert = false;
    for (const s of this.states.records.slice()) {
      if (!this.states.records.includes(s)) continue;
      const self = s.cls === CLS.unit && s.id === d.playerId;
      const power = this.power(s);
      const pos = () => d.position(s.cls, s.id);
      switch (s.typ) {
        case ST.bleeding: {
          if (go500) { const p = pos(); if (p && incam(p.x, p.z)) for (let i = 0; i < 3; i++) d.particle(p.x, p.y, p.z, P.splatter, d.rnd(1, 5), d.rnd(0.9, 1.5)); }
          if (go5000 && power) d.damage(s.cls, s.id, power);
          break;
        }
        case ST.intoxication: {
          if (go500) { const p = pos(); if (p && incam(p.x, p.z)) d.particle(p.x, p.y, p.z, P.smoke, d.rnd(1, 5), d.rnd(0.9, 1.5))?.color(d.random(0, 255), d.random(150, 255), 0).additive(); }
          if (go5000 && power) d.damage(s.cls, s.id, power);
          break;
        }
        case ST.fire:
        case ST.eternalfire:
          this.updateFire(s, power, { go50, go100, go5000 }, cam, incam);
          break;
        case ST.frostbite:
        case ST.fracture:
          if (go5000 && power) d.damage(s.cls, s.id, power);
          break;
        case ST.electroshock: {
          const light = this.extra.get(s)?.light;
          if (go50 && light) {
            const p = pos();
            if (p) {
              light.set(p.x, p.y, p.z, [50, 50, d.random(150, 200)], d.rnd(50, 100));
              const dist = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z);
              light.visible(dist < 100 * d.viewFac + 300);
              if (dist < 500 && incam(p.x, p.z)) {
                if (d.random(1, 2) === 1) d.particle(p.x, p.y, p.z, P.spark, d.random(1, 2), 1)?.color(255, 255, 150);
                if (d.random(1, 4) === 1) d.sound(`spark${d.random(1, 4)}.wav`, p);
              }
            }
          }
          if (go5000 && power) d.damage(s.cls, s.id, power);
          break;
        }
        case ST.bloodrush:
          if (go50) { const p = pos(); if (p && incam(p.x, p.z)) d.particle(p.x + d.rnd(-5, 5), p.y + d.rnd(0, 5), p.z + d.rnd(-5, 5), P.starflare, d.rnd(1, 5), d.rnd(0.4, 1))?.color(255, d.random(0, 100), 0); }
          if (self) blur = Math.max(blur, 0.4);
          break;
        case ST.dizzy:
          if (self) { blur = Math.max(blur, 0.75); invert = true; }
          break;
        case ST.wet:
          if (go500) { const p = pos(); if (p && incam(p.x, p.z)) d.particle(p.x, p.y, p.z, P.spark, d.random(1, 2), 3)?.color(d.random(230, 240), d.random(230, 240), 255); }
          break;
        case ST.fuddle:
          if (go500 && power >= 10) d.particle(0, 0, 0, P.fade, d.rnd(0.03, 0.05), d.rnd(0.4, 0.6))?.color(d.random(0, 255), d.random(0, 255), d.random(0, 255)).additive();
          if (self) blur = Math.max(blur, 0.9);
          break;
        case ST.healing:
          if (go50) { const p = pos(); if (p && incam(p.x, p.z)) d.particle(p.x + d.rnd(-5, 5), p.y + d.rnd(0, 5), p.z + d.rnd(-5, 5), P.starflare, d.rnd(1, 5), d.rnd(0.4, 1))?.color(d.random(0, 100), 255, 0); }
          if (go1000 && power) d.heal(s.cls, s.id, power);
          break;
        case ST.tame:
          if (go100) { const p = pos(); if (p && incam(p.x, p.z)) d.particle(p.x + d.rnd(-5, 5), p.y + d.rnd(0, 5), p.z + d.rnd(-5, 5), P.starflare, d.rnd(1, 5), d.rnd(0.4, 1))?.color(255, 75, d.random(100, 200)); }
          break;
        case ST.smoke:
          if (go500) { const p = pos(); if (p && incam(p.x, p.z)) d.particle(p.x, p.y, p.z, P.smoke, d.rnd(1, 5), d.rnd(0.9, 2.4)); }
          break;
        case ST.light: {
          const light = this.extra.get(s)?.light;
          const p = pos();
          if (light && p) {
            light.set(p.x, p.y, p.z, s.color ?? [255, 255, 255], s.size ?? 10);
            light.visible(Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z) < 300 * d.viewFac + 300);
          }
          break;
        }
        case ST.particles:
          if (go50) {
            const p = pos();
            if (p && incam(p.x, p.z)) {
              const h = d.particle(p.x + d.rnd(-3, 3), p.y + d.rnd(-3, 3), p.z + d.rnd(-3, 3), P.starflare, d.rnd(1, 5), d.rnd(0.9, 2.4));
              if (s.color) h?.color(...s.color);
            }
          }
          break;
        case ST.ghost:
          if (go50 && s.cls === CLS.object) {
            const o = d.get(CLS.object, s.id);
            if (o && Math.hypot(o.x - cam.x, o.y - cam.y, o.z - cam.z) > GHOST_RANGE) this.free(CLS.object, s.id, ST.ghost);
          }
          break;
        default:
          break;
      }
    }
    d.playerBlur(blur, invert);
  }

  /** 燃烧与永恒之火：火焰粒子、火声、闪烁的火光；燃烧还会伤害、烧毁后蔓延、落水熄灭。 */
  private updateFire(s: StateRecord, power: number, go: { go50: boolean; go100: boolean; go5000: boolean },
    cam: { x: number; y: number; z: number }, incam: (x: number, z: number) => boolean): void {
    const { d } = this;
    const p = d.position(s.cls, s.id);
    if (!p) return;
    if (go.go100 && incam(p.x, p.z)) {
      d.particle(p.x, p.y, p.z, P.flames, 5, 1);
      if (d.random(1, 5) === 1) d.particle(p.x, p.y, p.z, P.firespark, d.random(2, 6), 1);
      if (go.go5000) d.particle(p.x, p.y, p.z, P.spark, d.random(1, 2), 3);
    }
    const owner = d.get(s.cls, s.id);
    const near = owner ? Math.hypot(owner.x - cam.x, owner.y - cam.y, owner.z - cam.z) < FIRE_SOUND_RANGE : false;
    d.loop(fireKey(s), near ? 'fire.wav' : null);
    const light = this.extra.get(s)?.light;
    if (go.go50 && light) {
      const b = d.fireLightBrightness;
      light.set(p.x, p.y, p.z, [b, d.rnd(b - 50, b), 0], Math.max(0, d.fireLightSize + d.rnd(-5, 5)));
      light.visible(Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z) < 300 * d.viewFac + 300);
    }
    if (go.go5000 && power) {
      const killed = d.damage(s.cls, s.id, power);
      if (killed && s.typ === ST.fire) {
        for (const o of d.objectsNear(p.x, p.z, d.fireRange)) if (!(o.cls === s.cls && o.id === s.id)) this.set(CLS.object, o.id, ST.fire);
        return;
      }
    }
    if (s.typ === ST.fire && go.go50 && p.baseY < 0) {
      this.fizzle(s.cls, s.id, 1);
      this.free(s.cls, s.id, ST.fire);
    }
  }
}

function fireKey(s: StateRecord): string {
  return `fire:${s.cls}:${s.id}`;
}
