/** 界面、声音与脚本挂载类指令。 */
import type { CommandRegistry } from '../registry';
import { classId, int, num } from './util';

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
  r.register('freescript', (ctx, args) => {
    const { cls, id } = classId(ctx, args, 0);
    ctx.engine.removeInstanceScript(cls, id);
  });
}
