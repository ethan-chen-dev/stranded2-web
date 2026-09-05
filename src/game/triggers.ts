/**
 * 触发器信息点：区域（10）、时间（11）、物品计数（12）与 AI 区域（46），每秒检查一次，
 * 条件满足时触发该信息点的 trigger 事件。规则来自原版 handle_infos.bb。
 */
import { CLS, STORED_INSIDE, type EntityRegistry } from './entities';
import type { ScriptEngine } from '../script/engine';
import type { MapInfo } from '../formats/s2map';

export const TRIGGER_INTERVAL_MS = 1000;
export const AREA_TRIGGER = 10;
export const TIME_TRIGGER = 11;
export const ITEM_TRIGGER = 12;
export const AI_AREA = 46;

export interface ClockTime {
  day: number;
  hour: number;
  minute: number;
}

export interface TriggerDeps {
  registry: EntityRegistry;
  engine: ScriptEngine;
  playerId: number;
  player(): { x: number; y: number; z: number };
  clock(): ClockTime;
  aiSignal(kind: 'attract' | 'distract', infoId: number, range: number): void;
}

interface TriggerState {
  id: number;
  typ: number;
  x: number;
  y: number;
  z: number;
  ints: [number, number, number];
  floats: [number, number, number];
  timer: number;
}

function stamp(t: ClockTime): number {
  return t.day * 10000 + t.hour * 100 + t.minute;
}

function compare(op: number, a: number, b: number, strictGe = false): boolean {
  switch (Math.trunc(op)) {
    case 0: return a === b;
    case 1: return a > b;
    case 2: return a < b;
    case 3: return strictGe ? a > b : a >= b;
    case 4: return strictGe ? a < b : a <= b;
    case 5: return a !== b;
    default: return false;
  }
}

export class Triggers {
  private readonly list = new Map<number, TriggerState>();
  private acc = 0;
  private last: ClockTime | null = null;

  constructor(private readonly d: TriggerDeps) {}

  load(infos: MapInfo[]): void {
    this.list.clear();
    for (const i of infos) {
      if ((i.typ >= 10 && i.typ < 30) || i.typ === AI_AREA) {
        this.list.set(i.id, { id: i.id, typ: i.typ, x: i.x, y: i.y, z: i.z, ints: [...i.ints], floats: [...i.floats], timer: 0 });
      }
    }
  }

  active(id: number): boolean {
    return Math.trunc(this.list.get(id)?.floats[1] ?? 0) === 1;
  }

  start(id: number): boolean {
    const t = this.list.get(id);
    if (!t) return false;
    t.floats[1] = 1;
    return true;
  }

  stop(id: number): boolean {
    const t = this.list.get(id);
    if (!t) return false;
    t.floats[1] = 0;
    return true;
  }

  stopAll(): void {
    for (const t of this.list.values()) if (t.typ >= 10 && t.typ < 30) t.floats[1] = 0;
  }

  /** 激活标志，供存档使用。 */
  states(): [number, number][] {
    return [...this.list.values()].map(t => [t.id, t.floats[1]]);
  }

  restore(states: [number, number][]): void {
    for (const [id, on] of states) {
      const t = this.list.get(id);
      if (t) t.floats[1] = on;
    }
  }

  update(dtMs: number): void {
    this.acc += dtMs;
    if (this.acc < TRIGGER_INTERVAL_MS) return;
    this.acc -= TRIGGER_INTERVAL_MS;
    const now = this.d.clock();
    const last = this.last ?? now;
    for (const t of [...this.list.values()]) {
      if (!this.d.registry.get(CLS.info, t.id)) { this.list.delete(t.id); continue; }
      switch (t.typ) {
        case AREA_TRIGGER:
          if (t.floats[1] !== 1) break;
          if (compare(t.floats[2], this.countInRange(t), t.ints[2])) this.fire(t.id);
          break;
        case TIME_TRIGGER:
          if (t.floats[1] !== 1) break;
          this.timeTrigger(t, last, now);
          break;
        case ITEM_TRIGGER: {
          if (t.floats[1] !== 1) break;
          const c = t.ints[0] === 0
            ? this.d.registry.countStored(CLS.unit, this.d.playerId, t.ints[2])
            : this.d.registry.countStored(t.ints[0], t.ints[1], t.ints[2]);
          if (compare(t.floats[2], c, Math.trunc(t.floats[0]), true)) this.fire(t.id);
          break;
        }
        case AI_AREA:
          this.d.aiSignal(t.ints[0] === 0 ? 'attract' : 'distract', t.id, t.floats[0]);
          break;
        default:
          break;
      }
    }
    this.last = { ...now };
  }

  private timeTrigger(t: TriggerState, last: ClockTime, now: ClockTime): void {
    switch (t.ints[0]) {
      case 0:
        t.timer += 1;
        if (t.timer >= t.ints[1]) { t.timer = 0; this.fire(t.id); }
        break;
      case 1: {
        const elapsed = (now.day * 24 * 60 + now.hour * 60 + now.minute) - (last.day * 24 * 60 + last.hour * 60 + last.minute);
        t.timer += Math.max(elapsed, 0);
        if (t.timer >= t.ints[1]) { t.timer = 0; this.fire(t.id); }
        break;
      }
      case 2: {
        const check = t.ints[1] * 10000 + t.ints[2] * 100 + Math.trunc(t.floats[0]);
        if (check >= stamp(last) && check <= stamp(now) && stamp(now) !== stamp(last)) {
          t.floats[1] = 0;
          this.fire(t.id);
        }
        break;
      }
      case 3: {
        const daily = (day: number) => day * 10000 + t.ints[1] * 100 + t.ints[2];
        const hit = (check: number) => check >= stamp(last) && check <= stamp(now) && stamp(now) !== stamp(last);
        if (hit(daily(now.day)) || (last.day < now.day && hit(daily(last.day)))) this.fire(t.id);
        break;
      }
      default:
        break;
    }
  }

  private countInRange(t: TriggerState): number {
    const r = t.floats[0];
    const within = (x: number, y: number, z: number) => Math.hypot(x - t.x, y - t.y, z - t.z) <= r;
    switch (t.ints[0]) {
      case 0: {
        const p = this.d.player();
        return within(p.x, p.y, p.z) ? 1 : 0;
      }
      case CLS.object:
        return this.d.registry.all(CLS.object, t.ints[1] || undefined).filter(o => within(o.x, o.y, o.z)).length;
      case CLS.unit:
        return this.d.registry.all(CLS.unit, t.ints[1] || undefined).filter(u => !u.dead && u.health > 0 && within(u.x, u.y, u.z)).length;
      case CLS.item:
        return this.d.registry.all(CLS.item, t.ints[1] || undefined).filter(i => i.parentMode !== STORED_INSIDE && within(i.x, i.y, i.z)).length;
      default:
        return 0;
    }
  }

  private fire(id: number): void {
    this.d.engine.entityEvent(CLS.info, id, 'trigger', 'triggered');
  }
}
