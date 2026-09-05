/**
 * 单位 AI：行为码、模式状态机、移动、ai_check、物理、受击反应与信号。
 * 规则来自原版 ai_units.bb 与 ai/*.bb；坐标为 Blitz 坐标，速度按每 f 换算（f = 毫秒/20）。
 */
import { CLS, type EntityRegistry, type EntityRecord } from './entities';
import type { EntityDef } from '../formats/inf';
import type { ScriptEngine } from '../script/engine';
import type { World } from '../render/world';

export const AI = {
  none: 0, idle: 50, move: 51, movel: 52, mover: 53, turnl: 54, turnr: 55, rise: 60, fall: 61,
  ret: 101, sret: 102, attack: 103, hunt: 104, movetarget: 150, getfood: 151, flee: 152, sani: 155,
} as const;
/** 大于此值的模式为高级模式，ai_check 不会用追击打断。 */
export const SUPERIOR = 149;
/** ai_check 的执行间隔。 */
export const CHECK_INTERVAL_MS = 50;
/** 没有攻击动画时攻击模式的持续时间。 */
const ATTACK_FALLBACK_MS = 800;
const GRAVITY_PER_F = 9.81 * 0.6;
const DEG = Math.PI / 180;

const CODES: Record<string, number> = {
  player: 0, normal: 1, animal: 1, raptor: 2, predator: 2, standandsnap: 3, idle: 4, idleturn: 5, standandshoot: 6,
  monkey: 7, shy: 8, plague: 9, landbird: 10, crab: 200, amphibian: 201, fish: 300, circlingfish: 301,
  predatorfish: 302, deepseafish: 303, bird: 400, circlingbird: 401, predatorbird: 402, flyinginsect: 404,
  highbird: 405, lowbird: 406, landskybird: 407, killerbird: 408, vehicle: 500, watercraft: 501, aircraft: 502,
};
const MODE_NAMES: Record<string, number> = {
  idle: AI.idle, move: AI.move, movel: AI.movel, mover: AI.mover, turnl: AI.turnl, turnr: AI.turnr,
  rise: AI.rise, fall: AI.fall, return: AI.ret, sreturn: AI.sret, attack: AI.attack, hunt: AI.hunt,
  movetarget: AI.movetarget, attract: AI.movetarget, goto: AI.movetarget,
  getfood: AI.getfood, food: AI.getfood, eat: AI.getfood,
  flee: AI.flee, distract: AI.flee, sani: AI.sani,
};

const AGGRESSIVE = new Set([2, 3, 6, 302, 402, 408]);
const SHY = new Set([8, 10, 300, 303, 400, 404, 405, 406]);
const STATIONARY = new Set([3, 4, 5, 6]);
const CIRCLING = new Set([301, 401]);
const FREE_HEIGHT = new Set([407, 408]);
const EATERS = new Set([1, 2, 7, 8, 9, 200, 201, 300, 302, 303]);
const FLEE_ON_HURT = new Set([1, 7, 200, 201, 300, 303, 404]);
const HUNT_ON_HURT = new Set([2, 302]);
const LAND_CHECK = new Set([1, 2, 7, 8, 9, 10]);
const WATER_CHECK = new Set([300, 301, 302, 303]);
const NO_CENTER_CHECK = new Set([3, 4, 5, 6]);
const AIR_OFFSET: Record<number, number> = { 400: 350, 401: 350, 404: 20, 405: 500, 406: 180, 407: 210, 408: 400 };

export function behaviourCode(name: string): number {
  return CODES[name.trim().toLowerCase()] ?? 0;
}

export function isAggressive(code: number): boolean {
  return AGGRESSIVE.has(code);
}

export function modeByName(name: string): number {
  return MODE_NAMES[name.trim().toLowerCase()] ?? 0;
}

/** 0 不做物理，1 陆地，2 水中，3 空中，6 陆地鸟（逃跑时飞起）。 */
export type PhysicsMode = 0 | 1 | 2 | 3 | 6;

export function physicsMode(code: number): PhysicsMode {
  if (code <= 0 || code > 500) return 0;
  if (code === 500) return 1;
  if (code === 10) return 6;
  if (code < 300) return 1;
  if (code < 400) return 2;
  return 3;
}

