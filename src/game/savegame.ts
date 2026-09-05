/**
 * 存档：把会话状态存成 JSON 快照放进 localStorage，读档时按快照的地图路径加载地图后恢复。
 * 快照包含地图、时钟、玩家位置与数值、手持武器、全部实体、状态、定时器、变量、日记、锁与文本缓冲。
 */
import { CLS, STORED_INSIDE, type EntityRegistry, type EntityRecord } from './entities';
import type { ScriptEngine } from '../script/engine';
import type { World } from '../render/world';
import type { DiaryEntry } from './panels';
import type { SaveInfo } from './menu-ui';

export const SAVE_PREFIX = 'stranded2:save:';
export const QUICKSAVE = 'QUICKSAVE';
const CLASSES = [CLS.object, CLS.unit, CLS.item, CLS.info];

export interface SnapEntity {
  cls: number; id: number; typ: number;
  x: number; y: number; z: number; yaw: number; pitch: number; roll: number;
  health: number; healthMax: number; count: number;
  parentClass: number; parentId: number; parentMode: number;
  dead: boolean;
}

export interface Snapshot {
  version: 1;
  mapPath: string;
  savedAt: string;
  clock: { day: number; hour: number; minute: number };
  player: { x: number; y: number; z: number; yaw: number; pitch: number };
  stats: { health: number; hunger: number; thirst: number; exhaustion: number };
  weapon: number;
  entities: SnapEntity[];
  states: { cls: number; id: number; typ: number; value: string }[];
  timers: { cls: number; id: number; duration: number; remaining: number; mode: number; source: string; isScript: boolean }[];
  globals: [string, string][];
  locals: { cls: number; id: number; vars: [string, string][] }[];
  diary: DiaryEntry[];
  locks: string[];
  buffer: string;
}

export interface SnapshotSource {
  mapPath: string;
  registry: EntityRegistry;
  engine: ScriptEngine;
  now: number;
  clock: { day: number; hour: number; minute: number };
  /** Blitz 坐标与角度。 */
  player: { x: number; y: number; z: number; yaw: number; pitch: number };
  stats: { health: number; hunger: number; thirst: number; exhaustion: number };
  weapon: number;
  diary: DiaryEntry[];
  locks: Set<string>;
  buffer: string;
}

export interface RestoreTarget {
  registry: EntityRegistry;
  engine: ScriptEngine;
  world: World;
  playerId: number;
  now: number;
  clock: { day: number; hour: number; minute: number };
  stats: { health: number; hunger: number; thirst: number; exhaustion: number };
  setPlayer(p: { x: number; y: number; z: number; yaw: number; pitch: number }): void;
  takeInHand(typ: number): void;
  diary: DiaryEntry[];
  locks: Set<string>;
  setBuffer(text: string): void;
}

export function snapshot(s: SnapshotSource): Snapshot {
  const entities: SnapEntity[] = [];
  for (const cls of CLASSES) {
    for (const r of s.registry.all(cls)) {
      entities.push({
        cls, id: r.id, typ: r.typ, x: r.x, y: r.y, z: r.z, yaw: r.yaw, pitch: r.pitch, roll: r.roll,
        health: r.health, healthMax: r.healthMax, count: r.count,
        parentClass: r.parentClass, parentId: r.parentId, parentMode: r.parentMode, dead: !!r.dead,
      });
    }
  }
  return {
    version: 1,
    mapPath: s.mapPath,
    savedAt: new Date().toISOString(),
    clock: { ...s.clock },
    player: { ...s.player },
    stats: { health: s.stats.health, hunger: s.stats.hunger, thirst: s.stats.thirst, exhaustion: s.stats.exhaustion },
    weapon: s.weapon,
    entities,
    states: s.engine.states.list().map(st => ({ cls: st.cls, id: st.id, typ: st.typ, value: String(st.value) })),
    timers: s.engine.timers.records.map(t => ({ cls: t.cls, id: t.id, duration: t.duration, remaining: t.start + t.duration - s.now, mode: t.mode, source: t.source, isScript: t.isScript })),
    globals: [...s.engine.vars.globals.entries()].map(([k, v]) => [k, String(v)]),
    locals: s.engine.vars.localEntries().map(l => ({ cls: l.cls, id: l.id, vars: l.vars.map(([k, v]) => [k, String(v)] as [string, string]) })),
    diary: s.diary.map(e => ({ ...e })),
    locks: [...s.locks],
    buffer: s.buffer,
  };
}

