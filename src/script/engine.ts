/** 脚本引擎：脚本挂载表、事件键、任务队列、定时器与状态表。 */
import type { Script } from './ast';
import { parseScript, scriptEvents, ScriptSyntaxError } from './parser';
import { runScript, VarStore, type ExecEnv, type ExecResult } from './interpreter';
import type { ScriptHost } from './host';
import { CLASS, GAME_SCRIPT_CLASS } from './host';
import type { CommandRegistry } from './registry';
import { toInt, type Value } from './value';

export interface ScriptSource {
  cls: number;
  id: number;
  text: string;
  script: Script | null;
  events: Set<string>;
  origin: string;
}

export interface Task {
  cls: number;
  id: number;
  event: string;
  info: string;
  source: ScriptSource;
}

export interface StateRecord {
  typ: number;
  cls: number;
  id: number;
  value: Value;
  color?: [number, number, number];
  size?: number;
}

export class StateStore {
  readonly records: StateRecord[] = [];

  add(cls: number, id: number, typ: number): StateRecord {
    const rec: StateRecord = { typ, cls, id, value: '0' };
    this.records.push(rec);
    return rec;
  }

  find(cls: number, id: number, typ: number): StateRecord | undefined {
    return this.records.find(r => r.cls === cls && r.id === id && r.typ === typ);
  }

  has(cls: number, id: number, typ: number): boolean {
    return !!this.find(cls, id, typ);
  }

  /** 删除并返回删掉的记录；typ 省略时删除该实体全部状态。 */
  free(cls: number, id: number, typ?: number): StateRecord[] {
    const out: StateRecord[] = [];
    for (let i = this.records.length - 1; i >= 0; i--) {
      const r = this.records[i];
      if (r.cls === cls && r.id === id && (typ === undefined || r.typ === typ)) {
        out.push(r);
        this.records.splice(i, 1);
      }
    }
    return out;
  }

  count(typ: number): number {
    return this.records.filter(r => r.typ === typ).length;
  }

  list(): StateRecord[] {
    return this.records.slice();
  }
}

export interface TimerRecord {
  cls: number;
  id: number;
  duration: number;
  start: number;
  /** 剩余触发次数；0 表示无限。 */
  mode: number;
  source: string;
  isScript: boolean;
}

export class TimerStore {
  readonly records: TimerRecord[] = [];

  add(rec: TimerRecord): void {
    this.records.push(rec);
  }

  free(cls: number, id: number, source?: string): number {
    let n = 0;
    for (let i = this.records.length - 1; i >= 0; i--) {
      const r = this.records[i];
      if (r.cls === cls && r.id === id && (source === undefined || r.source === source)) {
        this.records.splice(i, 1);
        n++;
      }
    }
    return n;
  }

  count(cls: number, id: number): number {
    return this.records.filter(r => r.cls === cls && r.id === id).length;
  }

  /** 到期的定时器触发一次；次数减到 0 删除，否则从现在重新计时。 */
  update(now: number, fire: (t: TimerRecord) => void): void {
    for (let i = 0; i < this.records.length; i++) {
      const t = this.records[i];
      if (now - (t.start + t.duration) <= 0) continue;
      fire(t);
      t.mode -= 1;
      if (t.mode === 0) {
        this.records.splice(i, 1);
        i--;
      } else {
        t.start = now;
      }
    }
  }
}

/** 原版 parse_getstate 的状态名表（含别名），优先于 states.inf 里的显示名。 */
export const STATE_NAMES = new Map<string, number>([
  ['bleeding', 1],
  ['intoxication', 2],
  ['pus', 3],
  ['fire', 4],
  ['eternalfire', 5],
  ['eternal fire', 5],
  ['frostbite', 6],
  ['fracture', 7],
  ['electroshock', 8],
  ['bloodrush', 9],
  ['dizzy', 10],
  ['wet', 11],
  ['fuddle', 12],
  ['healing', 16],
  ['invulnerability', 17],
  ['invulnerable', 17],
  ['tame', 18],
  ['action', 21],
  ['flare', 22],
  ['smoke', 23],
  ['light', 24],
  ['particles', 25],
  ['physics', 51],
  ['buildplace', 52],
  ['link', 53],
  ['ai_stick', 60],
  ['speed', 54],
  ['speedmod', 54],
  ['ghost', 55],
]);

