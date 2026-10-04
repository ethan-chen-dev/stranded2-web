/**
 * 界面面板：消息框、对话、日记、撬锁（打开时游戏暂停）与界面文字、图片槽。
 * 界面编号沿用原版：3 日记、21 消息框、24 地图、25 撬锁、26 对话、0 无。
 */
import { buttonAction, MAX_BUTTONS, type DialoguePage } from '../formats/dialogue';
import { FONT_COLORS } from './fonts';
import { splitColoredLines } from './textbuffer';
import { IMAGE_PREFIX } from './textvars';
import { assetUrl } from '../assets/paths';

export const MENU_NONE = 0;
export const MENU_DIARY = 3;
export const MENU_MSGBOX = 21;
export const MENU_MAP = 24;
export const MENU_CRACKLOCK = 25;
export const MENU_DIALOGUE = 26;
export const MAX_UI_TEXTS = 20;
export const MAX_UI_IMAGES = 39;

/** 撬锁方向键：原版按 mode 依次启用左、右、上、下。 */
const CRACK_KEYS = [
  { key: 'l', label: 'Left', code: 'ArrowLeft' },
  { key: 'r', label: 'Right', code: 'ArrowRight' },
  { key: 'u', label: 'Up', code: 'ArrowUp' },
  { key: 'd', label: 'Down', code: 'ArrowDown' },
] as const;

export interface CrackLock {
  title: string;
  mode: number;
  code: string;
  /** 每按一次方向键播放对应音效（0 左 1 右 2 上 3 下）。 */
  sound(dir: number): void;
  fail(): void;
  success(): void;
}


export interface DiaryEntry {
  title: string;
  text: string;
}

export interface PanelActions {
  /** 显示前展开 $key_xxx 与 $变量（textvars）。 */
  expand?(text: string): string;
  runScript(text: string, origin: string): void;
  globalEvent(name: string): void;
  log(msg: string): void;
}

export class Panels {
  private readonly root: HTMLElement;
  private readonly box: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly sideEl: HTMLElement;
  private readonly buttonsEl: HTMLElement;
  private readonly textsEl: HTMLElement;
  private readonly imagesEl: HTMLElement;
  private readonly texts = new Map<number, HTMLElement>();
  private readonly images = new Map<number, HTMLImageElement>();
  private menu = MENU_NONE;
  private pages: Map<string, DialoguePage> | null = null;
  private dialogueTitle = 'Dialogue';
  /** 对话按钮槽：页面的 button= 行按顺序占位，脚本的 button/freebutton 可改写。 */
  private slots: ({ text: string; target: string } | null)[] = [];
  private crack: (CrackLock & { pos: number }) | null = null;
  private bodyText = '';

  constructor(parent: HTMLElement, private readonly actions: PanelActions) {
    this.root = document.createElement('div');
    this.root.className = 'panels';
    this.box = document.createElement('div');
    this.box.className = 'panel';
    this.box.hidden = true;
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'panel-title';
    const main = document.createElement('div');
    main.className = 'panel-main';
    this.sideEl = document.createElement('div');
    this.sideEl.className = 'panel-side';
    this.sideEl.hidden = true;
    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'panel-body';
    main.append(this.sideEl, this.bodyEl);
    this.buttonsEl = document.createElement('div');
    this.buttonsEl.className = 'panel-buttons';
    this.box.append(this.titleEl, main, this.buttonsEl);
    this.textsEl = document.createElement('div');
    this.textsEl.className = 'ui-texts';
    this.imagesEl = document.createElement('div');
    this.imagesEl.className = 'ui-images';
    this.root.append(this.imagesEl, this.textsEl, this.box);
    parent.append(this.root);
  }

  /** 有面板打开时游戏暂停。 */
  get paused(): boolean {
    return this.menu !== MENU_NONE;
  }

  menuId(): number {
    return this.menu;
  }

  close(): void {
    this.menu = MENU_NONE;
    this.pages = null;
    this.crack = null;
    this.box.hidden = true;
  }

  msgbox(title: string, text: string, onClose?: () => void): void {
    this.show(MENU_MSGBOX, title, text, false);
    this.titleEl.style.color = '';
    this.buttonsEl.replaceChildren(this.button('OK', () => { this.close(); onClose?.(); }));
  }

