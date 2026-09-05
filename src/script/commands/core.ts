/** 基本、变量、数学、字符串、环境、定时器类指令。 */
import type { Expr } from '../ast';
import type { CommandRegistry } from '../registry';
import { ScriptRuntimeError, toInt, toFloat, fromNumber, type Value } from '../value';
import { CLASS } from '../host';
import { classId, classOf, int, num, str, flt, bool } from './util';

function varName(e: Expr | undefined, v: Value | undefined): string {
  if (e?.kind === 'var') return e.name;
  const s = (v ?? '').trim();
  return s.startsWith('$') ? s.slice(1) : s;
}

export function registerCore(r: CommandRegistry): void {
  r.register('local', (ctx, _args, raw) => {
    for (const e of raw) ctx.vars.declareLocal(ctx.env, varName(e, e.kind === 'str' ? ctx.eval(e) : undefined));
  }, { raw: true });
  r.register('temp', (ctx, _args, raw) => {
    for (const e of raw) ctx.vars.temps.add(varName(e, e.kind === 'str' ? ctx.eval(e) : undefined));
  }, { raw: true });
  r.register('tempall', ctx => { for (const k of ctx.vars.globals.keys()) ctx.vars.temps.add(k); });
  r.register(['freevar', 'unset'], (ctx, _args, raw) => {
    for (const e of raw) ctx.vars.free(ctx.env, varName(e, e.kind === 'str' ? ctx.eval(e) : undefined));
  }, { raw: true });
  r.register('freevars', (ctx, args) => {
    ctx.vars.freeGlobals();
    if (int(args[0] ?? '0')) ctx.vars.freeLocalsOf(ctx.env.cls, ctx.env.id);
  });
  r.register('varexists', (ctx, args) => bool(ctx.vars.exists(ctx.env, varName(undefined, args[0]))));
  r.register('rename', (ctx, args) => { ctx.vars.rename(ctx.env, varName(undefined, args[0]), varName(undefined, args[1])); });
  r.register('getlocal', (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    return ctx.vars.getLocal(cls, id, varName(undefined, args[next]));
  });
  r.register('setlocal', (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    ctx.vars.setLocal(cls, id, varName(undefined, args[next]), args[next + 1] ?? '0');
  });

  r.register('loop_id', ctx => ctx.loopId);
  r.register('echo', (ctx, args) => { ctx.host.log('info', args.join(' ')); });
  r.register('debug', () => '0');
  r.register('event', (ctx, args) => {
    const event = args[0] ?? '';
    if (args.length <= 1) {
      ctx.engine.entityEvent(ctx.env.cls, ctx.env.id, event, 'triggered by event command');
      return;
    }
    if (args[1].trim().toLowerCase() === 'global') {
      ctx.engine.globalEvent(event, 'triggered by event command');
      return;
    }
    const { cls, id } = classId(ctx, args, 1);
    ctx.engine.entityEvent(cls, id, event, 'triggered by event command');
  });
  r.register(['currentclass', 'cclass', 'current_class'], ctx => str(ctx.env.cls));
  r.register(['currentid', 'cid', 'current_id'], ctx => str(ctx.env.id));
  r.register('gt', ctx => str(Math.floor(ctx.host.now())));

  r.register('random', (ctx, args) => {
    const a = int(args[0] ?? '1');
    if (args.length >= 2) {
      const b = int(args[1]);
      return str(ctx.host.random(Math.min(a, b), Math.max(a, b)));
    }
    return str(a >= 1 ? ctx.host.random(1, a) : ctx.host.random(a, 1));
  });
  r.register('int', (_ctx, args) => str(int(args[0] ?? '0')));
  r.register('abs', (_ctx, args) => (typeOfNumber(args[0] ?? '0') === 'int' ? str(Math.abs(int(args[0]))) : flt(Math.abs(num(args[0])))));
  r.register('sin', (_ctx, args) => flt(Math.sin((num(args[0] ?? '0') * Math.PI) / 180)));
  r.register('cos', (_ctx, args) => flt(Math.cos((num(args[0] ?? '0') * Math.PI) / 180)));
  r.register('tan', (_ctx, args) => flt(Math.tan((num(args[0] ?? '0') * Math.PI) / 180)));

  r.register('length', (_ctx, args) => str((args[0] ?? '').length));
  r.register('trim', (_ctx, args) => (args[0] ?? '').trim());
  r.register('replace', (_ctx, args) => (args[0] ?? '').split(args[1] ?? '').join(args[2] ?? ''));
  r.register('split', (_ctx, args) => {
    const parts = (args[0] ?? '').split(args[1] ?? ',');
    const i = int(args[2] ?? '1');
    return parts[i - 1] ?? '';
  });
  r.register('extract', (_ctx, args) => {
    const s = args[0] ?? '';
    const start = Math.max(int(args[1] ?? '1') - 1, 0);
    return args.length >= 3 ? s.substr(start, int(args[2])) : s.slice(start);
  });
  r.register('join', (_ctx, args) => args.join(''));

  r.register('day', ctx => str(ctx.host.time().day));
  r.register('hour', ctx => str(ctx.host.time().hour));
  r.register('minute', ctx => str(ctx.host.time().minute));
  r.register('setday', (ctx, args) => { ctx.host.setTime(int(args[0] ?? '1')); });
  r.register('sethour', (ctx, args) => { ctx.host.setTime(undefined, int(args[0] ?? '0')); });
  r.register('setminute', (ctx, args) => { ctx.host.setTime(undefined, undefined, int(args[0] ?? '0')); });
  r.register('use_x', ctx => flt(ctx.host.useTarget().x));
  r.register('use_y', ctx => flt(ctx.host.useTarget().y));
  r.register('use_z', ctx => flt(ctx.host.useTarget().z));
  r.register('terrainy', (ctx, args) => flt(ctx.host.terrainY(num(args[0] ?? '0'), num(args[1] ?? '0'))));
  r.register('mapsize', ctx => str(ctx.host.mapSize()));

  r.register('timer', (ctx, args) => {
    let cls: number;
    let id: number;
    let i: number;
    const c = (args[0] ?? '').trim().toLowerCase();
    if (c === 'self' || c === '-1') {
      cls = ctx.env.cls; id = ctx.env.id; i = 1;
    } else if (c === '0' || c === 'global') {
      cls = CLASS.global; id = 0; i = 1;
    } else {
      const k = classOf(c);
      if (k === undefined) throw new ScriptRuntimeError(`'${args[0]}' is no valid class`, ctx.line);
      cls = k; id = int(args[1] ?? '0'); i = 2;
    }
    const duration = int(args[i] ?? '1000');
    const mode = args.length > i + 1 ? int(args[i + 1]) : 1;
    let source = args.length > i + 2 ? args[i + 2] : 'timer';
    let isScript = false;
    if (source.includes('.')) {
      const text = ctx.host.loadScriptFile(source.replace(/\\/g, '/'));
      if (text !== undefined) { source = text; isScript = true; }
    }
    ctx.engine.timers.add({ cls, id, duration, start: ctx.host.now(), mode, source, isScript });
  });
  r.register('freetimers', (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    return str(ctx.engine.timers.free(cls, id, args[next]));
  });
  r.register('timercount', (ctx, args) => {
    const { cls, id } = classId(ctx, args, 0);
    return str(ctx.engine.timers.count(cls, id));
  });

  r.register(['skip', 'skipevent', 'exit'], () => { /* 由语法分析处理 */ });
  void toFloat; void fromNumber; void toInt;
}

function typeOfNumber(v: Value): 'int' | 'float' {
  return /^-?\d+$/.test(v.trim()) ? 'int' : 'float';
}
