/** 界面、声音与脚本挂载类指令。 */
import type { CommandRegistry, CommandContext } from '../registry';
import { classId, int, num, str, bool, requireClass } from './util';
import type { Value } from '../value';
import { parseFlags } from '../../game/takeover';
import { CLASS } from '../host';

export function registerUi(r: CommandRegistry): void {
  r.register('msg', (ctx, args) => {
    let font = int(args[1] ?? '0');
    if (font < 0 || font > 6) font = 0;
    ctx.host.message(args[0] ?? '', font, args.length >= 3 ? int(args[2]) : 3000);
  });
  r.register('speech', (ctx, args) => { ctx.host.speech(args[0] ?? ''); });
  r.register('play', (ctx, args) => { ctx.host.playSound(args[0] ?? '', args.length >= 2 ? num(args[1]) : 100); });
  r.register(['stopsounds', 'ambientsfx'], () => { /* 无声音后端时忽略 */ });
  r.register('music', (ctx, args) => {
    ctx.host.music(args[0] ?? '', args[1] === undefined ? 1 : num(args[1]));
    if (args[2] !== undefined) ctx.host.fadeMusic(Math.abs(num(args[2])));
  });
  r.register('stopmusic', ctx => { ctx.host.stopMusic(); });
  r.register('fademusic', (ctx, args) => { ctx.host.fadeMusic(Math.abs(num(args[0] ?? '1000'))); });
  r.register('musicvolume', (ctx, args) => { ctx.host.musicVolume(num(args[0] ?? '1')); });
  r.register('process', (ctx, args) => {
    ctx.host.process(args[0] ?? '', args.length >= 2 ? int(args[1]) : 5000, args[2] ?? '');
  });
  r.register('addscript', (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    const source = args[next] ?? '';
    const text = source.includes('.') || /^\d+$/.test(source.trim()) ? ctx.host.textSource(source, args[next + 1]) : source;
    if (text === undefined) {
      ctx.host.log('warn', `addscript: script ${source} not found`);
      return;
    }
    ctx.engine.addInstanceScript(cls, id, text, false, `addscript ${source}`);
  });
  r.register('extendscript', (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    const source = args[next] ?? '';
    const text = source.includes('.') || /^\d+$/.test(source.trim()) ? ctx.host.textSource(source, args[next + 1]) : source;
    if (text === undefined) {
      ctx.host.log('warn', `extendscript: script ${source} not found`);
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
    if (text === undefined) ctx.host.log('warn', `text source ${source}${section ? ` section ${section}` : ''} not found`);
    return text;
  };
  /** 把文本接到当前消息框或对话正文后面；无参数时用缓冲区。 */
  r.register('msg_extend', (ctx, args) => {
    const text = sourceText(ctx, args[0], args[1]);
    if (text) ctx.host.extendMessage(text);
  });
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
      ctx.host.log('warn', `cannot open dialogue ${args[0]} from ${args[1]}`);
    }
  });
  r.register('text', (ctx, args) => {
    const id = int(args[0] ?? '0');
    if (args.length <= 1) { ctx.host.uiText(id, '', 0); return; }
    const font = int(args[2] ?? '0');
    if (args.length >= 5) ctx.host.uiText(id, args[1], font, num(args[3]), num(args[4]), args[5] === undefined ? 1 : int(args[5]));
    else ctx.host.uiText(id, args[1], font);
  });
  r.register('freetext', (ctx, args) => { ctx.host.uiText(int(args[0] ?? '0'), '', 0); });
  /**
   * button id,text[,icon[,source[,section]]]：对话里的第 id 个按钮。source 为数字取信息点文本，
   * 带扩展名的取文件，否则本身就是目标（页名或 action:/script:/event:）；省略时取缓冲区。
   */
  r.register('button', (ctx, args) => {
    const id = int(args[0] ?? '0');
    const source = args[3];
    let target: string | undefined;
    if (source === undefined) target = ctx.host.buffer.take();
    else if (int(source) !== 0 || source.includes('.')) target = sourceText(ctx, source, args[4]);
    else target = source;
    if (target) ctx.host.dialogueButton(id, args[1] ?? '', target);
  });
  r.register('freebutton', (ctx, args) => { ctx.host.freeDialogueButton(int(args[0] ?? '0')); });
  /** cracklock title,mode,code：撬锁小游戏，结果以 cracklock_success / cracklock_failure 事件发给当前实体。 */
  r.register('cracklock', (ctx, args) => {
    ctx.host.crackLock(args[0] ?? '', int(args[1] ?? '1'), String(args[2] ?? '').toLowerCase(), ctx.env.cls, ctx.env.id);
  });
  r.register('image', (ctx, args) => {
    ctx.host.uiImage(int(args[0] ?? '0'), args[1] ?? '', num(args[2] ?? '0'), num(args[3] ?? '0'));
  });
  r.register('loadmap', (ctx, args) => { ctx.host.loadMap(args[0] ?? '', parseFlags(args.slice(1).map(String))); });
  r.register('loadmaptakeover', ctx => bool(ctx.host.loadMapTakeover()));
  r.register('quit', ctx => { ctx.host.quit(); });
  r.register('credits', ctx => { ctx.host.credits(); });
  r.register('extendentry', (ctx, args) => {
    const text = sourceText(ctx, args[1], args[2]);
    const entry = ctx.host.diary.find(e => e.title === (args[0] ?? ''));
    if (text !== undefined && entry) entry.text = `${entry.text}\n${text}`;
  });
  r.register('showentry', (ctx, args) => { ctx.host.showEntry(args[0] ?? ''); });
  r.register('freediary', ctx => { ctx.host.diary.splice(0, ctx.host.diary.length); });
  const defCommand = (apply: (ctx: CommandContext, cls: number, typ: number, text: string) => void) => (ctx: CommandContext, args: Value[]) => {
    const cls = requireClass(args[0] ?? '');
    const typ = int(args[1] ?? '0');
    const text = args[2] === undefined ? '' : ctx.host.textSource(String(args[2]), args[3] === undefined ? undefined : String(args[3]));
    if (text === undefined) { ctx.host.log('warn', `script source ${args[2]} not found`); return; }
    apply(ctx, cls, typ, text);
  };
  r.register('def_override', defCommand((ctx, cls, typ, text) => ctx.engine.setTypeScript(cls, typ, text, `def_override ${cls}:${typ}`)));
  r.register('def_extend', defCommand((ctx, cls, typ, text) => ctx.engine.extendTypeScript(cls, typ, text, `def_extend ${cls}:${typ}`)));
  r.register('def_free', (ctx, args) => { ctx.engine.freeTypeScript(requireClass(args[0] ?? ''), int(args[1] ?? '0')); });
  r.register('exchange', (ctx, args) => {
    const { cls, id, next } = classId(ctx, args, 0);
    const allowStore = args[next] === undefined || int(args[next]) !== 0;
    ctx.host.exchange(cls, id, allowStore, args.slice(next + 1).map(a => int(a)).filter(t => t > 0));
  });
  r.register('inview', (ctx, args) => { const { cls, id } = classId(ctx, args, 0); return bool(ctx.host.inView(cls, id)); });
  r.register('getweather', () => '0');
  /** 外观指令的实体参数在前面的值之后：省略时为当前实体。 */
  const look = (ctx: CommandContext, args: Value[], at: number, value: Parameters<CommandContext['host']['setLook']>[2], name: string) => {
    const { cls, id } = classId(ctx, args, at);
    if (!ctx.host.setLook(cls, id, value)) ctx.host.log('warn', `${name}: no model for ${cls}:${id}`);
  };
  /** 原版只允许给物体和物品换模型。 */
  r.register('model', (ctx, args) => {
    const { cls } = classId(ctx, args, 1);
    if (cls === CLASS.object || cls === CLASS.item) look(ctx, args, 1, { model: String(args[0] ?? '') }, 'model');
  });
  r.register('scale', (ctx, args) => { look(ctx, args, 3, { scale: [num(args[0] ?? '1'), num(args[1] ?? '1'), num(args[2] ?? '1')] }, 'scale'); });
  r.register('fx', (ctx, args) => { look(ctx, args, 1, { fx: int(args[0] ?? '0') }, 'fx'); });
  r.register('color', (ctx, args) => { look(ctx, args, 3, { color: [int(args[0] ?? '255'), int(args[1] ?? '255'), int(args[2] ?? '255')] }, 'color'); });
  /** skycolor mode[,r,g,b[,mix]]：mode 1 用覆盖色，0 恢复昼夜颜色。 */
  r.register('skycolor', (ctx, args) => {
    if (int(args[0] ?? '0') !== 1) { ctx.host.skyColor(null); return; }
    ctx.host.skyColor({ color: [int(args[1] ?? '0'), int(args[2] ?? '0'), int(args[3] ?? '0')], mix: int(args[4] ?? '0') });
  });
  r.register(['blend', 'vomit', 'showindicator', 'hidden', 'wateralpha', 'watertexture'], () => { /* 视觉效果不做 */ });
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