export interface UnitAiState {
  mode: number;
  /** 模式开始的游戏时间。 */
  timer: number;
  duration: number;
  centerX: number;
  centerZ: number;
  targetCls: number;
  targetId: number;
  lastCheck: number;
  /** ai_stay：固定 idle，不再切换模式。 */
  freeze: boolean;
  /** 当前非循环动画结束的游戏时间。 */
  animUntil: number;
}

export interface AiPlayer {
  x: number;
  y: number;
  z: number;
  alive: boolean;
  /** 视线在水下。 */
  underwater: boolean;
}

export interface AiDeps {
  registry: EntityRegistry;
  engine: ScriptEngine;
  world: World;
  playerId: number;
  player(): AiPlayer;
  terrainY(x: number, z: number): number;
  /** 沿 (dx, dz) 移动会撞上物体。 */
  blocked(rec: EntityRecord, dx: number, dz: number): boolean;
  damagePlayer(amount: number, by: EntityRecord): void;
  damageEntity(cls: number, id: number, amount: number): void;
  random(min: number, max: number): number;
}

function wrapDeg(d: number): number {
  return ((d + 180) % 360 + 360) % 360 - 180;
}

/** 面向 (dx, dz) 所需的 yaw；原版前进方向为 (-sin yaw, cos yaw)。 */
function yawTo(dx: number, dz: number): number {
  return Math.atan2(-dx, dz) / DEG;
}

function animMs(def: EntityDef | undefined, name: string): number {
  const range = def?.anims.get(name);
  if (!range || range.speed <= 0) return 0;
  return ((range.end - range.start + 1) / (range.speed * 50)) * 1000;
}

export class AiSystem {
  /** 最近一次触发 ai_eat 的单位 id。 */
  lastEater = 0;
  private now = 0;

  constructor(private readonly d: AiDeps) {}

  code(rec: EntityRecord): number {
    return behaviourCode(rec.def?.behaviour ?? '');
  }

  init(rec: EntityRecord): UnitAiState {
    const st: UnitAiState = {
      mode: AI.none, timer: 0, duration: 0, centerX: rec.x, centerZ: rec.z,
      targetCls: 0, targetId: 0, lastCheck: 0, freeze: false, animUntil: 0,
    };
    rec.ai = st;
    const code = this.code(rec);
    const pm = physicsMode(code);
    if (CIRCLING.has(code)) this.setMode(rec, this.d.random(1, 2) === 1 ? AI.movel : AI.mover);
    else if ((pm === 2 || pm === 3) && !FREE_HEIGHT.has(code)) this.setMode(rec, [AI.move, AI.movel, AI.mover][this.d.random(0, 2)]);
    else this.setMode(rec, AI.idle);
    return st;
  }

  setMode(rec: EntityRecord, mode: number, durationMs?: number, targetCls = 0, targetId = 0, now = this.now): void {
    const st = rec.ai ?? this.init(rec);
    if (st.freeze) mode = AI.idle;
    st.mode = mode;
    st.timer = now;
    st.duration = durationMs ?? this.d.random(1500, 3500);
    st.targetCls = targetCls;
    st.targetId = targetId;
    this.animate(rec, mode, now);
  }

  private animate(rec: EntityRecord, mode: number, now: number): void {
    const def = rec.def;
    const st = rec.ai!;
    if (mode === AI.idle) {
      const names = ['idle1', 'idle2', 'idle3'].filter(n => def?.anims.has(n));
      if (names.length === 0) { st.animUntil = now; return; }
      const name = names[this.d.random(0, names.length - 1)];
      rec.playAnim?.(name, false);
      st.animUntil = now + animMs(def, name);
      this.d.engine.entityEvent(CLS.unit, rec.id, `ai_${name}`);
    } else if (mode === AI.attack) {
      const ok = rec.playAnim?.('attack', false) ?? false;
      st.animUntil = now + (ok ? animMs(def, 'attack') || ATTACK_FALLBACK_MS : ATTACK_FALLBACK_MS);
    } else if (mode !== AI.sani && mode !== AI.none) {
      rec.playAnim?.('move', def?.loopmoveani ? true : 'pingpong');
      st.animUntil = now;
    }
  }

