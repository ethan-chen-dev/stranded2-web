/** 实体查询与修改类指令。 */
import type { CommandRegistry, CommandContext } from '../registry';
import { behaviourCode } from '../../game/ai';
import { ScriptRuntimeError, toFloat, type Value } from '../value';
import { CLASS } from '../host';
import { classId, classOf, requireClass, int, num, str, flt, bool } from './util';

function dist(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  return Math.hypot(ax - bx, ay - by, az - bz);
}

export function registerEntity(r: CommandRegistry): void {
  r.register('create', (ctx, args) => {
    const cls = requireClass(args[0] ?? '', ctx.line);
    const typ = int(args[1] ?? '0');
    let x: number;
    let z: number;
    if (args.length >= 4) {
      x = num(args[2]); z = num(args[3]);
    } else {
      const p = ctx.host.entity(CLASS.unit, ctx.host.player().id);
      x = p?.x ?? 0; z = p?.z ?? 0;
    }
    const count = cls === CLASS.item && args.length >= 5 ? int(args[4]) : 1;
    const id = ctx.host.createEntity(cls, typ, x, z, count);
    return str(id < 0 ? 0 : id);
  });
  r.register('randomcreate', (ctx, args) => {
    const cls = requireClass(args[0] ?? '', ctx.line);
    const typ = int(args[1] ?? '0');
    const half = (ctx.host.mapSize() * 64) / 2 - 64;
    const yMin = args.length >= 3 ? num(args[2]) : -Infinity;
    const yMax = args.length >= 4 ? num(args[3]) : Infinity;
    const count = args.length >= 5 ? int(args[4]) : 1;
    for (let tries = 0; tries < 100; tries++) {
      const x = ctx.host.random(-half, half);
      const z = ctx.host.random(-half, half);
      const y = ctx.host.terrainY(x, z);
      if (y >= yMin && y <= yMax) {
        const id = ctx.host.createEntity(cls, typ, x, z, count);
        return str(id < 0 ? 0 : id);
      }
    }
    return '0';
  });
  r.register('free', (ctx, args) => {
    const c = (args[0] ?? '').trim().toLowerCase();
    if (c === 'particles') return;
    const { cls, id, next } = classId(ctx, args, 0);
    if (cls === CLASS.item && args.length > next) {
      ctx.host.freeEntity(cls, id, int(args[next]));
    } else {
      ctx.host.freeEntity(cls, id);
    }
  });
  r.register('exists', (ctx, args) => {
    const { cls, id } = classId(ctx, args, 0);
    return bool(!!ctx.host.entity(cls, id));
  });
  r.register('type', (ctx, args) => {
    const { cls, id } = classId(ctx, args, 0);
    return str(ctx.host.entity(cls, id)?.typ ?? 0);
  });
  r.register('name', (ctx, args) => {
    const cls = requireClass(args[0] ?? '', ctx.line);
    return ctx.host.def(cls, int(args[1] ?? '0'))?.name ?? '';
  });
  r.register('behaviour', (ctx, args) => {
    const cls = requireClass(args[0] ?? '', ctx.line);
    return ctx.host.def(cls, int(args[1] ?? '0'))?.behaviour ?? '';
  });
  const aiSource = (ctx: CommandContext, args: Value[], i: number): { cls: number; id: number } =>
    args[i] !== undefined ? classId(ctx, args, i) : { cls: ctx.env.cls, id: ctx.env.id };
  r.register('ai_signal', (ctx, args) => {
    const range = args[1] !== undefined && args[1] !== '' ? toFloat(args[1]) : 300;
    const src = aiSource(ctx, args, 2);
    return str(ctx.host.aiSignal(args[0] ?? '', src.cls, src.id, range));
  });
  r.register('ai_typesignal', (ctx, args) => {
    const range = args[2] !== undefined && args[2] !== '' ? toFloat(args[2]) : 300;
    const src = aiSource(ctx, args, 3);
    return str(ctx.host.aiSignal(args[0] ?? '', src.cls, src.id, range, int(args[1] ?? '0')));
  });
  r.register('ai_behavioursignal', (ctx, args) => {
    const range = args[2] !== undefined && args[2] !== '' ? toFloat(args[2]) : 300;
    const src = aiSource(ctx, args, 3);
    return str(ctx.host.aiSignal(args[0] ?? '', src.cls, src.id, range, undefined, behaviourCode(args[1] ?? '')));
  });
  r.register('ai_mode', (ctx, args) => {
    const target = args[2] !== undefined ? classId(ctx, args, 2) : { cls: 0, id: 0 };
    return bool(ctx.host.aiMode(int(args[0] ?? '0'), args[1] ?? '', target.cls, target.id));
  });
  r.register('ai_stay', (ctx, args) => { ctx.host.aiStay(int(args[0] ?? '0'), args[1] === undefined || int(args[1]) !== 0); });
  r.register('ai_center', (ctx, args) => { ctx.host.aiCenter(args[0] !== undefined ? int(args[0]) : ctx.env.id); });
  r.register('ai_eater', ctx => str(ctx.host.lastEater()));
  r.register('incskill', (ctx, args) => { ctx.host.skills.inc(args[0] ?? '', args[1] === undefined ? 1 : int(args[1]), args[2]); });
  r.register('skillvalue', (ctx, args) => str(ctx.host.skills.value(args[0] ?? '')));
  r.register('gotskill', (ctx, args) => bool(ctx.host.skills.has(args[0] ?? '')));
  r.register('skillname', (ctx, args) => { ctx.host.skills.setName(args[0] ?? '', args[1] ?? ''); });
  r.register('freeskill', (ctx, args) => bool(ctx.host.skills.free(args[0] ?? '')));
  const unitArg = (ctx: CommandContext, v: Value | undefined): number => (v === undefined || v === 'self' ? ctx.env.id : int(v));
  r.register('unitpath', (ctx, args) => { ctx.host.unitPath(unitArg(ctx, args[0]), args.slice(1).map(a => int(a))); });
  r.register('freeunitpath', (ctx, args) => { ctx.host.freeUnitPath(unitArg(ctx, args[0])); });
  r.register('starttrigger', (ctx, args) => { if (!ctx.host.setTrigger(unitArg(ctx, args[0]), true)) ctx.host.log('warn', `starttrigger: 信息点 ${args[0]} 不是触发器`); });
  r.register('stoptrigger', (ctx, args) => { if (!ctx.host.setTrigger(unitArg(ctx, args[0]), false)) ctx.host.log('warn', `stoptrigger: 信息点 ${args[0]} 不是触发器`); });
  r.register('stoptriggers', ctx => { ctx.host.stopTriggers(); });
  r.register('compare_behaviour', (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    const e = ctx.host.entity(cls, id);
    if (!e) return '0';
    return bool((ctx.host.def(cls, e.typ)?.behaviour ?? '').toLowerCase() === (args[next] ?? '').trim().toLowerCase());
  });
  r.register('compare_material', (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    const e = ctx.host.entity(cls, id);
    if (!e) return '0';
    return bool((ctx.host.def(cls, e.typ)?.mat ?? '').toLowerCase() === (args[next] ?? '').trim().toLowerCase());
  });
  const getter = (name: string, pick: (e: { x: number; y: number; z: number; yaw: number; pitch: number; roll: number }) => number) =>
    r.register(name, (ctx, args) => {
      const { cls, id } = classId(ctx, args, 0);
      const e = ctx.host.entity(cls, id);
      return e ? flt(pick(e)) : '0';
    });
  getter('getx', e => e.x);
  getter('gety', e => e.y);
  getter('getz', e => e.z);
  getter('getyaw', e => e.yaw);
  getter('getpitch', e => e.pitch);
  getter('getroll', e => e.roll);
  r.register('setpos', (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    ctx.host.setPosition(cls, id, num(args[next] ?? '0'), num(args[next + 1] ?? '0'), num(args[next + 2] ?? '0'));
  });
  r.register('setrot', (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    const e = ctx.host.entity(cls, id);
    const keep = (v: Value | undefined, cur: number) => (v === undefined || v.trim() === 'self' ? cur : num(v));
    ctx.host.setRotation(cls, id, keep(args[next], e?.pitch ?? 0), keep(args[next + 1], e?.yaw ?? 0), keep(args[next + 2], e?.roll ?? 0));
  });
  r.register('count', (ctx, args) => {
    const cls = requireClass(args[0] ?? '', ctx.line);
    return str(ctx.host.entities(cls, int(args[1] ?? '0') || undefined).length);
  });
  const centerOf = (ctx: Parameters<Parameters<CommandRegistry['register']>[1]>[0], args: Value[], i: number) => {
    if (args.length > i) {
      const { cls, id } = classId(ctx, args, i);
      const e = ctx.host.entity(cls, id);
      if (e) return e;
    }
    return ctx.host.entity(CLASS.unit, ctx.host.player().id) ?? { x: 0, y: 0, z: 0 };
  };
  r.register('count_inrange', (ctx, args) => {
    const cls = requireClass(args[0] ?? '', ctx.line);
    const typ = int(args[1] ?? '0');
    const radius = num(args[2] ?? '100');
    const c = centerOf(ctx, args, 3);
    return str(ctx.host.entities(cls, typ || undefined).filter(e => dist(e.x, e.y, e.z, c.x, c.y, c.z) <= radius).length);
  });
  r.register('count_behaviourinrange', (ctx, args) => {
    const cls = requireClass(args[0] ?? '', ctx.line);
    const beh = (args[1] ?? '').trim().toLowerCase();
    const radius = num(args[2] ?? '100');
    const c = centerOf(ctx, args, 3);
    return str(ctx.host.entities(cls).filter(e => (ctx.host.def(cls, e.typ)?.behaviour ?? '').toLowerCase() === beh && dist(e.x, e.y, e.z, c.x, c.y, c.z) <= radius).length);
  });
  r.register('inrange', (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    const e = ctx.host.entity(cls, id);
    if (!e) return '0';
    const radius = num(args[next] ?? '100');
    const c = centerOf(ctx, args, next + 1);
    return bool(dist(e.x, e.y, e.z, c.x, c.y, c.z) <= radius);
  });
  r.register('distance', (ctx, args) => {
    const a = classId(ctx, args, 0);
    const b = classId(ctx, args, a.next);
    const ea = ctx.host.entity(a.cls, a.id);
    const eb = ctx.host.entity(b.cls, b.id);
    if (!ea || !eb) return '0';
    return flt(dist(ea.x, ea.y, ea.z, eb.x, eb.y, eb.z));
  });
  r.register('playerdistance', (ctx, args) => {
    const { cls, id } = classId(ctx, args, 0);
    const e = ctx.host.entity(cls, id);
    const p = ctx.host.entity(CLASS.unit, ctx.host.player().id);
    if (!e || !p) return '0';
    return flt(dist(e.x, e.y, e.z, p.x, p.y, p.z));
  });
  r.register('health', (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    if (args.length > next) return flt(ctx.host.changeHealth(cls, id, num(args[next]), false));
    return flt(ctx.host.entity(cls, id)?.health ?? 0);
  });
  r.register('maxhealth', (ctx, args) => {
    const { cls, id } = classId(ctx, args, 0);
    return flt(ctx.host.entity(cls, id)?.healthMax ?? 0);
  });
  r.register('damage', (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    ctx.host.changeHealth(cls, id, -num(args[next] ?? '0'), true);
  });
  r.register(['heal', 'repair'], (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    ctx.host.changeHealth(cls, id, num(args[next] ?? '0'), false);
  });
  r.register('lives', (ctx, args) => {
    const { cls, id } = classId(ctx, args, 0);
    const e = ctx.host.entity(cls, id);
    return bool(!!e && e.health > 0);
  });
  r.register('kill', (ctx, args) => {
    const id = int(args[0] ?? '0');
    const e = ctx.host.entity(CLASS.unit, id);
    if (e) ctx.host.changeHealth(CLASS.unit, id, -e.health - 1, true);
  });
  const inArea = (typ: number) => (ctx: Parameters<Parameters<CommandRegistry['register']>[1]>[0], args: Value[]) => {
    const { cls, id } = classId(ctx, args, 0);
    const e = ctx.host.entity(cls, id);
    if (!e) return '0';
    for (const info of ctx.host.entities(CLASS.info, typ)) {
      if (Math.hypot(info.x - e.x, info.z - e.z) - ctx.host.infoRadius(info.id) <= 0) return '1';
    }
    return '0';
  };
  r.register('inarea_freshwater', inArea(41));
  r.register('inarea_dig', inArea(42));
  r.register('inarea_fish', inArea(43));
  r.register('inarea', inArea(44));
  r.register(['spawntimer', 'growtime', 'defparam'], () => '0');
  void classOf; void ScriptRuntimeError;
}
