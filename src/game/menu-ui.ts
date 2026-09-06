/** 主菜单（冒险、单个岛屿、读取存档、地图查看器）与游戏内暂停菜单。 */

export interface SaveInfo {
  name: string;
  mapPath: string;
  savedAt: string;
}

export interface MainMenuActions {
  /** 单个岛屿可选的地图路径（相对 mod 根目录）。 */
  maps(): Promise<string[]>;
  saves(): SaveInfo[];
  deleteSave(name: string): void;
}

export const ADVENTURE_MAP = 'maps/adventure/map01.s2';

export function playUrl(mapPath: string): string {
  return `?map=${encodeURIComponent(mapPath)}&mode=play`;
}

export function loadSaveUrl(name: string): string {
  return `?save=${encodeURIComponent(name)}&mode=play`;
}

export const MENU_URL = '?menu=1';

function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'menu-btn';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

export class MainMenu {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;

  constructor(parent: HTMLElement, private readonly actions: MainMenuActions) {
    this.root = document.createElement('div');
    this.root.className = 'mainmenu';
    this.root.hidden = true;
    const title = document.createElement('div');
    title.className = 'menu-title';
    title.textContent = 'Stranded II';
    this.body = document.createElement('div');
    this.body.className = 'menu-body';
    const credit = document.createElement('div');
    credit.className = 'menu-credit';
    credit.textContent = 'Stranded II 由 Peter Schauß / Unreal Software 制作（unrealsoftware.de）。本页面是非商业的浏览器复刻，代码按 CC BY-NC-SA 3.0 DE 发布。';
    this.root.append(title, this.body, credit);
    parent.append(this.root);
  }

  show(): void {
    this.root.hidden = false;
    this.home();
  }

  hide(): void {
    this.root.hidden = true;
  }

  private home(): void {
    this.body.replaceChildren(
      button('冒险', () => location.assign(playUrl(ADVENTURE_MAP))),
      button('单个岛屿', () => { void this.mapList(); }),
      button('读取存档', () => this.saveList()),
      button('地图查看器', () => this.hide()),
    );
  }

  private async mapList(): Promise<void> {
    const maps = await this.actions.maps();
    this.body.replaceChildren(
      ...maps.map(m => button(m.replace(/^maps\//, '').replace(/\.s2$/i, ''), () => location.assign(playUrl(m)))),
      button('返回', () => this.home()),
    );
  }

  private saveList(): void {
    const saves = this.actions.saves();
    const rows: HTMLElement[] = saves.map(s => {
      const row = document.createElement('div');
      row.className = 'menu-row';
      row.append(
        button(`${s.name}（${s.mapPath.replace(/^maps\//, '')}，${s.savedAt}）`, () => location.assign(loadSaveUrl(s.name))),
        button('删除', () => { this.actions.deleteSave(s.name); this.saveList(); }),
      );
      return row;
    });
    if (rows.length === 0) {
      const none = document.createElement('div');
      none.textContent = '没有存档';
      rows.push(none);
    }
    this.body.replaceChildren(...rows, button('返回', () => this.home()));
  }
}

export interface PauseMenuActions {
  resume(): void;
  save(name: string): void;
  saves(): SaveInfo[];
  quickSaveName: string;
}

export class PauseMenu {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private visible = false;

  constructor(parent: HTMLElement, private readonly actions: PauseMenuActions) {
    this.root = document.createElement('div');
    this.root.className = 'mainmenu pausemenu';
    this.root.hidden = true;
    const title = document.createElement('div');
    title.className = 'menu-title';
    title.textContent = '暂停';
    this.body = document.createElement('div');
    this.body.className = 'menu-body';
    this.root.append(title, this.body);
    parent.append(this.root);
  }

  get open(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.root.hidden = false;
    this.home();
  }

  close(): void {
    this.visible = false;
    this.root.hidden = true;
  }

  private home(): void {
    this.body.replaceChildren(
      button('继续', () => this.actions.resume()),
      button('保存', () => this.saveForm()),
      button('读取', () => this.loadList()),
      button('回主菜单', () => location.assign(MENU_URL)),
    );
  }

  private saveForm(): void {
    const input = document.createElement('input');
    input.className = 'menu-input';
    input.value = this.actions.quickSaveName;
    input.placeholder = '存档名称';
    const row = document.createElement('div');
    row.className = 'menu-row';
    row.append(input, button('保存', () => { const name = input.value.trim(); if (name) { this.actions.save(name); this.home(); } }));
    this.body.replaceChildren(row, button('返回', () => this.home()));
    input.focus();
  }

  private loadList(): void {
    const saves = this.actions.saves();
    const rows: HTMLElement[] = saves.map(s => button(`${s.name}（${s.mapPath.replace(/^maps\//, '')}，${s.savedAt}）`, () => location.assign(loadSaveUrl(s.name))));
    if (rows.length === 0) {
      const none = document.createElement('div');
      none.textContent = '没有存档';
      rows.push(none);
    }
    this.body.replaceChildren(...rows, button('返回', () => this.home()));
  }
}
