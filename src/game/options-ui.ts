/**
 * 选项面板（原版 Options 的 Controls / Graphics / Sound 三页里浏览器能用的部分），主菜单与暂停菜单共用。
 * 每次改动立即保存并回调 onChange，游戏中即时生效。
 */
import { ACTIONS, defaultSettings, keyLabel, saveSettings, type Action, type Settings } from './settings';

type Tab = 'controls' | 'graphics' | 'sound';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function menuButton(text: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'menu-btn', text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

export class OptionsPanel {
  private tab: Tab = 'controls';
  private waiting: Action | null = null;
  private readonly onKey = (ev: KeyboardEvent) => { if (this.waiting) { ev.preventDefault(); this.bind(ev.code); } };
  private readonly onMouse = (ev: MouseEvent) => { if (this.waiting && ev.button !== 1) { ev.preventDefault(); this.bind(`Mouse${ev.button}`); } };

  constructor(
    private readonly body: HTMLElement,
    private settings: Settings,
    private readonly onChange: (s: Settings) => void,
    private readonly onBack: () => void,
  ) {}

  show(): void {
    this.render();
  }

  private commit(): void {
    saveSettings(this.settings);
    this.onChange(this.settings);
    this.render();
  }

  private bind(code: string): void {
    const action = this.waiting;
    this.waiting = null;
    removeEventListener('keydown', this.onKey, true);
    removeEventListener('mousedown', this.onMouse, true);
    if (!action || code === 'Escape') { this.render(); return; }
    // 一个键只对应一个动作：新键已被别的动作占用时，两个动作的按键互换
    const keys = { ...this.settings.keys };
    const other = (Object.keys(keys) as Action[]).find(a => a !== action && keys[a] === code);
    if (other) keys[other] = keys[action];
    keys[action] = code;
    this.settings = { ...this.settings, keys };
    this.commit();
  }

  private render(): void {
    const tabs = el('div', 'menu-row');
    for (const [t, label] of [['controls', 'Controls'], ['graphics', 'Graphics'], ['sound', 'Sound']] as [Tab, string][]) {
      const b = menuButton(label, () => { this.tab = t; this.render(); });
      if (t === this.tab) b.classList.add('selected');
      tabs.append(b);
    }
    const rows = el('div', 'options-rows');
    if (this.tab === 'controls') this.controls(rows);
    else if (this.tab === 'graphics') this.graphics(rows);
    else this.sound(rows);
    const footer = el('div', 'menu-row');
    footer.append(
      menuButton('Defaults', () => { this.settings = { ...defaultSettings() }; this.commit(); }),
      menuButton('Back', () => this.onBack()),
    );
    this.body.replaceChildren(tabs, rows, footer);
  }

  private row(rows: HTMLElement, label: string, control: HTMLElement): void {
    const r = el('div', 'options-row');
    r.append(el('span', 'options-label', label), control);
    rows.append(r);
  }

  private choice(rows: HTMLElement, label: string, labels: string[], value: number, set: (v: number) => void): void {
    const s = el('select', 'options-select');
    labels.forEach((l, i) => { const o = el('option', '', l); o.value = String(i); s.append(o); });
    s.value = String(value);
    s.addEventListener('change', () => { set(Number(s.value)); this.commit(); });
    this.row(rows, label, s);
  }

  private toggle(rows: HTMLElement, label: string, value: boolean, set: (v: boolean) => void): void {
    const c = el('input', 'options-check');
    c.type = 'checkbox';
    c.checked = value;
    c.addEventListener('change', () => { set(c.checked); this.commit(); });
    this.row(rows, label, c);
  }

  private slider(rows: HTMLElement, label: string, value: number, min: number, max: number, step: number, set: (v: number) => void): void {
    const r = el('input', 'options-range');
    r.type = 'range';
    r.min = String(min);
    r.max = String(max);
    r.step = String(step);
    r.value = String(value);
    r.addEventListener('change', () => { set(Number(r.value)); this.commit(); });
    this.row(rows, label, r);
  }

  private controls(rows: HTMLElement): void {
    for (const { action, label } of ACTIONS) {
      const b = menuButton(this.waiting === action ? 'Press a key…' : keyLabel(this.settings.keys[action]), () => {
        this.waiting = action;
        addEventListener('keydown', this.onKey, true);
        // 点按钮本身的这次鼠标事件不算，下一次按下才绑定
        setTimeout(() => addEventListener('mousedown', this.onMouse, true), 0);
        this.render();
      });
      this.row(rows, label, b);
    }
    this.slider(rows, 'Mouse sensibility', this.settings.mouseSensitivity, 0.2, 3, 0.1, v => { this.settings.mouseSensitivity = v; });
    this.toggle(rows, 'Invert mouse', this.settings.invertMouse, v => { this.settings.invertMouse = v; });
  }

  private graphics(rows: HTMLElement): void {
    this.choice(rows, 'View range', ['Very Small', 'Small', 'Medium', 'Far', 'Very Far'], this.settings.viewRange, v => { this.settings.viewRange = v; });
    this.choice(rows, 'Effect details', ['Off', 'Low', 'High'], this.settings.effects, v => { this.settings.effects = v; });
    this.choice(rows, 'Grass', ['None', 'Few', 'Medium', 'Much', 'Very Much'], this.settings.grass, v => { this.settings.grass = v; });
    this.toggle(rows, 'Wiggle in wind', this.settings.windsway, v => { this.settings.windsway = v; });
    this.toggle(rows, 'Fog', this.settings.fog, v => { this.settings.fog = v; });
    this.toggle(rows, 'Blood', this.settings.gore, v => { this.settings.gore = v; });
    this.toggle(rows, 'Motion blur', this.settings.motionBlur, v => { this.settings.motionBlur = v; });
    this.slider(rows, 'Motion blur intensity', this.settings.motionBlurAlpha, 0, 0.9, 0.01, v => { this.settings.motionBlurAlpha = v; });
  }

  private sound(rows: HTMLElement): void {
    this.slider(rows, 'Music', this.settings.musicVolume, 0, 1, 0.05, v => { this.settings.musicVolume = v; });
    this.slider(rows, 'Sound effects', this.settings.sfxVolume, 0, 1, 0.05, v => { this.settings.sfxVolume = v; });
  }
}
