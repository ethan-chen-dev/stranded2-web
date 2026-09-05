/**
 * loadmap 的数据继承：按标志收集玩家背包、手持武器、全局变量、日记、玩家状态与建筑锁，
 * 经 sessionStorage 带到下一张地图后写回。规则来自原版 functions.bb 的 cachedata 与 e_load_map.bb。
 */
import { CLS, type EntityRegistry } from './entities';
import type { ScriptEngine } from '../script/engine';
import type { DiaryEntry } from './panels';
import type { Skills, SkillEntry } from './skills';

export const TAKEOVER_KEY = 'stranded2:takeover';

export interface TakeoverFlags {
  skills: boolean;
  items: boolean;
  vars: boolean;
  diary: boolean;
  states: boolean;
  locks: boolean;
}

export interface TakeoverData {
  items: { typ: number; count: number }[];
  weapon: number;
  vars: [string, string][];
  diary: DiaryEntry[];
  states: number[];
  locks: string[];
  skills: SkillEntry[];
}

export interface TakeoverSource {
  registry: EntityRegistry;
  playerId: number;
  weaponTyp: number;
  engine: ScriptEngine;
  diary: DiaryEntry[];
  locks: Set<string>;
  skills: Skills;
}

export interface TakeoverTarget {
  registry: EntityRegistry;
  playerId: number;
  engine: ScriptEngine;
  diary: DiaryEntry[];
  locks: Set<string>;
  skills: Skills;
  takeInHand(typ: number): void;
}

/** loadmap 的 6 个可选标志，缺省全 0。 */
export function parseFlags(args: (string | undefined)[]): TakeoverFlags {
  const on = (i: number) => Number(args[i] ?? 0) !== 0;
  return { skills: on(0), items: on(1), vars: on(2), diary: on(3), states: on(4), locks: on(5) };
}

export function collectTakeover(src: TakeoverSource, flags: TakeoverFlags): TakeoverData {
  const data: TakeoverData = { items: [], weapon: 0, vars: [], diary: [], states: [], locks: [], skills: [] };
  if (flags.skills) data.skills = src.skills.entries();
  if (flags.items) {
    for (const it of src.registry.storedIn(CLS.unit, src.playerId)) data.items.push({ typ: it.typ, count: it.count });
    data.weapon = src.weaponTyp;
  }
  if (flags.vars) data.vars = [...src.engine.vars.globals.entries()].map(([k, v]) => [k, String(v)]);
  if (flags.diary) data.diary = src.diary.map(e => ({ ...e }));
  if (flags.states) data.states = src.engine.states.list().filter(s => s.cls === CLS.unit && s.id === src.playerId).map(s => s.typ);
  if (flags.locks) data.locks = [...src.locks].filter(k => k.startsWith('building:'));
  return data;
}

export function applyTakeover(dst: TakeoverTarget, data: TakeoverData): void {
  for (const [k, v] of data.vars) dst.engine.vars.globals.set(k, v);
  for (const sk of data.skills ?? []) { dst.skills.map.set(sk.name, { value: sk.value, caption: sk.caption }); }
  for (const k of data.locks) dst.locks.add(k);
  for (const e of data.diary) dst.diary.push({ ...e });
  for (const it of data.items) {
    const rec = dst.registry.make(CLS.item, it.typ, 0, 0, 0, it.count);
    if (dst.registry.store(rec.id, CLS.unit, dst.playerId) <= 0) dst.registry.remove(CLS.item, rec.id);
  }
  if (data.weapon > 0) dst.takeInHand(data.weapon);
  for (const typ of data.states) {
    if (!dst.engine.states.has(CLS.unit, dst.playerId, typ)) dst.engine.states.add(CLS.unit, dst.playerId, typ);
  }
}

export function stashTakeover(data: TakeoverData): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(TAKEOVER_KEY, JSON.stringify(data));
}

/** 取出并删除暂存的继承数据；没有为 null。 */
export function popTakeover(): TakeoverData | null {
  if (typeof sessionStorage === 'undefined') return null;
  const raw = sessionStorage.getItem(TAKEOVER_KEY);
  if (raw === null) return null;
  sessionStorage.removeItem(TAKEOVER_KEY);
  try {
    return JSON.parse(raw) as TakeoverData;
  } catch {
    return null;
  }
}
