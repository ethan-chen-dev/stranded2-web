/** 背包覆盖层：物品格可多选，支持使用、吃喝、手持、丢弃与合成。 */
import type { EntityRecord } from './entities';
import { assetUrl } from '../assets/paths';
import type { Candidate } from './combine';

export interface InventoryActions {
  items(): EntityRecord[];
  usedWeight(): number;
  maxWeight(): number;
  hasEvent(rec: EntityRecord, event: string): boolean;
  weaponTyp(): number;
  use(rec: EntityRecord): void;
  eat(rec: EntityRecord): void;
  drop(rec: EntityRecord): void;
  takeInHand(rec: EntityRecord | null): void;
  combineCandidates(selected: EntityRecord[]): Candidate[];
  combine(candidate: Candidate, selected: EntityRecord[]): void;
}

export class InventoryUi {
  private readonly root: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly footer: HTMLElement;
  private readonly combineBar: HTMLElement;
  private readonly choices: HTMLElement;
  private readonly selected = new Set<number>();
  private visible = false;

  constructor(parent: HTMLElement, private readonly actions: InventoryActions) {
    this.root = document.createElement('div');
    this.root.className = 'inventory';
    this.root.hidden = true;
    const title = document.createElement('div');
    title.className = 'inv-title';
    title.textContent = 'Inventory (Tab to close). Select several items to combine them.';
    this.grid = document.createElement('div');
    this.grid.className = 'inv-grid';
    this.combineBar = document.createElement('div');
    this.combineBar.className = 'inv-combine';
    this.choices = document.createElement('div');
    this.choices.className = 'inv-choices';
    this.footer = document.createElement('div');
    this.footer.className = 'inv-footer';
    this.root.append(title, this.grid, this.combineBar, this.choices, this.footer);
    parent.append(this.root);
  }

  get open(): boolean {
    return this.visible;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.hidden = !this.visible;
    if (this.visible) this.refresh();
    else this.selected.clear();
  }

  private selectedRecords(items: EntityRecord[]): EntityRecord[] {
    return items.filter(r => this.selected.has(r.id));
  }

  refresh(): void {
    this.grid.replaceChildren();
    this.choices.replaceChildren();
    const items = this.actions.items();
    for (const id of [...this.selected]) if (!items.some(r => r.id === id)) this.selected.delete(id);
    const weapon = this.actions.weaponTyp();
    for (const rec of items) {
      const def = rec.def;
      const cell = document.createElement('div');
      cell.className = 'inv-cell';
      cell.classList.toggle('selected', this.selected.has(rec.id));
      if (rec.typ === weapon) cell.classList.add('inhand');
      const pick = document.createElement('div');
      pick.className = 'inv-pick';
      if (def?.icon) {
        const img = document.createElement('img');
        img.src = encodeURI(assetUrl(def.icon));
        img.alt = def.name;
        pick.append(img);
      }
      const name = document.createElement('div');
      name.className = 'inv-name';
      name.textContent = `${def?.name ?? `#${rec.typ}`} × ${rec.count}`;
      pick.append(name);
      pick.addEventListener('click', () => {
        if (this.selected.has(rec.id)) this.selected.delete(rec.id);
        else this.selected.add(rec.id);
        this.refresh();
      });
      cell.append(pick);
      const button = (label: string, fn: () => void) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.addEventListener('click', () => { fn(); this.refresh(); });
        cell.append(b);
      };
      if (this.actions.hasEvent(rec, 'use')) button('Use', () => this.actions.use(rec));
      if (this.actions.hasEvent(rec, 'eat')) button(def?.group === 'drink' ? 'Drink' : 'Eat', () => this.actions.eat(rec));
      if (rec.typ === weapon) button('Put away', () => this.actions.takeInHand(null));
      else button('Hold', () => this.actions.takeInHand(rec));
      button('Drop', () => this.actions.drop(rec));
      this.grid.append(cell);
    }
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = 'Empty';
      this.grid.append(empty);
    }
    this.combineBar.replaceChildren();
    const sel = this.selectedRecords(items);
    if (sel.length >= 2) {
      const btn = document.createElement('button');
      btn.textContent = `Combine (${sel.length} selected)`;
      btn.addEventListener('click', () => this.showCandidates(sel));
      this.combineBar.append(btn);
    } else if (sel.length === 1) {
      this.combineBar.textContent = 'Select one more item to try combining.';
    }
    this.footer.textContent = `Weight ${this.actions.usedWeight()} / ${this.actions.maxWeight()}`;
  }

  private showCandidates(sel: EntityRecord[]): void {
    const cands = this.actions.combineCandidates(sel);
    this.choices.replaceChildren();
    if (cands.length === 0) {
      this.choices.textContent = 'These items cannot be combined.';
      return;
    }
    if (cands.length === 1) {
      this.actions.combine(cands[0], sel);
      this.selected.clear();
      this.refresh();
      return;
    }
    for (const c of cands) {
      const b = document.createElement('button');
      b.textContent = `${c.combi.name || c.combi.key}${c.locked ? ' (locked)' : c.feasible ? '' : ' (not enough)'}`;
      b.disabled = !c.feasible;
      b.addEventListener('click', () => { this.actions.combine(c, sel); this.selected.clear(); this.refresh(); });
      this.choices.append(b);
    }
  }
}
