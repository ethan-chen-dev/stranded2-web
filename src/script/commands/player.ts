/** 玩家数值与物品/背包类指令。 */
import type { CommandRegistry } from '../registry';
import { CLASS } from '../host';
import { classId, int, num, str, bool, flt } from './util';

export function registerPlayer(r: CommandRegistry): void {
  r.register(['eat', 'drink', 'consume'], (ctx, args) => {
    if (ctx.env.cls === CLASS.item) ctx.host.freeEntity(CLASS.item, ctx.env.id, 1);
    if (args.length === 0) return;
    ctx.host.playerConsume(num(args[0] ?? '0'), num(args[1] ?? '0'), num(args[2] ?? '0'), num(args[3] ?? '0'), args.length >= 5 ? int(args[4]) : undefined);
  });
  r.register('fry', ctx => { ctx.host.playSound('fizzle.wav', 100); });
  r.register('jade', (ctx, args) => {
    const v = num(args[0] ?? '0');
    ctx.host.playerConsume(0, -v, -v, -v);
  });
  r.register('getplayervalue', (ctx, args) => {
    const p = ctx.host.player();
    switch (int(args[0] ?? '0')) {
      case 0: return str(p.health);
      case 1: return str(p.hunger);
      case 2: return str(p.thirst);
      case 3: return str(p.exhaustion);
      default: return '0';
    }
  });
  r.register(['player_speed', 'player_damage', 'player_attackrange', 'player_maxweight', 'player_mat', 'player_ammo'], (ctx, args) => {
    ctx.host.log('info', `player attribute command logged only: ${args.join(',')}`);
  });

  r.register('find', (ctx, args) => {
    const typ = int(args[0] ?? '0');
    const count = args.length >= 2 ? int(args[1]) : 1;
    const stored = ctx.host.giveItem(typ, count);
    const name = ctx.host.def(CLASS.item, typ)?.name ?? `#${typ}`;
    if (stored > 0) {
      ctx.host.message(`Collected ${name} (${stored})`, 1, 3000);
      ctx.host.playSound('collect.wav', 100);
    }
    return str(stored);
  });
  r.register('store', (ctx, args) => {
    let itemId = int(args[0] ?? '0');
    if ((args[0] ?? '').trim() === 'self' && ctx.env.cls === CLASS.item) itemId = ctx.env.id;
    const { cls, id } = classId(ctx, args, 1);
    return str(ctx.host.storeItem(itemId, cls, id));
  });
  r.register('unstore', (ctx, args) => {
    let itemId = int(args[0] ?? '0');
    if ((args[0] ?? '').trim() === 'self' && ctx.env.cls === CLASS.item) itemId = ctx.env.id;
    const count = args.length >= 2 ? int(args[1]) : (ctx.host.entity(CLASS.item, itemId)?.count ?? 1);
    return str(ctx.host.unstoreItem(itemId, count));
  });
  const storedIn = (ctx: Parameters<Parameters<CommandRegistry['register']>[1]>[0], cls: number, id: number, typ?: number) =>
    ctx.host.entities(CLASS.item).filter(e => e.parentClass === cls && e.parentId === id && e.parentMode === 1 && (typ === undefined || e.typ === typ));
  r.register('freestored', (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    const typArg = args[next];
    if (typArg === undefined || typArg.trim().toLowerCase() === 'all') {
      for (const e of storedIn(ctx, cls, id)) ctx.host.freeEntity(CLASS.item, e.id);
      return;
    }
    const count = args.length > next + 1 ? int(args[next + 1]) : undefined;
    const first = storedIn(ctx, cls, id, int(typArg))[0];
    if (first) ctx.host.freeEntity(CLASS.item, first.id, count);
  });
  r.register(['setamount', 'setcount'], (ctx, args) => {
    const e = ctx.host.entity(CLASS.item, int(args[0] ?? '0'));
    if (e) e.count = Math.max(int(args[1] ?? '1'), 0);
    if (e && e.count === 0) ctx.host.freeEntity(CLASS.item, e.id);
  });
  r.register('getamount', (ctx, args) => str(ctx.host.entity(CLASS.item, int(args[0] ?? '0'))?.count ?? 0));
  r.register('getstored', (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    const typ = args.length > next ? int(args[next]) : undefined;
    return str(storedIn(ctx, cls, id, typ)[0]?.id ?? 0);
  });
  r.register('count_stored', (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    const typ = args.length > next ? int(args[next]) : undefined;
    return str(storedIn(ctx, cls, id, typ).reduce((s, e) => s + e.count, 0));
  });
  r.register('playergotitem', (ctx, args) => {
    const typ = int(args[0] ?? '0');
    return str(storedIn(ctx, CLASS.unit, ctx.host.player().id, typ).reduce((s, e) => s + e.count, 0));
  });
  r.register('alteritem', (ctx, args) => {
    const need = int(args[0] ?? '1');
    const typ = int(args[1] ?? '0');
    const newCount = args.length >= 3 ? int(args[2]) : 1;
    const newTyp = args.length >= 4 ? int(args[3]) : 0;
    const playerId = ctx.host.player().id;
    if (newTyp === 0) {
      const self = ctx.env.cls === CLASS.item ? ctx.host.entity(CLASS.item, ctx.env.id) : undefined;
      if (!self || self.count < need) return;
      ctx.host.freeEntity(CLASS.item, self.id, need);
      ctx.host.giveItem(typ, newCount);
      return;
    }
    const src = storedIn(ctx, CLASS.unit, playerId, typ)[0];
    if (!src || src.count < need) return;
    ctx.host.freeEntity(CLASS.item, src.id, need);
    ctx.host.giveItem(newTyp, newCount);
  });
  r.register('impact_class', ctx => str(ctx.host.impact()?.cls ?? 0));
  r.register('impact_id', ctx => str(ctx.host.impact()?.id ?? 0));
  r.register('impact_kill', ctx => bool(ctx.host.impact()?.kill ?? false));
  r.register('impact_ground', ctx => bool(ctx.host.impact()?.ground ?? false));
  r.register(['impact_first', 'impact_amount'], ctx => (ctx.host.impact() ? '1' : '0'));
  r.register('impact_x', ctx => flt(ctx.host.impact()?.x ?? 0));
  r.register('impact_y', ctx => flt(ctx.host.impact()?.y ?? 0));
  r.register('impact_z', ctx => flt(ctx.host.impact()?.z ?? 0));
  r.register('hit_damage', ctx => flt(ctx.host.impact()?.damage ?? 0));
  r.register(['hit_weapon', 'getplayerweapon'], ctx => str(ctx.host.playerWeapon()));
  r.register('hit_ammo', () => '0');
  r.register('player_weapon', (ctx, args) => bool(ctx.host.setPlayerWeapon(int(args[0] ?? '0'))));
  r.register('parent_class', (ctx, args) => {
    const id = (args[0] ?? '').trim() === 'self' ? ctx.env.id : int(args[0] ?? '0');
    return str(ctx.host.entity(CLASS.item, id)?.parentClass ?? 0);
  });
  r.register('parent_id', (ctx, args) => {
    const id = (args[0] ?? '').trim() === 'self' ? ctx.env.id : int(args[0] ?? '0');
    return str(ctx.host.entity(CLASS.item, id)?.parentId ?? 0);
  });
  void bool;
}
