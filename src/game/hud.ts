/** 游戏 HUD：四条数值条、准星、焦点文字、消息栈、进度条、时钟、死亡提示。 */
import type { SurvivalStats } from './stats';

const BAR_KEYS = ['health', 'hunger', 'thirst', 'exhaustion'] as const;
/** 原版 msg 字体色编号到颜色。 */
const FONT_COLORS = ['#ffffff', '#88ff88', '#ff8888', '#ffee88', '#aaaaaa', '#88ff88', '#ff8888'];
const MAX_MESSAGES = 6;

export class Hud {
  private readonly root: HTMLElement;
  private readonly bars = new Map<string, HTMLElement>();
  private readonly focusEl: HTMLElement;
  private readonly msgEl: HTMLElement;
  private readonly clockEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly deadEl: HTMLElement;
  private readonly processEl: HTMLElement;
  private readonly processTitle: HTMLElement;
  private readonly processFill: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'game-hud';
    const bars = document.createElement('div');
    bars.className = 'bars';
    for (const k of BAR_KEYS) {
      const back = document.createElement('div');
      back.className = `bar-back bar-${k}`;
      const fill = document.createElement('div');
      fill.className = 'bar-fill';
      back.append(fill);
      bars.append(back);
      this.bars.set(k, fill);
    }
    const cross = document.createElement('div');
    cross.className = 'crosshair';
    this.focusEl = document.createElement('div');
    this.focusEl.className = 'focus';
    this.msgEl = document.createElement('div');
    this.msgEl.className = 'msgs';
    this.clockEl = document.createElement('div');
    this.clockEl.className = 'clock';
    this.hintEl = document.createElement('div');
    this.hintEl.className = 'hint';
    this.hintEl.textContent = '点击画面开始';
    this.deadEl = document.createElement('div');
    this.deadEl.className = 'dead';
    this.deadEl.textContent = '你死了';
    this.deadEl.hidden = true;
    this.processEl = document.createElement('div');
    this.processEl.className = 'process';
    this.processEl.hidden = true;
    this.processTitle = document.createElement('div');
    this.processFill = document.createElement('div');
    this.processFill.className = 'process-fill';
    const track = document.createElement('div');
    track.className = 'process-track';
    track.append(this.processFill);
    this.processEl.append(this.processTitle, track);
    this.root.append(bars, cross, this.focusEl, this.msgEl, this.processEl, this.clockEl, this.hintEl, this.deadEl);
    parent.append(this.root);
  }

  setStats(s: SurvivalStats): void {
    const set = (k: string, v: number, max: number, warnHigh: boolean) => {
      const el = this.bars.get(k)!;
      const perc = Math.max(0, Math.min(100, (v / max) * 100));
      el.style.width = `${perc}%`;
      el.classList.toggle('warn', warnHigh ? perc >= 70 : perc <= 30);
    };
    set('health', s.health, s.healthMax, false);
    set('hunger', s.hunger, s.store, true);
    set('thirst', s.thirst, s.store, true);
    set('exhaustion', s.exhaustion, s.store, true);
  }

  setFocus(text: string | null): void {
    this.focusEl.textContent = text ?? '';
  }

  /** 消息按行堆叠，各自到期后消失。 */
  message(text: string, font = 0, durationMs = 3000): void {
    const line = document.createElement('div');
    line.textContent = text;
    line.style.color = FONT_COLORS[font] ?? FONT_COLORS[0];
    this.msgEl.append(line);
    while (this.msgEl.children.length > MAX_MESSAGES) this.msgEl.firstElementChild?.remove();
    window.setTimeout(() => line.remove(), Math.max(durationMs, 500));
  }

  setProcess(title: string | null, fraction = 0): void {
    this.processEl.hidden = title === null;
    if (title !== null) {
      this.processTitle.textContent = title;
      this.processFill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
    }
  }

  setClock(day: number, hour: number, minute: number): void {
    this.clockEl.textContent = `第 ${day} 天 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  showHint(show: boolean): void {
    this.hintEl.hidden = !show;
  }

  showDead(): void {
    this.deadEl.hidden = false;
  }

  dispose(): void {
    this.root.remove();
  }
}
