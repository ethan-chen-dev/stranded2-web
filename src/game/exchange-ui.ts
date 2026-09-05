/** 容器交换面板：左侧背包、右侧容器，点一件移动一件。 */
import type { EntityRecord } from './entities';

export interface ExchangeActions {
  title(): string;
  playerItems(): EntityRecord[];
  containerItems(): EntityRecord[];
  /** 把一件物品移到对方；返回是否成功。 */
  move(item: EntityRecord, toContainer: boolean): boolean;
  name(typ: number): string;
  icon(typ: number): string | undefined;
  /** 容器承重说明文字。 */
  capacity(): string;
  onClose(): void;
}

export class ExchangeUi {
  private readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly left: HTMLElement;
  private readonly right: HTMLElement;
  private readonly capEl: HTMLElement;
  private actions: ExchangeActions | null = null;
  private allowStore = true;
  private only: number[] = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'panel exchange';
    this.root.hidden = true;
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'panel-title';
    const main = document.createElement('div');
    main.className = 'exchange-main';
    this.left = document.createElement('div');
    this.left.className = 'exchange-list';
    this.right = document.createElement('div');
    this.right.className = 'exchange-list';
    main.append(this.left, this.right);
    this.capEl = document.createElement('div');
    this.capEl.className = 'exchange-cap';
    const buttons = document.createElement('div');
    buttons.className = 'panel-buttons';
    const close = document.createElement('button');
    close.textContent = '关闭';
    close.addEventListener('click', () => this.close());
    buttons.append(close);
    this.root.append(this.titleEl, main, this.capEl, buttons);
    parent.append(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(actions: ExchangeActions, allowStore: boolean, only: number[]): void {
    this.actions = actions;
    this.allowStore = allowStore;
    this.only = only;
    this.root.hidden = false;
    this.refresh();
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    const a = this.actions;
    this.actions = null;
    a?.onClose();
  }

  refresh(): void {
    const a = this.actions;
    if (!a) return;
    this.titleEl.textContent = `${a.title()}（左：背包，右：容器，点击移动一件）`;
    this.capEl.textContent = a.capacity();
    this.fill(this.left, a.playerItems(), true);
    this.fill(this.right, a.containerItems(), false);
  }

  private fill(list: HTMLElement, items: EntityRecord[], toContainer: boolean): void {
    const a = this.actions!;
    list.replaceChildren(...items.map(item => {
      const cell = document.createElement('button');
      cell.className = 'inv-cell exchange-cell';
      const icon = a.icon(item.typ);
      if (icon) {
        const img = document.createElement('img');
        img.src = icon;
        img.alt = '';
        cell.append(img);
      }
      const name = document.createElement('span');
      name.textContent = `${a.name(item.typ)}${item.count > 1 ? ` × ${item.count}` : ''}`;
      cell.append(name);
      const blocked = toContainer && (!this.allowStore || (this.only.length > 0 && !this.only.includes(item.typ)));
      cell.disabled = blocked;
      cell.addEventListener('click', () => { if (a.move(item, toContainer)) this.refresh(); });
      return cell;
    }));
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = '空';
      list.append(empty);
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
