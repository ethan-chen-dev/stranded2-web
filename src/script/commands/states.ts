/** 状态类指令。 */
import type { CommandRegistry } from '../registry';
import { ScriptRuntimeError } from '../value';
import { classId, int, str, bool } from './util';

export function registerStates(r: CommandRegistry): void {
  const typOf = (ctx: Parameters<Parameters<CommandRegistry['register']>[1]>[0], v: string | undefined) => {
    const t = ctx.engine.stateType(v ?? '');
    if (t < 0) throw new ScriptRuntimeError(`'${v}' is no valid state`, ctx.line);
    return t;
  };
  r.register('addstate', (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    const typ = typOf(ctx, args[next]);
    if (ctx.engine.states.has(cls, id, typ)) return '0';
    ctx.engine.states.add(cls, id, typ);
    ctx.engine.entityEvent(cls, id, 'addstate', String(typ));
    return '1';
  });
  r.register('freestate', (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    const typ = args.length > next ? typOf(ctx, args[next]) : undefined;
    const removed = ctx.engine.states.free(cls, id, typ);
    for (const s of removed) ctx.engine.entityEvent(cls, id, 'freestate', String(s.typ));
    return str(removed.length);
  });
  r.register('gotstate', (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    return bool(ctx.engine.states.has(cls, id, typOf(ctx, args[next])));
  });
  r.register('count_state', (ctx, args) => str(ctx.engine.states.count(typOf(ctx, args[0]))));
  r.register('statevalue', (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    const rec = ctx.engine.states.find(cls, id, typOf(ctx, args[next]));
    if (rec) rec.value = args[next + 1] ?? '0';
  });
  r.register('getstatevalue', (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    return ctx.engine.states.find(cls, id, typOf(ctx, args[next]))?.value ?? '0';
  });
  r.register('statecolor', (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    const rec = ctx.engine.states.find(cls, id, typOf(ctx, args[next]));
    if (rec) rec.color = [int(args[next + 1] ?? '255'), int(args[next + 2] ?? '255'), int(args[next + 3] ?? '255')];
  });
  r.register('statesize', (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    const rec = ctx.engine.states.find(cls, id, typOf(ctx, args[next]));
    if (rec) rec.size = int(args[next + 1] ?? '1');
  });
  r.register('state', ctx => (ctx.env.cls === 5 ? str(ctx.env.id) : '0'));
}