export class ScriptEngine {
  readonly vars = new VarStore();
  readonly states = new StateStore();
  readonly timers = new TimerStore();
  readonly syntaxErrors: { origin: string; message: string; line: number }[] = [];
  /** 状态名（小写）到 states.inf 的 id。 */
  stateTypes = new Map<string, number>();
  private gameScript?: ScriptSource;
  private mapScript?: ScriptSource;
  private readonly typeScripts = new Map<string, ScriptSource>();
  private readonly instanceScripts = new Map<string, ScriptSource>();
  private readonly tasks: Task[] = [];
  private lastSkipEvent = false;

  constructor(readonly host: ScriptHost, readonly registry: CommandRegistry) {}

  compile(text: string, origin: string, cls: number, id: number): ScriptSource {
    try {
      const script = parseScript(text);
      return { cls, id, text, script, events: scriptEvents(script), origin };
    } catch (e) {
      if (e instanceof ScriptSyntaxError) {
        this.syntaxErrors.push({ origin, message: e.message, line: e.line });
        this.host.log('error', `脚本语法错误 ${origin}: ${e.message}`);
        return { cls, id, text, script: null, events: new Set(), origin };
      }
      throw e;
    }
  }

  setGameScript(text: string, origin = 'game.inf'): void {
    this.gameScript = this.compile(text, origin, GAME_SCRIPT_CLASS, 0);
  }

  setMapScript(text: string, origin = 'map briefing'): void {
    this.mapScript = this.compile(text, origin, CLASS.global, 0);
  }

  setTypeScript(cls: number, typ: number, text: string, origin: string): void {
    this.typeScripts.set(`${cls}:${typ}`, this.compile(text, origin, cls, 0));
  }

  typeScript(cls: number, typ: number): ScriptSource | undefined {
    return this.typeScripts.get(`${cls}:${typ}`);
  }

  addInstanceScript(cls: number, id: number, text: string, extend = false, origin = `instance ${cls}:${id}`): void {
    const key = `${cls}:${id}`;
    const prev = this.instanceScripts.get(key);
    const merged = extend && prev ? `${prev.text}\n${text}` : text;
    this.instanceScripts.set(key, this.compile(merged, origin, cls, id));
  }

  instanceScript(cls: number, id: number): ScriptSource | undefined {
    return this.instanceScripts.get(`${cls}:${id}`);
  }

  removeInstanceScript(cls: number, id: number): void {
    this.instanceScripts.delete(`${cls}:${id}`);
  }

  /** 实体上挂着的脚本：类型脚本在前，实例脚本在后。 */
  scriptsFor(cls: number, id: number, event?: string): ScriptSource[] {
    const out: ScriptSource[] = [];
    if (cls === GAME_SCRIPT_CLASS) {
      if (this.gameScript) out.push(this.gameScript);
    } else if (cls === CLASS.global) {
      if (this.mapScript) out.push(this.mapScript);
    } else {
      const ent = this.host.entity(cls, id);
      const ts = ent ? this.typeScripts.get(`${cls}:${ent.typ}`) : undefined;
      if (ts) out.push({ ...ts, id });
      const is = this.instanceScripts.get(`${cls}:${id}`);
      if (is) out.push(is);
    }
    return event === undefined ? out : out.filter(s => s.script && s.events.has(event));
  }

  private queue(source: ScriptSource, cls: number, id: number, event: string, info: string): void {
    if (!source.script || !source.events.has(event)) return;
    this.tasks.push({ cls, id, event, info, source });
  }