  /** msgwin（gui_msg）：一行按字体颜色显示的消息与 OK 按钮。 */
  msgwin(text: string, color: number, onClose?: () => void): void {
    this.msgbox(text, '', onClose);
    this.titleEl.style.color = FONT_COLORS[color] ?? '';
  }

  dialogue(pages: Map<string, DialoguePage>, page: string): boolean {
    if (!pages.has(page)) {
      this.actions.log(`dialogue page ${page} not found`);
      return false;
    }
    this.pages = pages;
    this.dialogueTitle = 'Dialogue';
    this.showPage(page);
    return true;
  }

  private showPage(name: string): void {
    const page = this.pages?.get(name);
    if (!page) {
      this.actions.log(`dialogue page ${name} not found`);
      return;
    }
    if (page.title) this.dialogueTitle = page.title;
    this.show(MENU_DIALOGUE, this.dialogueTitle, page.text, false);
    this.slots = page.buttons.slice(0, MAX_BUTTONS).map(b => ({ text: b.text, target: b.target }));
    this.renderSlots();
    if (page.trades.length) this.actions.log(`dialogue page ${name} has ${page.trades.length} trade blocks; trading UI is not implemented`);
    if (page.script.trim()) {
      this.actions.runScript(page.script, `dialogue ${name}`);
    }
  }

  /** button 指令：在当前对话里设置第 id 个按钮，目标为页名或 action:/script:/event: 动作。 */
  setButton(id: number, text: string, target: string): void {
    if (id < 0 || id >= MAX_BUTTONS) return;
    while (this.slots.length <= id) this.slots.push(null);
    this.slots[id] = { text, target };
    if (this.menu === MENU_DIALOGUE) this.renderSlots();
  }

  freeButton(id: number): void {
    if (id < 0 || id >= MAX_BUTTONS || id >= this.slots.length) return;
    this.slots[id] = null;
    if (this.menu === MENU_DIALOGUE) this.renderSlots();
  }

  private renderSlots(): void {
    this.buttonsEl.replaceChildren(...this.slots.flatMap(b => (b ? [this.button(b.text, () => this.press(b.target))] : [])));
  }

  /** 地图界面：内容由 map-ui 生成。 */
  showMap(view: HTMLElement): void {
    this.show(MENU_MAP, 'Map', '', false);
    this.bodyEl.replaceChildren(view);
    this.buttonsEl.replaceChildren(this.button('Close', () => this.close()));
  }

  /** 撬锁小游戏：按 code 的顺序按方向键，按错从头开始。 */
  crackLock(o: CrackLock): void {
    this.crack = { ...o, pos: 1 };
    this.show(MENU_CRACKLOCK, o.title, '', false);
    this.buttonsEl.replaceChildren(...CRACK_KEYS.map((k, i) => {
      const b = this.button(k.label, () => this.crackInput(k.key));
      b.disabled = o.mode <= i;
      return b;
    }));
    this.renderCrack();
  }

  /** 撬锁界面打开时由会话把方向键转发进来。 */
  crackKey(code: string): void {
    const i = CRACK_KEYS.findIndex(k => k.code === code);
    if (i >= 0 && this.crack && this.crack.mode > i) this.crackInput(CRACK_KEYS[i].key);
  }

  private crackInput(key: string): void {
    const c = this.crack;
    if (!c) return;
    c.sound(CRACK_KEYS.findIndex(k => k.key === key));
    if (c.code[c.pos - 1] === key) {
      c.pos++;
      if (c.pos > c.code.length) {
        this.close();
        c.success();
        return;
      }
    } else {
      c.pos = 1;
      c.fail();
    }
    this.renderCrack();
  }

  private renderCrack(): void {
    if (this.crack) this.renderText(`Position ${this.crack.pos}`);
  }

  private press(target: string): void {
    const a = buttonAction(target);
    switch (a.kind) {
      case 'close': this.close(); break;
      case 'script': this.actions.runScript(a.param, 'dialogue button'); break;
      case 'event': this.actions.globalEvent(a.param); break;
      case 'page': this.showPage(a.param); break;
    }
  }

