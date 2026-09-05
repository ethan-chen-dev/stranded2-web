/** 执行脚本语法树：变量作用域、控制流、命令与函数调用、skip/skipevent/exit、错误抑制。 */
import type { Expr, Script, Stmt } from './ast';
import { add, sub, mul, div, compare, logic, truthy, negate, typeOf, toInt, fromNumber, toFloat, ScriptRuntimeError, type Value } from './value';
import type { ScriptHost } from './host';
import type { CommandRegistry, CommandContext } from './registry';
import type { ScriptEngine } from './engine';

export interface ExecEnv {
  cls: number;
  id: number;
  event: string;
  info: string;
}

export type ExecResult = 'done' | 'skip' | 'skipevent' | 'error';

/** 单次脚本执行的语句上限，超过判定为死循环。 */
export const STATEMENT_LIMIT = 100000;

export class VarStore {
  readonly globals = new Map<string, Value>();
  private readonly locals = new Map<string, Map<string, Value>>();
  readonly temps = new Set<string>();

  private key(cls: number, id: number): string {
    return `${cls}:${id}`;
  }

  private localMap(cls: number, id: number, create: boolean): Map<string, Value> | undefined {
    const k = this.key(cls, id);
    let m = this.locals.get(k);
    if (!m && create) {
      m = new Map();
      this.locals.set(k, m);
    }
    return m;
  }

  get(env: ExecEnv, name: string): Value {
    const l = this.localMap(env.cls, env.id, false)?.get(name);
    if (l !== undefined) return l;
    return this.globals.get(name) ?? '0';
  }

  set(env: ExecEnv, name: string, v: Value): void {
    const m = this.localMap(env.cls, env.id, false);
    if (m?.has(name)) {
      m.set(name, v);
      return;
    }
    this.globals.set(name, v);
  }

  /** += 语义：整数与整数相加，否则浮点相加；不存在时创建全局变量。 */
  modify(env: ExecEnv, name: string, delta: Value): Value {
    const m = this.localMap(env.cls, env.id, false);
    const target = m?.has(name) ? m : this.globals;
    const cur = target.get(name);
    if (cur === undefined) {
      this.globals.set(name, delta);
      return delta;
    }
    const v = typeOf(cur) === 0 && typeOf(delta) === 0 ? fromNumber(toInt(cur) + toInt(delta)) : fromNumber(toFloat(cur) + toFloat(delta), true);
    target.set(name, v);
    return v;
  }

  free(env: ExecEnv, name: string): boolean {
    const m = this.localMap(env.cls, env.id, false);
    if (m?.delete(name)) return true;
    return this.globals.delete(name);
  }

  exists(env: ExecEnv, name: string): boolean {
    return this.localMap(env.cls, env.id, false)?.has(name) || this.globals.has(name);
  }

  /** local 声明：删除同名全局变量并把它的整数值作为初值。 */
  declareLocal(env: ExecEnv, name: string): void {
    const m = this.localMap(env.cls, env.id, true)!;
    const g = this.globals.get(name);
    if (g !== undefined) {
      this.globals.delete(name);
      m.set(name, fromNumber(toInt(g)));
    } else if (!m.has(name)) {
      m.set(name, '0');
    }
  }

  setLocal(cls: number, id: number, name: string, v: Value): void {
    this.localMap(cls, id, true)!.set(name, v);
  }

  getLocal(cls: number, id: number, name: string): Value {
    return this.localMap(cls, id, false)?.get(name) ?? '0';
  }

  hasLocal(cls: number, id: number, name: string): boolean {
    return this.localMap(cls, id, false)?.has(name) ?? false;
  }

  freeLocalsOf(cls: number, id: number): void {
    this.locals.delete(this.key(cls, id));
  }

  freeGlobals(): void {
    this.globals.clear();
  }

  rename(env: ExecEnv, from: string, to: string): boolean {
    const m = this.localMap(env.cls, env.id, false);
    if (m?.has(from)) {
      m.set(to, m.get(from)!);
      m.delete(from);
      return true;
    }
    if (this.globals.has(from)) {
      this.globals.set(to, this.globals.get(from)!);
      this.globals.delete(from);
      return true;
    }
    return false;
  }
}

export interface RunOptions {
  host: ScriptHost;
  engine: ScriptEngine;
  registry: CommandRegistry;
  vars: VarStore;
  origin: string;
}

type Signal = 'normal' | 'exit' | 'stop';

class Runner {
  private statements = 0;
  private stop: ExecResult = 'done';
  private loopIds: Value[] = [];

  constructor(private readonly env: ExecEnv, private readonly o: RunOptions) {}

  run(script: Script): ExecResult {
    try {
      if (this.execBlock(script.top) !== 'stop') {
        for (const on of script.events) {
          if (on.event !== this.env.event) continue;
          if (this.execBlock(on.body) === 'stop') break;
        }
      }
      return this.stop;
    } catch (e) {
      if (e instanceof ScriptRuntimeError) {
        this.o.host.log('error', `脚本错误 ${this.o.origin}${e.line ? ` 第 ${e.line} 行` : ''}（事件 ${this.env.event}）: ${e.message}`);
        return 'error';
      }
      throw e;
    }
  }

