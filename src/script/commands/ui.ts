/** 界面、声音与脚本挂载类指令。 */
import type { CommandRegistry, CommandContext } from '../registry';
import { classId, int, num, str, bool } from './util';
import type { Value } from '../value';

export function registerUi(r: CommandRegistry): void {
  r.register('msg', (ctx, args) => {
    let font = int(args[1] ?? '0');
    if (font < 0 || font > 6) font = 0;
    ctx.host.message(args[0] ?? '', font, args.length >= 3 ? int(args[2]) : 3000);
  });
  r.register('msg_extend', (ctx, args) => { ctx.host.message(args[0] ?? '', 0, 3000); });
  r.register('speech', (ctx, args) => { ctx.host.speech(args[0] ?? ''); });
  r.register('play', (ctx, args) => { ctx.host.playSound(args[0] ?? '', args.length >= 2 ? num(args[1]) : 100); });
  r.register(['stopsounds', 'music', 'stopmusic', 'fademusic', 'musicvolume', 'ambientsfx'], () => { /* 无声音后端时忽略 */ });
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
  r.register('closemenu', ctx => { ctx.host.closeMenu(); });
  r.register('menu', ctx => str(ctx.host.menuId()));
  r.register('loadfile', (ctx, args) => {
    const text = ctx.host.textSource(args[0] ?? '', args[1]) ?? '';
    ctx.host.buffer.set(text);
    return text;
  });
  r.register('buffer', ctx => ctx.host.buffer.value);
  r.register('clear', ctx => { ctx.host.buffer.clear(); });
  r.register('add', (ctx, args) => { ctx.host.buffer.add(args.join('')); });
  const sourceText = (ctx: CommandContext, source: Value | undefined, section: Value | undefined): string | undefined => {
    if (source === undefined || source === '') return ctx.host.buffer.take();
    const text = ctx.host.textSource(String(source), section === undefined ? undefined : String(section));
    if (text === undefined) ctx.host.log('warn', `找不到文本来源 ${source}${section ? ` 段 ${section}` : ''}`);
    return text;
  };
  r.register('msgbox', (ctx, args) => {
    const text = sourceText(ctx, args[1], args[2]);
    if (text !== undefined) ctx.host.msgbox(args[0] ?? '', text);
  });
  r.register('diary', (ctx, args) => {
    const text = sourceText(ctx, args[1], args[2]);
    if (text !== undefined) ctx.host.diary.push({ title: args[0] ?? '', text });
  });
  r.register('dialogue', (ctx, args) => {
    if (!ctx.host.dialogue(args[0] ?? '', args[1] ?? '', args[2] === undefined ? undefined : String(args[2]))) {
      ctx.host.log('warn', `对话 ${args[0]} 打不开：${args[1]}`);
    }
  });
  r.register('text', (ctx, args) => {
    const id = int(args[0] ?? '0');
    if (args.length <= 1) { ctx.host.uiText(id, '', 0); return; }
    const font = int(args[2] ?? '0');
    if (args.length >= 5) ctx.host.uiText(id, args[1], font, num(args[3]), num(args[4]), args[5] === undefined ? 1 : int(args[5]));
    else ctx.host.uiText(id, args[1], font);
  });
  r.register('image', (ctx, args) => {
    ctx.host.uiImage(int(args[0] ?? '0'), args[1] ?? '', num(args[2] ?? '0'), num(args[3] ?? '0'));
  });
  r.register('seqstart', (ctx, args) => { ctx.host.seq()?.start(int(args[0] ?? '1'), int(args[1] ?? '0')); });
  r.register('seqtimemode', (ctx, args) => { ctx.host.seq()?.timeMode(num(args[0] ?? '1'), int(args[1] ?? '1')); });
  const SEQ_EVENTS: [string | string[], string][] = [
    ['seqend', 'end'], ['seqmsg', 'msg'], ['seqmsgclear', 'msgclear'], ['seqsound', 'sound'], ['seqbar', 'bar'],
    ['hidbar', 'hidebar'], ['showbar', 'showbar'], ['seqflash', 'flash'], ['seqfade', 'fade'], ['seqcls', 'cls'],
    ['seqimage', 'image'], ['seqimagetext', 'itxt'], ['seqevent', 'event'], ['seqscript', 'script'],
    ['seqhideplayer', 'hideplayer'], [['setcam', 'sc'], 'setcam'], [['movecam', 'mc'], 'movecam'],
    ['campath', 'campath'], ['timedcampath', 'timedcampath'], ['cammode', 'cammode'], ['camfollow', 'camfollow'],
  ];
  for (const [names, kind] of SEQ_EVENTS) {
    r.register(names, (ctx, args) => { ctx.host.seq()?.add(kind, args.map(String), ctx.env.cls, ctx.env.id); });
  }
  r.register('freescript', (ctx, args) => {
    const { cls, id } = classId(ctx, args, 0);
    ctx.engine.removeInstanceScript(cls, id);
  });
}