  openDiary(entries: DiaryEntry[], skills: { caption: string; value: number }[] = [], focusTitle?: string): void {
    const focus = focusTitle !== undefined ? entries.find(e => e.title === focusTitle) : undefined;
    const first = focus ?? entries[entries.length - 1];
    this.show(MENU_DIARY, 'Diary', first ? first.text : 'No diary entries yet.', true);
    const skillBtn = document.createElement('button');
    skillBtn.className = 'panel-entry panel-skills';
    skillBtn.textContent = 'Skills';
    skillBtn.addEventListener('click', () => this.renderText(skills.length ? skills.map(s => `${s.caption}: ${s.value}`).join('\n') : 'No skills yet.'));
    this.sideEl.replaceChildren(skillBtn, ...entries.map((e, i) => {
      const b = document.createElement('button');
      b.className = 'panel-entry';
      b.textContent = e.title || `#${i + 1}`;
      b.addEventListener('click', () => this.renderText(e.text));
      return b;
    }).reverse());
    const buttons = [this.button('Close', () => this.close())];
    if (this.onSleep) {
      const sleep = this.onSleep;
      buttons.unshift(this.button('Sleep', () => { this.close(); sleep(); }));
    }
    this.buttonsEl.replaceChildren(...buttons);
  }

  /** 日记面板的睡觉按钮（原版在角色界面里）。 */
  onSleep: (() => void) | null = null;

  uiText(id: number, text: string, font: number, x?: number, y?: number, align = 1): void {
    if (id < 0 || id >= MAX_UI_TEXTS) return;
    let el = this.texts.get(id);
    if (!text) { el?.remove(); this.texts.delete(id); return; }
    if (!el) {
      el = document.createElement('div');
      el.className = 'ui-text';
      this.textsEl.append(el);
      this.texts.set(id, el);
    }
    el.textContent = text;
    el.style.color = FONT_COLORS[font] ?? FONT_COLORS[0];
    if (x === undefined || y === undefined) {
      el.style.left = '50%';
      el.style.top = `${40 + id * 18}px`;
      el.style.transform = 'translateX(-50%)';
    } else {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.transform = align === 1 ? 'translateX(-50%)' : align === 2 ? 'translateX(-100%)' : '';
    }
  }

  uiImage(id: number, path: string, x: number, y: number): void {
    if (id < 0 || id >= MAX_UI_IMAGES) return;
    let el = this.images.get(id);
    if (!path) { el?.remove(); this.images.delete(id); return; }
    if (!el) {
      el = document.createElement('img');
      el.className = 'ui-image';
      el.alt = '';
      this.imagesEl.append(el);
      this.images.set(id, el);
    }
    el.src = encodeURI(assetUrl(path));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  dispose(): void {
    this.root.remove();
  }

  private show(menu: number, title: string, text: string, side: boolean): void {
    this.menu = menu;
    this.titleEl.textContent = title;
    this.sideEl.hidden = !side;
    this.renderText(text);
    this.box.hidden = false;
  }

  /** msg_replace：替换消息框或对话正文里的文字。 */
  replaceText(from: string, to: string): void {
    if ((this.menu !== MENU_MSGBOX && this.menu !== MENU_DIALOGUE) || !from) return;
    this.renderText(this.bodyText.split(from).join(to));
  }

  /** msg_extend：接到消息框或对话正文后面。 */
  extendText(text: string): void {
    if (this.menu !== MENU_MSGBOX && this.menu !== MENU_DIALOGUE) return;
    this.renderText(`${this.bodyText}\n${text}`);
  }

  private renderText(text: string): void {
    this.bodyText = text;
    this.bodyEl.replaceChildren(...splitColoredLines(this.actions.expand?.(text) ?? text).map(l => {
      if (l.text.startsWith(IMAGE_PREFIX)) {
        const img = document.createElement('img');
        img.className = 'panel-image';
        img.alt = '';
        img.src = encodeURI(assetUrl(l.text.slice(IMAGE_PREFIX.length).trim().replace(/\\/g, '/')));
        return img;
      }
      const el = document.createElement('div');
      el.textContent = l.text || ' ';
      if (l.color >= 0) el.style.color = FONT_COLORS[l.color];
      return el;
    }));
  }

  private button(text: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }
}
