/** 建筑菜单：列出可用建筑、需求与背包数量，选择后进入放置模式。 */
import type { Building } from '../formats/buildings';

export interface BuildUiActions {
  buildings(): Building[];
  itemName(typ: number): string;
  have(typ: number): number;
  choose(b: Building): void;
}

export class BuildUi {
  private readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private visible = false;

  constructor(parent: HTMLElement, private readonly actions: BuildUiActions) {
    this.root = document.createElement('div');
    this.root.className = 'buildmenu';
    this.root.hidden = true;
    const title = document.createElement('div');
    title.className = 'inv-title';
    title.textContent = 'Build (B to close). Pick one, aim at the ground, then press B or left click to place the site.';
    this.list = document.createElement('div');
    this.list.className = 'build-list';
    this.root.append(title, this.list);
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

  close(): void {
    this.visible = false;
    this.root.hidden = true;
  }

  refresh(): void {
    this.list.replaceChildren();
    const list = this.actions.buildings();
    if (list.length === 0) {
      this.list.textContent = 'Nothing unlocked to build yet.';
      return;
    }
    for (const b of list) {
      const row = document.createElement('div');
      row.className = 'build-row';
      const name = document.createElement('button');
      name.textContent = b.name || `#${b.id}`;
      name.addEventListener('click', () => this.actions.choose(b));
      const reqs = document.createElement('span');
      reqs.className = 'build-reqs';
      reqs.textContent = b.reqs.map(r => `${this.actions.itemName(r.typ)} ${this.actions.have(r.typ)}/${r.count}`).join('，');
      row.append(name, reqs);
      this.list.append(row);
    }
  }
}