/** 清掉地图自带实体后按快照重建；玩家单位保留，只更新位置与数值。 */
export function restore(t: RestoreTarget, snap: Snapshot): void {
  for (const cls of CLASSES) {
    for (const r of t.registry.all(cls)) {
      if (cls === CLS.unit && r.id === t.playerId) continue;
      t.world.remove(r);
    }
  }
  const later: EntityRecord[] = [];
  for (const e of snap.entities) {
    if (e.cls === CLS.unit && e.id === t.playerId) continue;
    const rec = t.registry.make(e.cls, e.typ, e.x, e.y, e.z, e.count, e.id);
    rec.yaw = e.yaw;
    rec.pitch = e.pitch;
    rec.roll = e.roll;
    rec.health = e.health;
    rec.healthMax = e.healthMax;
    rec.parentClass = e.parentClass;
    rec.parentId = e.parentId;
    rec.parentMode = e.parentMode;
    if (e.dead) rec.dead = true;
    later.push(rec);
  }
  for (const rec of later) {
    if (rec.cls === CLS.info) continue;
    if (rec.cls === CLS.item && rec.parentMode === STORED_INSIDE) continue;
    t.world.sync(rec);
  }
  const player = t.registry.get(CLS.unit, t.playerId);
  if (player) player.health = snap.stats.health;
  t.engine.states.records.splice(0, t.engine.states.records.length, ...snap.states.map(s => ({ cls: s.cls, id: s.id, typ: s.typ, value: s.value })));
  t.engine.timers.records.splice(0, t.engine.timers.records.length, ...snap.timers.map(tm => ({ cls: tm.cls, id: tm.id, duration: tm.duration, start: t.now - tm.duration + tm.remaining, mode: tm.mode, source: tm.source, isScript: tm.isScript })));
  t.engine.vars.freeGlobals();
  for (const [k, v] of snap.globals) t.engine.vars.globals.set(k, v);
  for (const l of snap.locals) {
    t.engine.vars.freeLocalsOf(l.cls, l.id);
    for (const [k, v] of l.vars) t.engine.vars.setLocal(l.cls, l.id, k, v);
  }
  t.diary.splice(0, t.diary.length, ...snap.diary.map(e => ({ ...e })));
  t.locks.clear();
  for (const k of snap.locks) t.locks.add(k);
  t.setBuffer(snap.buffer);
  t.clock.day = snap.clock.day;
  t.clock.hour = snap.clock.hour;
  t.clock.minute = snap.clock.minute;
  t.stats.health = snap.stats.health;
  t.stats.hunger = snap.stats.hunger;
  t.stats.thirst = snap.stats.thirst;
  t.stats.exhaustion = snap.stats.exhaustion;
  t.setPlayer({ ...snap.player });
  t.takeInHand(snap.weapon);
}

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

export function saveGame(name: string, snap: Snapshot): boolean {
  const st = storage();
  if (!st) return false;
  try {
    st.setItem(SAVE_PREFIX + name, JSON.stringify(snap));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(name: string): Snapshot | null {
  const raw = storage()?.getItem(SAVE_PREFIX + name);
  if (!raw) return null;
  try {
    const snap = JSON.parse(raw) as Snapshot;
    return snap && snap.version === 1 && typeof snap.mapPath === 'string' ? snap : null;
  } catch {
    return null;
  }
}

export function deleteSave(name: string): void {
  storage()?.removeItem(SAVE_PREFIX + name);
}

export function listSaves(): SaveInfo[] {
  const st = storage();
  if (!st) return [];
  const out: SaveInfo[] = [];
  for (let i = 0; i < st.length; i++) {
    const key = st.key(i);
    if (!key || !key.startsWith(SAVE_PREFIX)) continue;
    const name = key.slice(SAVE_PREFIX.length);
    const snap = loadGame(name);
    if (snap) out.push({ name, mapPath: snap.mapPath, savedAt: snap.savedAt.replace('T', ' ').slice(0, 16) });
  }
  return out.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}