  update(dtMs: number, now: number): void {
    this.now = now;
    const f = dtMs / 20;
    for (const rec of this.d.registry.all(CLS.unit)) {
      if (rec.id === this.d.playerId) continue;
      const code = this.code(rec);
      if (code === 0 || code > 500) continue;
      if (rec.dead) { this.deadPhysics(rec, code, f); this.d.world.sync(rec); continue; }
      const st = rec.ai ?? this.init(rec);
      this.runMode(rec, st, code, f, now);
      if (!st.freeze && st.mode !== AI.attack && now - st.timer > st.duration) this.next(rec, st, code, now);
      if (now - st.lastCheck >= CHECK_INTERVAL_MS) { st.lastCheck = now; this.check(rec, now); }
      this.physics(rec, st, code, f);
      this.d.world.sync(rec);
    }
  }

  // ---- 模式执行 ----

  private runMode(rec: EntityRecord, st: UnitAiState, code: number, f: number, now: number): void {
    const def = rec.def!;
    const speed = def.speed * f;
    const turn = def.turnspeed * f;
    switch (st.mode) {
      case AI.idle:
        if (now < st.animUntil) st.timer = now;
        if (code === 5) this.faceEntity(rec, this.d.player(), 10, f);
        if (FREE_HEIGHT.has(code)) {
          const p = this.d.player();
          if (p.alive && this.dist2(rec, p) < 100) this.setMode(rec, AI.rise, 3000);
        }
        break;
      case AI.move: this.advance(rec, code, speed); break;
      case AI.movel: this.advance(rec, code, speed); rec.yaw += turn; break;
      case AI.mover: this.advance(rec, code, speed); rec.yaw -= turn; break;
      case AI.turnl: rec.yaw += turn; break;
      case AI.turnr: rec.yaw -= turn; break;
      case AI.rise:
        rec.pitch = -35;
        this.advance(rec, code, speed);
        rec.yaw += turn;
        break;
      case AI.fall:
        rec.pitch = 35;
        this.advance(rec, code, speed);
        break;
      case AI.ret:
      case AI.sret: {
        rec.pitch = 0;
        this.turnToward(rec, st.centerX, st.centerZ, st.mode === AI.sret ? 2 : 30, f);
        this.advance(rec, code, speed);
        if (Math.hypot(rec.x - st.centerX, rec.z - st.centerZ) < 75) this.expire(st);
        break;
      }
      case AI.hunt: {
        const p = this.d.player();
        if (!p.alive || this.dist2(rec, p) < def.attackrange / 2) { this.expire(st); break; }
        this.turnToward(rec, p.x, p.z, 5, f);
        this.advance(rec, code, speed);
        if (physicsMode(code) === 2 && Math.abs(p.y - rec.y) > 20) rec.y += Math.sign(p.y - rec.y) * speed / 3;
        break;
      }
      case AI.attack: {
        const p = this.d.player();
        this.turnToward(rec, p.x, p.z, 2, f);
        if (now >= st.animUntil) {
          st.mode = AI.none;
          this.check(rec, now);
          if (st.mode === AI.none) this.setMode(rec, AI.idle);
        }
        break;
      }
      case AI.movetarget: {
        const t = this.target(st);
        if (!t) { this.expire(st); break; }
        if (this.dist2(rec, t) < 10) { this.expire(st); break; }
        this.turnToward(rec, t.x, t.z, 5, f);
        this.advance(rec, code, speed);
        break;
      }
      case AI.getfood: this.getFood(rec, st, code, f, speed, now); break;
      case AI.flee: {
        const t = st.targetCls === CLS.unit && st.targetId === this.d.playerId ? this.d.player() : this.target(st);
        if (!t) { this.expire(st); break; }
        const away = wrapDeg(yawTo(t.x - rec.x, t.z - rec.z) + 180);
        this.turnBy(rec, wrapDeg(away - rec.yaw), 10, f);
        if (code === 10) { this.advance(rec, code, speed * 4); rec.y += speed; }
        else this.advance(rec, code, speed);
        if (this.dist2(rec, t) > 50 && st.timer + st.duration - now > 3000) st.timer = now - st.duration + 3000;
        break;
      }
      case AI.sani:
        if (now >= st.animUntil) this.expire(st);
        break;
      default:
        break;
    }
  }

