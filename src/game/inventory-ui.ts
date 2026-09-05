/** 背包覆盖层：按物品实体展示图标、名称、数量、重量，以及使用/吃喝/丢弃按钮。 */
import type { EntityRecord } from './entities';
import { modUrl } from '../assets/paths';

export interface InventoryActions {
  items(): EntityRecord[];
  usedWeight(): number;
  maxWeight(): number;
  /** 该物品脚本是否有某事件（决定显示哪些按钮）。 */
  hasEvent(rec: EntityRecord, event: string): boolean;
  use(rec: EntityRecord): void;
  eat(rec: EntityRecord): void;
  drop(rec: EntityRecord): void;
}

export class InventoryUi {
  private readonly root: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly footer: HTMLElement;
  private visible = false;

  constructor(parent: HTMLElement, private readonly actions: InventoryActions) {
    this.root = document.createElement('div');
    this.root.className = 'inventory';
    this.root.hidden = true;
    const title = document.createElement('div');
    title.className = 'inv-title';
    title.textContent = '背包（Tab 关闭）';
    this.grid = document.createElement('div');
    this.grid.className = 'inv-grid';
    this.footer = document.createElement('div');
    this.footer.className = 'inv-footer';
    this.root.append(title, this.grid, this.footer);
    parent.append(this.root);
  }

  get open(): boolean {
    return this.visible;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.hidden = !this.visible;
    if (this.visible) this.refresh();
  }

  refresh(): void {
    this.grid.replaceChildren();
    const items = this.actions.items();
    for (const rec of items) {
      const def = rec.def;
      const cell = document.createElement('div');
      cell.className = 'inv-cell';
      if (def?.icon) {
        const img = document.createElement('img');
        img.src = encodeURI(modUrl(def.icon));
        img.alt = def.name;
        cell.append(img);
      }
      const name = document.createElement('div');
      name.className = 'inv-name';
      name.textContent = `${def?.name ?? `#${rec.typ}`} × ${rec.count}`;
      cell.append(name);
      const button = (label: string, fn: () => void) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.addEventListener('click', () => { fn(); this.refresh(); });
        cell.append(b);
      };
      if (this.actions.hasEvent(rec, 'use')) button('使用', () => this.actions.use(rec));
      if (this.actions.hasEvent(rec, 'eat')) button(def?.group === 'drink' ? '喝' : '吃', () => this.actions.eat(rec));
      button('丢弃', () => this.actions.drop(rec));
      this.grid.append(cell);
    }
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = '空';
      this.grid.append(empty);
    }
    this.footer.textContent = `重量 ${this.actions.usedWeight()} / ${this.actions.maxWeight()}`;
  }
}
