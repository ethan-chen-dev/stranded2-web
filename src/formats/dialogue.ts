/**
 * 对话文件：按行 key=value，`#` 开头为注释；`page=名称` 开启一页直到下一个 page。
 * 页内 title、text=start…end、button=目标,文字、ibutton=图标,目标,文字、script=start…end、
 * trade=start…end（sell=/buy=typ[,count]）。规则来自原版 parser_dialogue.bb。
 */

export interface DialogueButton {
  /** 页名，或 action:close、script:代码、event:名称。 */
  target: string;
  text: string;
  icon: string;
}

export interface DialogueTrade {
  sell: { typ: number; count: number }[];
  buy: { typ: number; count: number }[];
}

export interface DialoguePage {
  name: string;
  title: string;
  text: string;
  script: string;
  buttons: DialogueButton[];
  trades: DialogueTrade[];
}

export const MAX_BUTTONS = 10;

export function parseDialogue(source: string): Map<string, DialoguePage> {
  const pages = new Map<string, DialoguePage>();
  const lines = source.split(/\r?\n|¦/);
  let page: DialoguePage | null = null;
  let i = 0;
  const block = (end: string): string[] => {
    const out: string[] = [];
    i++;
    while (i < lines.length && lines[i].trim() !== end) {
      out.push(lines[i]);
      i++;
    }
    return out;
  };
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const val = line.slice(eq + 1).trim();
    if (key === 'page') {
      page = { name: val, title: '', text: '', script: '', buttons: [], trades: [] };
      pages.set(val, page);
      continue;
    }
    if (!page) continue;
    switch (key) {
      case 'title':
        page.title = val;
        break;
      case 'text':
        if (val === 'start') page.text = block('text=end').join('\n').replace(/^\n+|\n+$/g, '');
        break;
      case 'script':
        if (val === 'start') page.script = block('script=end').join('\n');
        break;
      case 'button': {
        const co = val.indexOf(',');
        if (co < 0 || page.buttons.length >= MAX_BUTTONS) break;
        page.buttons.push({ target: val.slice(0, co).trim(), text: val.slice(co + 1).trim(), icon: '' });
        break;
      }
      case 'ibutton': {
        const co = val.indexOf(',');
        const co2 = co < 0 ? -1 : val.indexOf(',', co + 1);
        if (co < 0 || co2 < 0 || page.buttons.length >= MAX_BUTTONS) break;
        page.buttons.push({ icon: val.slice(0, co).trim(), target: val.slice(co + 1, co2).trim(), text: val.slice(co2 + 1).trim() });
        break;
      }
      case 'trade': {
        if (val !== 'start') break;
        const trade: DialogueTrade = { sell: [], buy: [] };
        for (const t of block('trade=end')) {
          const e = t.indexOf('=');
          if (e < 0 || t.trimStart().startsWith('#')) continue;
          const k = t.slice(0, e).trim().toLowerCase();
          const parts = t.slice(e + 1).split(',').map(x => Math.abs(parseInt(x.trim(), 10) || 0));
          const entry = { typ: parts[0] ?? 0, count: parts[1] || 1 };
          if (k === 'sell') trade.sell.push(entry);
          else if (k === 'buy') trade.buy.push(entry);
        }
        page.trades.push(trade);
        break;
      }
      default:
        break;
    }
  }
  return pages;
}

/** 按钮目标的种类。 */
export function buttonAction(target: string): { kind: 'close' | 'script' | 'event' | 'page'; param: string } {
  const dd = target.indexOf(':');
  if (dd > 0) {
    const action = target.slice(0, dd).trim().toLowerCase();
    const param = target.slice(dd + 1).trim();
    if (action === 'action' && param.toLowerCase() === 'close') return { kind: 'close', param: '' };
    if (action === 'script') return { kind: 'script', param };
    if (action === 'event') return { kind: 'event', param };
  }
  return { kind: 'page', param: target };
}
