/** 背包覆盖层：图标、名称、数量、重量，以及丢弃按钮。 */
import type { EntityDef } from '../formats/inf';
import type { Inventory } from './inventory';
import { modUrl } from '../assets/paths';

export class InventoryUi {
  private readonly root: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly footer: HTMLElement;
  private visible = false;

  constructor(parent: HTMLElement, private readonly inv: Inventory, private readonly defs: Map<number, EntityDef>, private readonly onDrop: (typ: number) => void) {
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
    for (const [typ, count] of this.inv.slots) {
      const def = this.defs.get(typ);
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
      name.textContent = `${def?.name ?? `#${typ}`} × ${count}`;
      const drop = document.createElement('button');
      drop.textContent = '丢弃 1 个';
      drop.addEventListener('click', () => { this.onDrop(typ); this.refresh(); });
      cell.append(name, drop);
      this.grid.append(cell);
    }
    if (this.inv.slots.size === 0) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = '空';
      this.grid.append(empty);
    }
    this.footer.textContent = `重量 ${this.inv.usedWeight} / ${this.inv.maxWeight}`;
  }
}
