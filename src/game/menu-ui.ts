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
    credit.append('Stranded II by Peter Schauß / Unreal Software, ');
    const site = document.createElement('a');
    site.href = 'https://www.unrealsoftware.de';
    site.target = '_blank';
    site.rel = 'noopener';
    site.textContent = 'unrealsoftware.de';
    credit.append(site, '. Non-commercial browser remake, code under CC BY-NC-SA 3.0 DE. Game assets hosted with the author\'s permission; see ');
    const notice = document.createElement('a');
    notice.href = 'ASSETS-LICENSE.txt';
    notice.target = '_blank';
    notice.rel = 'noopener';
    notice.textContent = 'ASSETS-LICENSE.txt';
    credit.append(notice, '.');
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

  /** 关闭菜单并进入地图查看器（显示地图选择与预览）。 */
  private toViewer(): void {
    document.body.classList.add('viewer');
    this.hide();
  }

  private home(): void {
    this.body.replaceChildren(
      button('Adventure', () => location.assign(playUrl(ADVENTURE_MAP))),
      button('Single island', () => { void this.mapList(); }),
      button('Load game', () => this.saveList()),
      button('Map viewer', () => this.toViewer()),
    );
  }

  private async mapList(): Promise<void> {
    const maps = await this.actions.maps();
    this.body.replaceChildren(
      ...maps.map(m => button(m.replace(/^maps\//, '').replace(/\.s2$/i, ''), () => location.assign(playUrl(m)))),
      button('Back', () => this.home()),
    );
  }

  private saveList(): void {
    const saves = this.actions.saves();
    const rows: HTMLElement[] = saves.map(s => {
      const row = document.createElement('div');
      row.className = 'menu-row';
      row.append(
        button(`${s.name}（${s.mapPath.replace(/^maps\//, '')}，${s.savedAt}）`, () => location.assign(loadSaveUrl(s.name))),
        button('Delete', () => { this.actions.deleteSave(s.name); this.saveList(); }),
      );
      return row;
    });
    if (rows.length === 0) {
      const none = document.createElement('div');
      none.textContent = 'No saved games';
      rows.push(none);
    }
    this.body.replaceChildren(...rows, button('Back', () => this.home()));
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
    title.textContent = 'Paused';
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
      button('Resume', () => this.actions.resume()),
      button('Save', () => this.saveForm()),
      button('Load', () => this.loadList()),
      button('Main menu', () => location.assign(MENU_URL)),
    );
  }

  private saveForm(): void {
    const input = document.createElement('input');
    input.className = 'menu-input';
    input.value = this.actions.quickSaveName;
    input.placeholder = 'Save name';
    const row = document.createElement('div');
    row.className = 'menu-row';
    row.append(input, button('Save', () => { const name = input.value.trim(); if (name) { this.actions.save(name); this.home(); } }));
    this.body.replaceChildren(row, button('Back', () => this.home()));
    input.focus();
  }

  private loadList(): void {
    const saves = this.actions.saves();
    const rows: HTMLElement[] = saves.map(s => button(`${s.name}（${s.mapPath.replace(/^maps\//, '')}，${s.savedAt}）`, () => location.assign(loadSaveUrl(s.name))));
    if (rows.length === 0) {
      const none = document.createElement('div');
      none.textContent = 'No saved games';
      rows.push(none);
    }
    this.body.replaceChildren(...rows, button('Back', () => this.home()));
  }
}
