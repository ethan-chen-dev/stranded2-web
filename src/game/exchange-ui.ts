/**
 * 容器交换面板：左侧背包、右侧容器。与原版一样先点选一组物品，再按 1、5 或全部移动；
 * 双击一组等同原版拖放，整组移动。
 */
import type { EntityRecord } from './entities';

export interface ExchangeActions {
  title(): string;
  playerItems(): EntityRecord[];
  containerItems(): EntityRecord[];
  /** 把一组里的 count 件移到对方；返回是否移动了至少一件。 */
  move(item: EntityRecord, toContainer: boolean, count: number): boolean;
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
  private selected: { id: number; toContainer: boolean } | null = null;
  private readonly moveButtons: HTMLButtonElement[] = [];

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
    for (const [label, count] of [['Move 1', 1], ['Move 5', 5], ['Move all', Infinity]] as const) {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => this.moveSelected(count));
      this.moveButtons.push(b);
      buttons.append(b);
    }
    const close = document.createElement('button');
    close.textContent = 'Close';
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
    this.selected = null;
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
    this.titleEl.textContent = `${a.title()} - left: inventory, right: container. Select items, then move them; double-click moves a whole stack.`;
    this.capEl.textContent = a.capacity();
    const mine = a.playerItems();
    const theirs = a.containerItems();
    const sel = this.selectedItem(mine, theirs);
    if (!sel) this.selected = null;
    this.fill(this.left, mine, true);
    this.fill(this.right, theirs, false);
    for (const b of this.moveButtons) b.disabled = !sel || this.blocked(sel, this.selected!.toContainer);
  }

  private selectedItem(mine: EntityRecord[], theirs: EntityRecord[]): EntityRecord | undefined {
    if (!this.selected) return undefined;
    return (this.selected.toContainer ? mine : theirs).find(r => r.id === this.selected!.id);
  }

  private blocked(item: EntityRecord, toContainer: boolean): boolean {
    return toContainer && (!this.allowStore || (this.only.length > 0 && !this.only.includes(item.typ)));
  }

  private moveSelected(count: number): void {
    const a = this.actions;
    if (!a || !this.selected) return;
    const item = this.selectedItem(a.playerItems(), a.containerItems());
    if (!item || this.blocked(item, this.selected.toContainer)) return;
    a.move(item, this.selected.toContainer, Math.min(count, item.count));
    this.refresh();
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
      cell.disabled = this.blocked(item, toContainer);
      cell.classList.toggle('selected', this.selected?.id === item.id && this.selected.toContainer === toContainer);
      cell.addEventListener('click', () => { this.selected = { id: item.id, toContainer }; this.refresh(); });
      cell.addEventListener('dblclick', () => { this.selected = { id: item.id, toContainer }; this.moveSelected(Infinity); });
      return cell;
    }));
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = 'Empty';
      list.append(empty);
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
