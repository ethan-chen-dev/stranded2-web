/**
 * 可见物体的逐帧行为，依据 cull.bb 与 handle_objects.bb 的 update_object_behaviour：
 * 随风摆动（横滚角 = sin(角度)×swaypower，角度每 f 增加 swayspeed）；泉水每 50 毫秒冒水花，镜头在 200 以内时水声播完即重播；
 * 炸弹蘑菇（closekill）玩家走到 50 以内即被摧毁；毒花（closetrigger）玩家在 50 以内时每 500 毫秒触发 trigger。
 * 只处理在视野内且没超出 autofade 距离的物体，与原版一致。
 */
import { CLS, type EntityRecord, type EntityRegistry } from './entities';
import { P, type ParticleHandle } from '../render/particles';

const BEHAVIOURS = new Set(['fountain', 'closekill', 'closetrigger']);
const CLOSE_RANGE = 50;
const FOUNTAIN_SOUND_RANGE = 200;
const DEG = Math.PI / 180;

export interface ObjectBehaviourDeps {
  registry: EntityRegistry;
  /** 物体在视野内且没超出淡出距离。 */
  visible(rec: EntityRecord): boolean;
  player(): { x: number; y: number; z: number };
  camera(): { x: number; y: number; z: number };
  particle(x: number, y: number, z: number, typ: number, size?: number, a?: number): ParticleHandle | null;
  /** 泉水声道：上一声播完才重播，音量按位置衰减。 */
  channel(key: string, file: string, at: { x: number; y: number; z: number }): void;
  kill(rec: EntityRecord): void;
  trigger(rec: EntityRecord): void;
  /** 设置 set_windsway。 */
  windsway(): boolean;
}

export class ObjectBehaviour {
  private readonly angle = new Map<number, number>();

  constructor(private readonly d: ObjectBehaviourDeps) {}

  private tick(period: number, gameMs: number, dtMs: number): boolean {
    return Math.floor(gameMs / period) !== Math.floor((gameMs - dtMs) / period);
  }

  update(dtMs: number, gameMs: number): void {
    const f = dtMs / 20;
    const go50 = this.tick(50, gameMs, dtMs), go100 = this.tick(100, gameMs, dtMs), go500 = this.tick(500, gameMs, dtMs);
    const player = this.d.player();
    const cam = this.d.camera();
    const near = (o: EntityRecord) => Math.hypot(o.x - player.x, o.y - player.y, o.z - player.z) < CLOSE_RANGE;
    for (const o of this.d.registry.all(CLS.object)) {
      const def = o.def;
      if (!def) continue;
      const beh = def.behaviour.trim().toLowerCase();
      const sways = def.swayspeed !== 0 || def.swaypower !== 0;
      if (!sways && !BEHAVIOURS.has(beh)) continue;
      if (!this.d.visible(o)) continue;
      if (sways && this.d.windsway() && o.object) {
        let a = this.angle.get(o.id);
        if (a === undefined) a = Math.random() * 360;
        a = (a + def.swayspeed * f) % 360;
        this.angle.set(o.id, a);
        o.object.rotation.z = Math.sin(a * DEG) * def.swaypower * DEG;
      }
      if (beh === 'fountain') {
        if (go50) this.d.particle(o.x + rnd(-3, 3), o.y + 5, o.z + rnd(-3, 3), P.splash, rnd(15, 18), 1)?.color(150, 190, 255);
        if (Math.hypot(o.x - cam.x, o.y - cam.y, o.z - cam.z) < FOUNTAIN_SOUND_RANGE) this.d.channel(`fountain:${o.id}`, 'fountain.wav', o);
      } else if (beh === 'closekill') {
        if (go100 && near(o)) this.d.kill(o);
      } else if (beh === 'closetrigger') {
        if (go500 && near(o)) this.d.trigger(o);
      }
    }
  }
}

function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a);
}
