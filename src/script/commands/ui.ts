/** 界面、声音与脚本挂载类指令。 */
import type { CommandRegistry } from '../registry';
import { classId, int, num, str, bool } from './util';

export function registerUi(r: CommandRegistry): void {
  r.register('msg', (ctx, args) => {
    let font = int(args[1] ?? '0');
    if (font < 0 || font > 6) font = 0;
    ctx.host.message(args[0] ?? '', font, args.length >= 3 ? int(args[2]) : 3000);
  });
  r.register('msg_extend', (ctx, args) => { ctx.host.message(args[0] ?? '', 0, 3000); });
  r.register('speech', (ctx, args) => { ctx.host.speech(args[0] ?? ''); });
  r.register('play', (ctx, args) => { ctx.host.playSound(args[0] ?? '', args.length >= 2 ? num(args[1]) : 100); });
  r.register(['stopsounds', 'closemenu', 'music', 'stopmusic', 'fademusic', 'musicvolume', 'ambientsfx'], () => { /* 无声音后端时忽略 */ });
  r.register('process', (ctx, args) => {
    ctx.host.process(args[0] ?? '', args.length >= 2 ? int(args[1]) : 5000, args[2] ?? '');
  });
  r.register('addscript', (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    const source = args[next] ?? '';
    const text = source.includes('.') ? ctx.host.loadScriptFile(source.replace(/\\/g, '/'), args[next + 1]) : source;
    if (text === undefined) {
      ctx.host.log('warn', `addscript: 找不到脚本 ${source}`);
      return;
    }
    ctx.engine.addInstanceScript(cls, id, text, false, `addscript ${source}`);
  });
  r.register('extendscript', (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    const source = args[next] ?? '';
    const text = source.includes('.') ? ctx.host.loadScriptFile(source.replace(/\\/g, '/'), args[next + 1]) : source;
    if (text === undefined) {
      ctx.host.log('warn', `extendscript: 找不到脚本 ${source}`);
      return;
    }
    ctx.engine.addInstanceScript(cls, id, text, true, `extendscript ${source}`);
  });
  r.register('lockcombi', (ctx, args) => { ctx.host.locks.add(`combi:${(args[0] ?? '').trim()}`); });
  r.register('unlockcombi', (ctx, args) => { ctx.host.locks.delete(`combi:${(args[0] ?? '').trim()}`); });
  r.register('lockcombis', ctx => { for (const k of ctx.host.catalog.combis) ctx.host.locks.add(`combi:${k}`); });
  r.register('unlockcombis', ctx => { for (const k of ctx.host.catalog.combis) ctx.host.locks.delete(`combi:${k}`); });
  r.register('lockbuilding', (ctx, args) => { ctx.host.locks.add(`building:${int(args[0] ?? '0')}`); });
  r.register('unlockbuilding', (ctx, args) => { ctx.host.locks.delete(`building:${int(args[0] ?? '0')}`); });
  r.register('lockbuildings', ctx => { for (const id of ctx.host.catalog.buildings) ctx.host.locks.add(`building:${id}`); });
  r.register('unlockbuildings', ctx => { for (const id of ctx.host.catalog.buildings) ctx.host.locks.delete(`building:${id}`); });
  r.register('locked', (ctx, args) => {
    const v = (args[0] ?? '').trim();
    if (/^\d+$/.test(v)) return bool(ctx.host.locks.has(`building:${v}`));
    return bool(ctx.host.locks.has(`combi:${v}`));
  });
  r.register('builtat', (ctx, args) => str(ctx.host.builtAt(int(args[0] ?? '0'))));
  r.register('lastbuildingsite', ctx => str(ctx.host.lastBuildingSite()));
  r.register(['corona', 'flash', 'blur', 'particle', 'particlec', 'thunder', 'explosion', 'explode'], () => { /* 视觉效果不做 */ });
  r.register('freescript', (ctx, args) => {
    const { cls, id } = classId(ctx, args, 0);
    ctx.engine.removeInstanceScript(cls, id);
  });
}
