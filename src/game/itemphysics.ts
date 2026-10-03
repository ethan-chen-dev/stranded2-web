/**
 * 地上物品的下落与漂浮，依据 cull.bb 的物品部分。只模拟没有父实体、离镜头不超过 autofade+300 的物品；
 * 挂在物体外面的子物品（树上的果子）保持原位。下落速度在 3 秒内加速到 g×f×1.5；
 * 落到地面停在地面上方 1，落到碰撞物体上就停在物体表面。木头和叶子材质会浮，在水里停在 y=-1。
 * 我们新建的物品放在地面上，所以会浮的物品从深水底部上浮时不受落地判定影响。
 * 停下的不浮物品暂停模拟，直到有物体被移除（item_phyreset），以免树倒后果子悬空。
 */
import { CLS, type EntityRecord, type EntityRegistry } from './entities';

const GRAVITY = 9.81;
const FALL_ACCEL_MS = 3000;
const FLOAT_Y = -1;
const RISE_PER_F = 0.45;
const SWIM_MATERIALS = new Set(['wood', 'leaf']);
const FADE_MARGIN = 300;

export interface ItemPhysicsDeps {
  registry: EntityRegistry;
  terrainY(x: number, z: number): number;
  /** 从 (x, top, z) 竖直向下到 bottom 之间第一个碰撞物体表面的高度，没有则为 null。 */
  floorBelow(x: number, top: number, bottom: number, z: number): number | null;
  sync(rec: EntityRecord): void;
}

interface FallState {
  since: number;
  paused: boolean;
}

export class ItemPhysics {
  private readonly state = new Map<EntityRecord, FallState>();

  constructor(private readonly d: ItemPhysicsDeps) {}

  /** item_phyreset：物体被移除或改变后，所有停下的物品重新开始检查。 */
  reset(): void {
    for (const s of this.state.values()) s.paused = false;
  }

  update(dtMs: number, nowMs: number, camera: { x: number; y: number; z: number }): void {
    const f = dtMs / 20;
    for (const rec of this.d.registry.all(CLS.item)) {
      if (rec.parentClass !== 0) {
        this.state.delete(rec);
        continue;
      }
      let st = this.state.get(rec);
      if (!st) {
        st = { since: nowMs, paused: false };
        this.state.set(rec, st);
      }
      const range = (rec.def?.autofade ?? 0) + FADE_MARGIN;
      if (Math.hypot(rec.x - camera.x, rec.y - camera.y, rec.z - camera.z) > range) {
        st.since = nowMs;
        continue;
      }
      if (st.paused) continue;
      this.step(rec, st, f, nowMs);
    }
    for (const rec of this.state.keys()) if (this.d.registry.get(CLS.item, rec.id) !== rec) this.state.delete(rec);
  }

  private step(rec: EntityRecord, st: FallState, f: number, nowMs: number): void {
    const before = rec.y;
    const fall = GRAVITY * f * 1.5 * (Math.min(nowMs - st.since, FALL_ACCEL_MS) / FALL_ACCEL_MS);
    const swims = SWIM_MATERIALS.has(rec.def?.mat ?? '');
    const rising = swims && rec.y < FLOAT_Y;
    if (!swims || rec.y > FLOAT_Y) {
      rec.y -= fall;
    } else if (rising) {
      rec.y += RISE_PER_F * f;
      if (rec.y > FLOAT_Y) {
        rec.y = FLOAT_Y;
        st.since = nowMs;
      }
    }
    const ground = this.d.terrainY(rec.x, rec.z);
    if (rec.y < ground + 3 && !(rising && ground + 3 < FLOAT_Y)) {
      rec.y = ground + 1;
      st.since = nowMs;
      if (!swims) st.paused = true;
    } else if (rec.y < before) {
      const floor = this.d.floorBelow(rec.x, before, rec.y, rec.z);
      if (floor !== null) {
        rec.y = floor;
        st.since = nowMs;
        if (!swims) st.paused = true;
      }
    }
    if (rec.y !== before) this.d.sync(rec);
  }
}