  private execBlock(stmts: Stmt[]): Signal {
    for (const s of stmts) {
      const sig = this.execStmt(s);
      if (sig !== 'normal') return sig;
    }
    return 'normal';
  }

  private tick(line: number): void {
    if (++this.statements > STATEMENT_LIMIT) throw new ScriptRuntimeError('script loop timeout', line);
  }

  private execStmt(s: Stmt): Signal {
    this.tick(s.line);
    switch (s.kind) {
      case 'assign': {
        const env = this.env;
        switch (s.op) {
          case '=': this.o.vars.set(env, s.name, this.eval(s.expr!)); break;
          case '+=': this.o.vars.modify(env, s.name, this.eval(s.expr!)); break;
          case '-=': this.o.vars.modify(env, s.name, negate(this.eval(s.expr!))); break;
          case '++': this.o.vars.modify(env, s.name, '1'); break;
          case '--': this.o.vars.modify(env, s.name, '-1'); break;
        }
        return 'normal';
      }
      case 'command':
        if (s.name !== '') this.call(s.name, s.args, s.suppress, s.line, false);
        return 'normal';
      case 'if': {
        for (const b of s.branches) {
          if (truthy(this.eval(b.cond))) return this.execBlock(b.body);
        }
        return s.else ? this.execBlock(s.else) : 'normal';
      }
      case 'loop':
        return this.execLoop(s);
      case 'exit':
        return 'exit';
      case 'skip':
        this.stop = 'skip';
        return 'stop';
      case 'skipevent':
        this.stop = 'skipevent';
        return 'stop';
    }
  }

  private execLoop(s: Extract<Stmt, { kind: 'loop' }>): Signal {
    const mode = this.eval(s.mode).toLowerCase();
    const arg = s.arg ? this.eval(s.arg) : '';
    let ids: Value[];
    switch (mode) {
      case 'count': {
        const n = Math.abs(toInt(arg));
        ids = Array.from({ length: n }, (_, i) => fromNumber(i + 1));
        break;
      }
      case 'objects': case 'object': case '1':
      case 'units': case 'unit': case '2':
      case 'items': case 'item': case '3':
      case 'infos': case 'info': case '4': {
        const cls = 'objects object 1'.includes(mode) ? 1 : 'units unit 2'.includes(mode) ? 2 : 'items item 3'.includes(mode) ? 3 : 4;
        const typ = toInt(arg);
        ids = this.o.host.entities(cls, typ > 0 ? typ : undefined).map(e => fromNumber(e.id));
        break;
      }
      case 'states': case 'state': case '5':
        ids = this.o.engine.states.list().map(st => fromNumber(st.typ));
        break;
      default:
        throw new ScriptRuntimeError(`unknown loop type '${mode}'`, s.line);
    }
    for (const id of ids) {
      this.tick(s.line);
      this.loopIds.push(id);
      const sig = this.execBlock(s.body);
      this.loopIds.pop();
      if (sig === 'stop') return 'stop';
      if (sig === 'exit') break;
    }
    return 'normal';
  }

  eval(e: Expr): Value {
    switch (e.kind) {
      case 'num': return e.value;
      case 'str': return e.parts.map(p => (typeof p === 'string' ? p : this.o.vars.get(this.env, p.var))).join('');
      case 'var': return this.o.vars.get(this.env, e.name);
      case 'unary': return negate(this.eval(e.expr));
      case 'binary': {
        const a = this.eval(e.left);
        const b = this.eval(e.right);
        switch (e.op) {
          case '+': return add(a, b);
          case '-': return sub(a, b);
          case '*': return mul(a, b);
          case '/': return div(a, b);
          case '&&': case '||': case 'and': case 'or': case 'xor': return logic(e.op, a, b);
          default: return compare(e.op, a, b);
        }
      }
      case 'call': return this.call(e.name, e.args, false, e.line, true);
    }
  }

  private call(name: string, argExprs: Expr[], suppress: boolean, line: number, wantValue: boolean): Value {
    const entry = this.o.registry.get(name);
    if (!entry) return this.o.registry.unimplemented(name, this.o.host.log.bind(this.o.host));
    const ctx: CommandContext = {
      host: this.o.host, engine: this.o.engine, env: this.env, vars: this.o.vars,
      eval: x => this.eval(x), suppress, line, loopId: this.loopIds[this.loopIds.length - 1] ?? '0', wantValue,
    };
    try {
      const args = entry.raw ? [] : argExprs.map(a => this.eval(a));
      const r = entry.fn(ctx, args, argExprs);
      return r === undefined ? '0' : r;
    } catch (e) {
      if (e instanceof ScriptRuntimeError) {
        if (suppress) return '0';
        if (e.line === undefined) e.line = line;
      }
      throw e;
    }
  }
}

export function runScript(script: Script, env: ExecEnv, o: RunOptions): ExecResult {
  return new Runner(env, o).run(script);
}
