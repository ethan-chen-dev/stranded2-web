/** 生存数值：只因活动上升；任一项满值后每 5 秒扣血。 */
export type Triple = [number, number, number];

export const EXHAUST_MOVE: Triple = [0.02, 0.02, 0.016];
export const EXHAUST_SWIM: Triple = [0.06, 0.05, 0.06];
export const EXHAUST_JUMP: Triple = [0.8, 0.8, 0.8];
export const EXHAUST_ATTACK: Triple = [0.15, 0.15, 0.15];
export const EXHAUSTED_DAMAGE = 5;
export const EXHAUST_INTERVAL_MS = 100;
export const DAMAGE_INTERVAL_MS = 5000;
const JUMP_EXHAUST_GAP_MS = 100;

export class SurvivalStats {
  health: number;
  hunger = 0;
  thirst = 0;
  exhaustion = 0;
  private exhaustAcc = 0;
  private damageAcc = 0;
  private lastJumpMs = -Infinity;

  constructor(public readonly store = 100, public readonly healthMax = 100) {
    this.health = healthMax;
  }

  exhaust(by: Triple): void {
    this.hunger = Math.min(this.hunger + by[0], this.store);
    this.thirst = Math.min(this.thirst + by[1], this.store);
    this.exhaustion = Math.min(this.exhaustion + by[2], this.store);
  }

  /** 每帧调用；返回本次扣血量。 */
  update(dtMs: number, moving: boolean, swimming: boolean): number {
    this.exhaustAcc += dtMs;
    while (this.exhaustAcc >= EXHAUST_INTERVAL_MS) {
      this.exhaustAcc -= EXHAUST_INTERVAL_MS;
      if (moving) this.exhaust(swimming ? EXHAUST_SWIM : EXHAUST_MOVE);
    }
    let damage = 0;
    this.damageAcc += dtMs;
    while (this.damageAcc >= DAMAGE_INTERVAL_MS) {
      this.damageAcc -= DAMAGE_INTERVAL_MS;
      if (this.health > 0) {
        let d = 0;
        if (this.hunger >= this.store) d += EXHAUSTED_DAMAGE;
        if (this.thirst >= this.store) d += EXHAUSTED_DAMAGE;
        if (this.exhaustion >= this.store) d += EXHAUSTED_DAMAGE;
        this.health = Math.max(this.health - d, 0);
        damage += d;
      }
    }
    return damage;
  }

  jump(nowMs: number): void {
    if (nowMs - this.lastJumpMs > JUMP_EXHAUST_GAP_MS) this.exhaust(EXHAUST_JUMP);
    this.lastJumpMs = nowMs;
  }

  get dead(): boolean {
    return this.health <= 0;
  }
}