  /** 全局事件：game.inf、地图脚本、所有带该事件的实例脚本与类型脚本的实体。 */
  globalEvent(event: string, info = ''): void {
    if (this.gameScript) this.queue(this.gameScript, GAME_SCRIPT_CLASS, 0, event, info);
    if (this.mapScript) this.queue(this.mapScript, CLASS.global, 0, event, info);
    for (const src of this.instanceScripts.values()) this.queue(src, src.cls, src.id, event, info);
    for (const [key, src] of this.typeScripts) {
      if (!src.script || !src.events.has(event)) continue;
      const [cls, typ] = key.split(':').map(Number);
      for (const e of this.host.entities(cls, typ)) this.queue(src, cls, e.id, event, info);
    }
  }

  entityEvent(cls: number, id: number, event: string, info = ''): void {
    for (const src of this.scriptsFor(cls, id, event)) this.queue(src, cls, id, event, info);
  }

  /** 立即执行某实体的事件；返回执行数量与是否有脚本要求取消默认动作。 */
  runNow(cls: number, id: number, event: string, info = ''): { ran: number; skipevent: boolean } {
    let ran = 0;
    let skipevent = false;
    for (const src of this.scriptsFor(cls, id, event)) {
      const r = this.execute(src, { cls, id, event, info });
      ran++;
      if (r === 'skipevent') skipevent = true;
    }
    return { ran, skipevent };
  }

  runGlobalNow(event: string, info = ''): boolean {
    let skipevent = false;
    for (const src of [this.gameScript, this.mapScript]) {
      if (!src || !src.script || !src.events.has(event)) continue;
      if (this.execute(src, { cls: src.cls, id: 0, event, info }) === 'skipevent') skipevent = true;
    }
    return skipevent;
  }

  /** 直接执行一段文本（定时器脚本、外部文件）。 */
  runText(text: string, env: ExecEnv, origin: string): ExecResult {
    const src = this.compile(text, origin, env.cls, env.id);
    if (!src.script) return 'error';
    return this.execute(src, env);
  }

  private execute(src: ScriptSource, env: ExecEnv): ExecResult {
    if (!src.script) return 'error';
    const r = runScript(src.script, env, { host: this.host, engine: this, registry: this.registry, vars: this.vars, origin: src.origin });
    this.lastSkipEvent = r === 'skipevent';
    return r;
  }

  get skipEventFlag(): boolean {
    return this.lastSkipEvent;
  }

  pendingTasks(): number {
    return this.tasks.length;
  }

  /** 每帧：先触发到期定时器，再依次执行任务队列（执行中新排的任务也在本轮跑完）。 */
  update(dtMs: number): void {
    this.timers.update(this.host.now(), t => this.fireTimer(t));
    let guard = 0;
    while (this.tasks.length > 0 && guard++ < 10000) {
      const t = this.tasks.shift()!;
      this.execute(t.source, { cls: t.cls, id: t.id, event: t.event, info: t.info });
    }
    void dtMs;
  }

  private fireTimer(t: TimerRecord): void {
    if (t.isScript) {
      this.runText(t.source, { cls: t.cls, id: t.id, event: 'timer', info: 'triggered by timer' }, `timer ${t.cls}:${t.id}`);
    } else if (t.cls === CLASS.global) {
      this.globalEvent(t.source, 'triggered by timer');
    } else {
      this.entityEvent(t.cls, t.id, t.source, 'triggered by timer');
    }
  }

  stateType(name: Value): number {
    const n = toInt(name);
    if (n > 0 && /^\d+$/.test(name.trim())) return n;
    const key = name.trim().toLowerCase();
    return STATE_NAMES.get(key) ?? this.stateTypes.get(key) ?? this.stateTypes.get(key.replace(/\s+/g, '')) ?? -1;
  }
}
