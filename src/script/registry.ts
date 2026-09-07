/** 指令名到实现的表；未实现的指令首次调用记日志并返回 0。 */
import type { Expr } from './ast';
import type { Value } from './value';
import type { ScriptHost } from './host';
import type { ExecEnv, VarStore } from './interpreter';
import type { ScriptEngine } from './engine';

export interface CommandContext {
  host: ScriptHost;
  engine: ScriptEngine;
  env: ExecEnv;
  vars: VarStore;
  eval(e: Expr): Value;
  suppress: boolean;
  line: number;
  /** 当前循环的实体 id（states 循环为状态 typ）。 */
  loopId: Value;
  /** 在语句位置调用时为 false，表达式位置为 true。 */
  wantValue: boolean;
}

export type CommandFn = (ctx: CommandContext, args: Value[], raw: Expr[]) => Value | void;

export interface CommandEntry {
  fn: CommandFn;
  /** 为真时参数不预先求值，传空 args 与原始表达式。 */
  raw?: boolean;
}

export class CommandRegistry {
  private readonly table = new Map<string, CommandEntry>();
  private readonly reported = new Set<string>();

  register(names: string | string[], fn: CommandFn, opts: { raw?: boolean } = {}): void {
    for (const n of Array.isArray(names) ? names : [names]) this.table.set(n, { fn, raw: opts.raw });
  }

  get(name: string): CommandEntry | undefined {
    return this.table.get(name);
  }

  has(name: string): boolean {
    return this.table.has(name);
  }

  names(): string[] {
    return [...this.table.keys()];
  }

  unimplemented(name: string, log: ScriptHost['log']): Value {
    if (!this.reported.has(name)) {
      this.reported.add(name);
      log('warn', `script command not implemented: ${name}`);
    }
    return '0';
  }
}
