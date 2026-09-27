/** 键盘状态、指针锁定与鼠标增量。hit 表示本帧刚按下，endFrame 后清除。 */
export class InputState {
  readonly keys = new Set<string>();
  private readonly hits = new Set<string>();
  private dx = 0;
  private dy = 0;
  locked = false;
  /** 玩家点击后锁定被拒绝（嵌入页不允许锁定，或刚按 Esc 退出后点得太快）；锁定成功后清除。 */
  lockRefused = false;
  private clickRequested = false;
  private readonly onLockChange = () => {
    this.locked = document.pointerLockElement === this.el;
    if (this.locked) this.lockRefused = false;
  };
  private readonly onLockError = () => { if (this.clickRequested) this.lockRefused = true; };

  constructor(private readonly el: HTMLElement) {
    addEventListener('keydown', ev => {
      if (ev.code === 'Tab' || ev.code === 'Space') ev.preventDefault();
      if (!ev.repeat) this.hits.add(ev.code);
      this.keys.add(ev.code);
    });
    addEventListener('keyup', ev => { this.keys.delete(ev.code); });
    addEventListener('blur', () => { this.keys.clear(); });
    el.addEventListener('mousemove', ev => {
      if (!this.locked) return;
      this.dx += ev.movementX;
      this.dy += ev.movementY;
    });
    el.addEventListener('mousedown', ev => {
      if (this.locked) this.hits.add(`Mouse${ev.button}`);
    });
    el.addEventListener('contextmenu', ev => ev.preventDefault());
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('pointerlockerror', this.onLockError);
  }

  pressed(code: string): boolean {
    return this.keys.has(code);
  }

  hit(code: string): boolean {
    return this.hits.has(code);
  }

  consumeLook(): { dx: number; dy: number } {
    const r = { dx: this.dx, dy: this.dy };
    this.dx = 0;
    this.dy = 0;
    return r;
  }

  /**
   * 指针锁定需要用户手势，且部分嵌入环境不支持；失败时保持未锁定状态。
   * 只有玩家点击触发的请求失败才记为被拒绝，程序自动请求（没有手势）失败是正常的。
   */
  requestLock(fromClick = false): void {
    if (this.locked) return;
    this.clickRequested = fromClick;
    try {
      const r = this.el.requestPointerLock?.() as { catch?: (f: () => void) => unknown } | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => this.onLockError());
    } catch {
      this.onLockError();
    }
  }

  release(): void {
    if (this.locked) document.exitPointerLock();
  }

  endFrame(): void {
    this.hits.clear();
  }
}
