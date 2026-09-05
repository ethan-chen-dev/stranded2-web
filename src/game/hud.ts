/** 游戏 HUD：四条数值条、准星、焦点文字、消息、时钟、死亡提示。 */
import type { SurvivalStats } from './stats';

const BAR_KEYS = ['health', 'hunger', 'thirst', 'exhaustion'] as const;

export class Hud {
  private readonly root: HTMLElement;
  private readonly bars = new Map<string, HTMLElement>();
  private readonly focusEl: HTMLElement;
  private readonly msgEl: HTMLElement;
  private readonly clockEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly deadEl: HTMLElement;
  private msgTimer = 0;

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
    this.msgEl.className = 'msg';
    this.clockEl = document.createElement('div');
    this.clockEl.className = 'clock';
    this.hintEl = document.createElement('div');
    this.hintEl.className = 'hint';
    this.hintEl.textContent = '点击画面开始';
    this.deadEl = document.createElement('div');
    this.deadEl.className = 'dead';
    this.deadEl.textContent = '你死了';
    this.deadEl.hidden = true;
    this.root.append(bars, cross, this.focusEl, this.msgEl, this.clockEl, this.hintEl, this.deadEl);
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

  message(text: string, kind: 'ok' | 'bad' = 'ok'): void {
    this.msgEl.textContent = text;
    this.msgEl.className = `msg ${kind}`;
    clearTimeout(this.msgTimer);
    this.msgTimer = window.setTimeout(() => { this.msgEl.textContent = ''; }, 3000);
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
