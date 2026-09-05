/** 游戏时间：1 游戏分钟 = 500 毫秒实时，一天 12 分钟。 */
export const MS_PER_MINUTE = 500;

export class GameClock {
  private acc = 0;

  constructor(public day: number, public hour: number, public minute: number, public frozen = false) {}

  /** 推进实时毫秒，返回本次跨过的分钟数。 */
  advance(dtMs: number): number {
    if (this.frozen) return 0;
    this.acc += dtMs;
    let minutes = 0;
    while (this.acc >= MS_PER_MINUTE) {
      this.acc -= MS_PER_MINUTE;
      this.minute++;
      minutes++;
      if (this.minute >= 60) {
        this.minute = 0;
        this.hour++;
        if (this.hour >= 24) {
          this.hour = 0;
          this.day++;
        }
      }
    }
    return minutes;
  }

  get dayFraction(): number {
    return (this.hour * 60 + this.minute) / (24 * 60);
  }

  set(hour: number, minute: number): void {
    this.hour = ((hour % 24) + 24) % 24;
    this.minute = Math.min(Math.max(minute, 0), 59);
    this.acc = 0;
  }
}