  private expire(st: UnitAiState): void {
    st.timer = -st.duration - 1;
  }

  private target(st: UnitAiState): EntityRecord | undefined {
    if (!st.targetCls && !st.targetId) return undefined;
    const t = this.d.registry.get(st.targetCls, st.targetId);
    return t && !t.dead ? t : undefined;
  }

  private dist2(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  private dist3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  /** 原版每帧转 DeltaYaw/(delay·f)，按 f=1 换算为每帧转差值的 1/delay。 */
  private turnBy(rec: EntityRecord, delta: number, delay: number, f: number): void {
    rec.yaw = wrapDeg(rec.yaw + delta * Math.min(f / delay, 1));
  }

  private turnToward(rec: EntityRecord, x: number, z: number, delay: number, f: number): void {
    this.turnBy(rec, wrapDeg(yawTo(x - rec.x, z - rec.z) - rec.yaw), delay, f);
  }

  private faceEntity(rec: EntityRecord, t: { x: number; z: number }, delay: number, f: number): void {
    this.turnToward(rec, t.x, t.z, delay, f);
  }

  /** 沿自身朝向前进；螃蟹横向移动，水中与空中单位带 pitch。 */
  private advance(rec: EntityRecord, code: number, dist: number): void {
    if (dist === 0) return;
    const yaw = rec.yaw * DEG;
    const pm = physicsMode(code);
    let dx: number;
    let dz: number;
    let dy = 0;
    if (code === 200) {
      dx = Math.cos(yaw) * dist;
      dz = Math.sin(yaw) * dist;
    } else if (pm === 2 || pm === 3) {
      const pitch = rec.pitch * DEG;
      dx = -Math.sin(yaw) * Math.cos(pitch) * dist;
      dz = Math.cos(yaw) * Math.cos(pitch) * dist;
      dy = -Math.sin(pitch) * dist;
    } else {
      dx = -Math.sin(yaw) * dist;
      dz = Math.cos(yaw) * dist;
    }
    if ((pm === 1 || pm === 6) && this.d.blocked(rec, dx, dz)) {
      this.setMode(rec, this.d.random(1, 2) === 1 ? AI.turnl : AI.turnr, 500);
      return;
    }
    rec.x += dx;
    rec.y += dy;
    rec.z += dz;
  }

  private getFood(rec: EntityRecord, st: UnitAiState, code: number, f: number, speed: number, now: number): void {
    const t = this.target(st);
    if (!t) { this.expire(st); return; }
    if (this.dist2(rec, t) > 30) {
      this.turnToward(rec, t.x, t.z, 5, f);
      this.advance(rec, code, speed);
      return;
    }
    if (now < st.animUntil) return;
    const def = rec.def!;
    this.lastEater = rec.id;
    const r = this.d.engine.runNow(t.cls, t.id, 'ai_eat');
    if (r.skipevent) { this.expire(st); return; }
    const ok = rec.playAnim?.('attack', false) ?? false;
    st.animUntil = now + (ok ? animMs(def, 'attack') || ATTACK_FALLBACK_MS : ATTACK_FALLBACK_MS);
    if (t.cls === CLS.info) this.d.registry.remove(t.cls, t.id);
    else if (t.cls === CLS.unit) this.d.damageEntity(t.cls, t.id, t.health);
    else this.d.damageEntity(t.cls, t.id, Math.max(def.damage, 1));
    if (this.target(st)) { st.timer = now; st.duration = 20000; }
    else this.expire(st);
  }

  // ---- 模式调度 ----

  private next(rec: EntityRecord, st: UnitAiState, code: number, now: number): void {
    const r = (n: number): number => this.d.random(0, n);
    if (STATIONARY.has(code)) { this.setMode(rec, AI.idle, undefined, 0, 0, now); return; }
    if (CIRCLING.has(code)) { this.setMode(rec, st.mode === AI.movel ? AI.mover : AI.movel, undefined, 0, 0, now); return; }
    if (FREE_HEIGHT.has(code)) {
      const onGround = rec.y <= this.d.terrainY(rec.x, rec.z) + rec.def!.colyr + 1;
      if (onGround) { this.setMode(rec, r(4) === 0 ? AI.rise : AI.idle, undefined, 0, 0, now); return; }
      const n = r(7);
      this.setMode(rec, n <= 1 ? AI.move : n <= 4 ? AI.movel : n <= 6 ? AI.mover : AI.fall, n === 7 ? 20000 : undefined, 0, 0, now);
      return;
    }
    if (code === 200) {
      const n = r(10);
      this.setMode(rec, n <= 2 ? AI.move : n <= 4 ? AI.movel : n <= 6 ? AI.mover : n === 7 ? AI.turnl : n === 8 ? AI.turnr : AI.idle, undefined, 0, 0, now);
      return;
    }
    const pm = physicsMode(code);
    if (pm === 2 || pm === 3) {
      const n = r(7);
      this.setMode(rec, n <= 1 ? AI.move : n <= 4 ? AI.movel : AI.mover, undefined, 0, 0, now);
      return;
    }
    const n = r(code === 2 ? 11 : 15);
    this.setMode(rec, n <= 3 ? AI.move : n <= 6 ? AI.movel : n <= 9 ? AI.mover : AI.idle, undefined, 0, 0, now);
  }

  // ---- ai_check ----

  check(rec: EntityRecord, now: number): void {
    const st = rec.ai ?? this.init(rec);
    const code = this.code(rec);
    const def = rec.def!;
    if (st.mode === AI.attack || st.freeze) return;
    if (LAND_CHECK.has(code) && rec.y < 0 && st.mode !== AI.sret) { this.setMode(rec, AI.sret, 10000, 0, 0, now); return; }
    if (WATER_CHECK.has(code) && rec.y > -5 && st.mode !== AI.sret) { this.setMode(rec, AI.sret, 10000, 0, 0, now); return; }
    if (!NO_CENTER_CHECK.has(code) && st.mode !== AI.ret && st.mode !== AI.sret && this.dist2(rec, { x: st.centerX, z: st.centerZ }) > def.range) {
      if (code !== 408 || (st.mode !== AI.hunt && st.mode !== AI.rise)) { this.setMode(rec, AI.ret, 20000, 0, 0, now); return; }
    }
    const p = this.d.player();
    if (SHY.has(code)) {
      if (p.alive && this.dist3(rec, p) < 100) {
        if (st.mode !== AI.flee) this.setMode(rec, AI.flee, 10000, CLS.unit, this.d.playerId, now);
        else st.timer = now;
      }
      return;
    }
    if (!AGGRESSIVE.has(code) || !p.alive) return;
    if (st.mode > SUPERIOR) return;
    if (this.tamed(rec)) return;
    const pm = physicsMode(code);
    const wantsUnderwater = pm === 2;
    if (this.dist3(rec, p) <= def.attackrange && (code !== 302 || p.underwater) && (code !== 408 || (st.mode !== AI.rise && st.mode !== AI.ret && st.mode !== AI.sret))) {
      this.d.damagePlayer(def.damage, rec);
      this.setMode(rec, AI.attack, undefined, 0, 0, now);
      this.d.engine.entityEvent(CLS.unit, rec.id, 'ai_attack');
      return;
    }
    if (st.mode !== AI.hunt && code !== 3 && code !== 6 && this.dist3(rec, p) <= def.range && p.underwater === wantsUnderwater) {
      this.setMode(rec, AI.hunt, 10000, 0, 0, now);
    }
  }

  private tamed(rec: EntityRecord): boolean {
    const typ = this.d.engine.stateType('tame');
    return typ >= 0 && this.d.engine.states.has(CLS.unit, rec.id, typ);
  }

  // ---- 物理 ----

  private physics(rec: EntityRecord, st: UnitAiState, code: number, f: number): void {
    const def = rec.def!;
    const ground = this.d.terrainY(rec.x, rec.z);
    const pm = physicsMode(code);
    if (pm === 1 || (pm === 6 && st.mode !== AI.flee)) {
      rec.y = Math.max(rec.y - GRAVITY_PER_F * f, ground + def.colyr);
    } else if (pm === 2) {
      rec.y = Math.min(Math.max(rec.y, ground + def.colyr), -10);
    } else if (pm === 3) {
      const base = Math.max(ground, 1) + (AIR_OFFSET[code] ?? 350);
      if (FREE_HEIGHT.has(code)) {
        if (rec.y < ground + def.colyr) {
          if (st.mode === AI.fall && ground > 2) { rec.y = ground + def.colyr; rec.pitch = 0; this.setMode(rec, AI.idle); }
          else { rec.y = ground + def.colyr; if (st.mode !== AI.idle) this.setMode(rec, AI.rise, 3000); }
        } else if (rec.y > base && st.mode !== AI.rise) {
          rec.y = Math.max(rec.y - 0.2 * f, base);
        }
      } else if (rec.y < base) {
        rec.y = base;
      } else {
        rec.y = Math.max(rec.y - (code === 404 ? 0.3 : 0.2) * f, base);
      }
    }
  }

  private deadPhysics(rec: EntityRecord, code: number, f: number): void {
    const ground = this.d.terrainY(rec.x, rec.z);
    const pm = physicsMode(code);
    if (pm === 2) rec.y = Math.min(rec.y + 0.3 * f, -2);
    else if (pm === 3) rec.y = Math.max(rec.y - 5 * f, ground);
    else rec.y = Math.max(rec.y - GRAVITY_PER_F * f, Math.max(ground, -2));
  }

  // ---- 受击反应、信号与指令 ----

  onHurt(rec: EntityRecord): void {
    if (rec.dead || rec.id === this.d.playerId) return;
    const code = this.code(rec);
    if (code === 0) return;
    const st = rec.ai ?? this.init(rec);
    if (FLEE_ON_HURT.has(code)) this.setMode(rec, AI.flee, 10000, CLS.unit, this.d.playerId);
    else if (HUNT_ON_HURT.has(code) && st.mode !== AI.hunt && st.mode !== AI.attack && !this.tamed(rec)) this.setMode(rec, AI.hunt, 15000);
  }

  signal(kind: string, srcCls: number, srcId: number, range: number, filter?: (rec: EntityRecord) => boolean): number {
    const src = srcCls === CLS.unit && srcId === this.d.playerId ? this.d.player() : this.d.registry.get(srcCls, srcId);
    if (!src) return 0;
    const mode = modeByName(kind);
    if (mode !== AI.getfood && mode !== AI.movetarget && mode !== AI.flee) return 0;
    let n = 0;
    for (const rec of this.d.registry.all(CLS.unit)) {
      if (rec.id === this.d.playerId || rec.dead) continue;
      const code = this.code(rec);
      if (code === 0 || code > 500) continue;
      if (filter && !filter(rec)) continue;
      if (this.dist3(rec, src) > range) continue;
      if (mode === AI.getfood && !EATERS.has(code)) continue;
      this.setMode(rec, mode, mode === AI.flee ? 10000 : 20000, srcCls, srcId);
      n++;
    }
    return n;
  }

  /** ai_mode 指令：按名称设置模式与目标。 */
  command(rec: EntityRecord, mode: string, targetCls = 0, targetId = 0): boolean {
    const m = modeByName(mode);
    if (!m) return false;
    const long = m === AI.getfood || m === AI.movetarget ? 20000 : m === AI.flee || m === AI.hunt ? 10000 : undefined;
    this.setMode(rec, m, long, targetCls, targetId);
    return true;
  }

  stay(rec: EntityRecord, on: boolean): void {
    const st = rec.ai ?? this.init(rec);
    st.freeze = on;
    if (on) this.setMode(rec, AI.idle);
  }

  center(rec: EntityRecord): void {
    const st = rec.ai ?? this.init(rec);
    st.centerX = rec.x;
    st.centerZ = rec.z;
  }
}
