/**
 * 界面面板：消息框、对话、日记（打开时游戏暂停）与界面文字、图片槽。
 * 界面编号沿用原版：3 日记、21 消息框、26 对话、0 无。
 */
import { buttonAction, type DialoguePage } from '../formats/dialogue';
import { splitColoredLines } from './textbuffer';
import { modUrl } from '../assets/paths';

export const MENU_NONE = 0;
export const MENU_DIARY = 3;
export const MENU_MSGBOX = 21;
export const MENU_DIALOGUE = 26;
export const MAX_UI_TEXTS = 20;
export const MAX_UI_IMAGES = 39;

const FONT_COLORS = ['#ffffff', '#88ff88', '#ff8888', '#ffee88', '#aaaaaa', '#88ff88', '#ff8888'];

export interface DiaryEntry {
  title: string;
  text: string;
}

export interface PanelActions {
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
    this.box.hidden = true;
  }

  msgbox(title: string, text: string, onClose?: () => void): void {
    this.show(MENU_MSGBOX, title, text, false);
    this.buttonsEl.replaceChildren(this.button('确定', () => { this.close(); onClose?.(); }));
  }

  dialogue(pages: Map<string, DialoguePage>, page: string): boolean {
    if (!pages.has(page)) {
      this.actions.log(`对话页 ${page} 不存在`);
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
      this.actions.log(`对话页 ${name} 不存在`);
      return;
    }
    if (page.title) this.dialogueTitle = page.title;
    this.show(MENU_DIALOGUE, this.dialogueTitle, page.text, false);
    this.buttonsEl.replaceChildren(...page.buttons.map(b => this.button(b.text, () => this.press(b.target))));
    if (page.trades.length) this.actions.log(`对话页 ${name} 含 ${page.trades.length} 段交易，交易界面未实现`);
    if (page.script.trim()) {
      this.actions.runScript(page.script, `dialogue ${name}`);
    }
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

  openDiary(entries: DiaryEntry[]): void {
    this.show(MENU_DIARY, '日记', entries.length ? entries[entries.length - 1].text : '还没有日记。', true);
    this.sideEl.replaceChildren(...entries.map((e, i) => {
      const b = document.createElement('button');
      b.className = 'panel-entry';
      b.textContent = e.title || `#${i + 1}`;
      b.addEventListener('click', () => this.renderText(e.text));
      return b;
    }).reverse());
    this.buttonsEl.replaceChildren(this.button('关闭', () => this.close()));
  }

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
    el.src = encodeURI(modUrl(path));
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

  private renderText(text: string): void {
    this.bodyEl.replaceChildren(...splitColoredLines(text).map(l => {
      const el = document.createElement('div');
      el.textContent = l.text || ' ';
      if (l.color >= 0) el.style.color = FONT_COLORS[l.color];
      return el;
    }));
  }

  private button(text: string, onClick: () => void): HTMLElement {
    const b = document.createElement('button');
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }
}
