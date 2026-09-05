/** 键盘状态、指针锁定与鼠标增量。hit 表示本帧刚按下，endFrame 后清除。 */
export class InputState {
  readonly keys = new Set<string>();
  private readonly hits = new Set<string>();
  private dx = 0;
  private dy = 0;
  locked = false;
  private readonly onLockChange = () => { this.locked = document.pointerLockElement === this.el; };

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
    document.addEventListener('pointerlockchange', this.onLockChange);
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

  requestLock(): void {
    if (!this.locked) this.el.requestPointerLock?.();
  }

  release(): void {
    if (this.locked) document.exitPointerLock();
  }

  endFrame(): void {
    this.hits.clear();
  }
}
