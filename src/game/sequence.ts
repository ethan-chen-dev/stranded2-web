/**
 * 过场序列：脚本用 seqstart 与 seq 系列与镜头指令登记带时间的事件，
 * 每帧按序列开始以来的毫秒数执行到期事件并推进镜头。规则来自原版 game_sequences.bb。
 * 坐标为 Blitz 坐标；pitch 正值向下。
 */

const DEG = Math.PI / 180;
/** 黑边最大高度与每 f 的展开速度（原版 800x600 下的像素）。 */
export const BAR_MAX = 80;
const BAR_SPEED_PER_F = 2;
/** 镜头离地面的最小高度。 */
const CAM_MIN_ABOVE_GROUND = 30;
const FAR = 100000;

export interface SeqEvent {
  t: number;
  kind: string;
  ints: number[];
  floats: number[];
  text: string;
}

export interface SeqCamera {
  x: number;
  y: number;
  z: number;
  pitch: number;
  yaw: number;
}

export interface SeqFade {
  start: number;
  end: number;
  r: number;
  g: number;
  b: number;
  /** 0 透明→不透明→透明，1 透明→不透明，2 不透明→透明。 */
  mode: number;
}

export interface SeqFlash {
  start: number;
  r: number;
  g: number;
  b: number;
  fadeSpeed: number;
  alpha: number;
}

export interface SeqImageText {
  text: string;
  x: number;
  y: number;
  color: number;
  align: number;
}

export interface SequenceDeps {
  now(): number;
  /** 当前镜头（序列开始时的起点）。 */
  cameraNow(): SeqCamera;
  info(id: number): SeqCamera | undefined;
  entityPos(cls: number, id: number): { x: number; y: number; z: number } | undefined;
  terrainY(x: number, z: number): number;
  globalEvent(name: string): void;
  entityEvent(cls: number, id: number, name: string): void;
  runScript(text: string, origin: string): void;
  sound(file: string, volume: number): void;
  /** seqscript 的来源：信息点 id 的文本容器或脚本文件。 */
  loadText(source: string): string | undefined;
  log(msg: string): void;
}

interface CamMove {
  sx: number; sy: number; sz: number;
  ex: number; ey: number; ez: number;
  startT: number;
  endT: number;
  /** 起点与终点的朝向目标点（cammode 2 用）。 */
  sdx: number; sdy: number; sdz: number;
  edx: number; edy: number; edz: number;
}

function forward(c: SeqCamera): { x: number; y: number; z: number } {
  const p = c.pitch * DEG;
  const y = c.yaw * DEG;
  return { x: -Math.sin(y) * Math.cos(p), y: -Math.sin(p), z: Math.cos(y) * Math.cos(p) };
}

const num = (s: string | undefined, d = 0): number => {
  if (s === undefined || s.trim() === '') return d;
  const v = Number(s);
  return Number.isFinite(v) ? v : d;
};

export class Sequence {
  active = false;
  skipable = false;
  bar = false;
  barPx = 0;
  hidePlayer = true;
  cls: { on: boolean; r: number; g: number; b: number } = { on: false, r: 0, g: 0, b: 0 };
  image: { path: string; masked: boolean } | null = null;
  imageTexts: SeqImageText[] = [];
  /** 底部、顶部、中间三条字幕。 */
  msgs: ({ text: string; color: number } | null)[] = [null, null, null];
  fades: SeqFade[] = [];
  flashes: SeqFlash[] = [];
  camera: SeqCamera = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0 };

  private events: SeqEvent[] = [];
  private startMs = 0;
  private tmod = 1;
  private absolute = true;
  private tlast = 0;
  private move: CamMove | null = null;
  private camMode = 0;
  private camTarget = { cls: 0, id: 0 };
  private follow: { cls: number; id: number; dx: number; dy: number; dz: number } | null = null;
  private pivot = { x: 0, y: 0, z: 0 };

  constructor(private readonly d: SequenceDeps) {}

  elapsed(): number {
    return this.d.now() - this.startMs;
  }

  pending(): number {
    return this.events.length;
  }

  start(bar = 1, skipable = 0): void {
    this.bar = bar !== 0;
    this.skipable = skipable === 1;
    this.events = [];
    this.msgs = [null, null, null];
    this.tmod = 1;
    this.absolute = true;
    this.tlast = 0;
    this.cls = { on: false, r: 0, g: 0, b: 0 };
    this.image = null;
    this.imageTexts = [];
    this.fades = [];
    this.flashes = [];
    this.move = null;
    this.camMode = 0;
    this.camTarget = { cls: 0, id: 0 };
    this.follow = null;
    this.hidePlayer = true;
    this.camera = { ...this.d.cameraNow() };
    this.setPivot();
    this.startMs = this.d.now();
    this.active = true;
  }

  timeMode(mod: number, absolute = 1): void {
    this.tmod = Math.abs(mod) || 1;
    this.absolute = absolute !== 0;
  }

  end(): void {
    this.active = false;
    this.bar = false;
    this.cls.on = false;
  }

  /** 用户跳过：仅 skipable 时有效，清空事件并触发 skipsequence。 */
  skip(): boolean {
    if (!this.active || !this.skipable) return false;
    this.events = [];
    this.end();
    this.d.globalEvent('skipsequence');
    return true;
  }

  /** 登记事件；args 为指令参数原文，第一个是时间。envCls/envId 为脚本环境实体。 */
  add(kind: string, args: string[], envCls = 0, envId = 0): void {
    const raw = num(args[0]);
    const t = this.absolute ? raw * this.tmod : this.tlast + raw * this.tmod;
    this.tlast = t;
    const ev: SeqEvent = { t, kind, ints: [], floats: [], text: '' };
    const a = (i: number, d = 0) => num(args[i], d);
    const s = (i: number) => args[i] ?? '';
    switch (kind) {
      case 'end':
      case 'hidebar':
      case 'showbar':
        break;
      case 'msg':
        ev.text = s(1);
        ev.ints = [a(2), a(3)];
        break;
      case 'msgclear':
        ev.ints = [a(1, -1)];
        break;
      case 'sound':
        ev.text = s(1);
        ev.floats = [a(2, 1), a(3, 0)];
        ev.ints = [a(4, 0)];
        break;
      case 'event':
        ev.text = s(1);
        ev.ints = args.length > 2 ? [classCode(s(2), envCls), a(3, envId)] : [0, 0];
        break;
      case 'script': {
        const src = s(1);
        const txt = this.d.loadText(src);
        if (!txt) this.d.log(`seqscript: text source ${src} not found`);
        ev.text = txt ?? '';
        break;
      }
      case 'hideplayer':
        ev.ints = [a(1, 1)];
        break;
      case 'bar':
        ev.ints = [a(1, 1)];
        break;
      case 'setcam':
        ev.ints = [a(1)];
        break;
      case 'movecam':
        ev.ints = [a(1), a(2)];
        break;
      case 'campath': {
        const step = a(1);
        const targets = args.slice(2).map(x => num(x));
        targets.forEach((target, i) => {
          this.events.push({ t: t + step * i, kind: 'movecam', ints: [t + step * (i + 1), target], floats: [], text: '' });
        });
        return;
      }
      case 'timedcampath': {
        let at = t;
        for (let i = 1; i + 1 < args.length; i += 2) {
          const step = Math.trunc(a(i));
          this.events.push({ t: at, kind: 'movecam', ints: [at + step, a(i + 1)], floats: [], text: '' });
          at += step;
        }
        return;
      }
      case 'cammode':
        ev.ints = [a(1), 0, 0];
        if (args.length > 2) {
          const c = classCode(s(2), envCls);
          ev.ints[1] = c;
          ev.ints[2] = c === envCls && args.length <= 3 ? envId : a(3, envId);
        }
        break;
      case 'flash':
        ev.ints = [a(1, 255), a(2, 255), a(3, 255)];
        ev.floats = [a(4, 0.05), a(5, 1.1)];
        break;
      case 'fade':
        ev.ints = [a(1), a(2, 255), a(3, 255), a(4, 255), a(5, 0)];
        break;
      case 'cls':
        ev.ints = [a(1), a(2), a(3), a(4)];
        break;
      case 'image':
        ev.text = s(1);
        ev.ints = [a(2, 0)];
        break;
      case 'itxt':
        ev.text = s(1);
        ev.ints = [a(2), a(3), a(4, 0), a(5, 0)];
        break;
      case 'camfollow': {
        const cls = s(1);
        if (cls === '0' || cls === '') { ev.ints = [0, 0]; break; }
        const c = classCode(cls, envCls);
        const hasId = c !== envCls || args.length > 5;
        const id = hasId ? a(2, envId) : envId;
        const off = hasId ? 3 : 2;
        ev.ints = [c, id];
        ev.floats = [a(off), a(off + 1), a(off + 2)];
        break;
      }
      default:
        this.d.log(`unknown sequence event ${kind}`);
        return;
    }
    this.events.push(ev);
  }

  update(dtMs: number): void {
    if (!this.active) return;
    const f = dtMs / 20;
    const time = this.elapsed() + 1;
    const due = this.events.filter(e => time > e.t).sort((x, y) => x.t - y.t);
    if (due.length) {
      this.events = this.events.filter(e => !(time > e.t));
      for (const e of due) this.run(e);
    }
    if (!this.active) return;
    const target = this.bar ? BAR_MAX : 0;
    if (this.barPx < target) this.barPx = Math.min(this.barPx + BAR_SPEED_PER_F * f, target);
    else if (this.barPx > target) this.barPx = Math.max(this.barPx - BAR_SPEED_PER_F * f, target);
    this.moveCamera();
    this.rotateCamera();
  }

  /** 当前应叠加的色块（最后一条生效的 fade），没有则 null。 */
  fadeColor(): { r: number; g: number; b: number; a: number } | null {
    const time = this.elapsed() + 1;
    let out: { r: number; g: number; b: number; a: number } | null = null;
    for (const fd of this.fades) {
      if (time > fd.end) continue;
      if (time < fd.start) continue;
      const t1 = time - fd.start;
      const t2 = Math.max(fd.end - fd.start, 1);
      let a: number;
      if (fd.mode === 1) a = t1 / t2;
      else if (fd.mode === 2) a = 1 - t1 / t2;
      else {
        const half = t2 / 2;
        a = t1 <= half ? t1 / half : 1 - (t1 - half) / half;
      }
      out = { r: fd.r, g: fd.g, b: fd.b, a: Math.max(0, Math.min(1, a)) };
    }
    return out;
  }

  /** 当前闪光的颜色与透明度。 */
  flashColor(): { r: number; g: number; b: number; a: number } | null {
    const time = this.elapsed() + 1;
    let out: { r: number; g: number; b: number; a: number } | null = null;
    this.flashes = this.flashes.filter(fl => fl.alpha - fl.fadeSpeed * ((time - fl.start) / 20) > 0);
    for (const fl of this.flashes) {
      const a = Math.min(1, fl.alpha - fl.fadeSpeed * ((time - fl.start) / 20));
      out = { r: fl.r, g: fl.g, b: fl.b, a };
    }
    return out;
  }

  private run(e: SeqEvent): void {
    switch (e.kind) {
      case 'end': this.end(); break;
      case 'msg': this.msgs[clampPos(e.ints[1])] = { text: e.text, color: e.ints[0] }; break;
      case 'msgclear':
        if (e.ints[0] === -1) this.msgs = [null, null, null];
        else this.msgs[clampPos(e.ints[0])] = null;
        break;
      case 'sound': this.d.sound(e.text, e.floats[0]); break;
      case 'bar': this.bar = e.ints[0] !== 0; break;
      case 'hidebar': this.bar = false; this.barPx = 0; break;
      case 'showbar': this.bar = true; this.barPx = BAR_MAX; break;
      case 'event':
        if (e.ints[0] === 0) this.d.globalEvent(e.text);
        else this.d.entityEvent(e.ints[0], e.ints[1], e.text);
        break;
      case 'script': if (e.text) this.d.runScript(e.text, 'seqscript'); break;
      case 'hideplayer': this.hidePlayer = e.ints[0] !== 0; break;
      case 'setcam': {
        const info = this.d.info(e.ints[0]);
        if (!info) { this.d.log(`setcam @ ${e.t} ms: info ${e.ints[0]} does not exist`); break; }
        this.camera = { x: info.x, y: info.y, z: info.z, pitch: info.pitch, yaw: info.yaw };
        this.setPivot();
        this.move = null;
        break;
      }
      case 'movecam': {
        const info = this.d.info(e.ints[1]);
        const fw = forward(this.camera);
        const end = info ?? this.camera;
        const efw = forward(end);
        this.move = {
          sx: this.camera.x, sy: this.camera.y, sz: this.camera.z,
          ex: end.x, ey: end.y, ez: end.z,
          startT: e.t, endT: e.ints[0],
          sdx: this.camera.x + fw.x * FAR, sdy: this.camera.y + fw.y * FAR, sdz: this.camera.z + fw.z * FAR,
          edx: end.x + efw.x * FAR, edy: end.y + efw.y * FAR, edz: end.z + efw.z * FAR,
        };
        if (!info) this.d.log(`movecam @ ${e.t} ms: info ${e.ints[1]} does not exist`);
        this.setPivot();
        this.moveCamera();
        this.rotateCamera();
        break;
      }
      case 'cammode':
        this.camMode = e.ints[0];
        this.camTarget = { cls: e.ints[1], id: e.ints[2] };
        this.setPivot();
        this.rotateCamera();
        break;
      case 'camfollow':
        if (e.ints[0] === 0) { this.follow = null; break; }
        this.camMode = 1;
        this.camTarget = { cls: e.ints[0], id: e.ints[1] };
        this.follow = { cls: e.ints[0], id: e.ints[1], dx: e.floats[0], dy: e.floats[1], dz: e.floats[2] };
        this.setPivot();
        this.rotateCamera();
        this.moveCamera();
        break;
      case 'flash':
        this.flashes.push({ start: e.t, r: e.ints[0], g: e.ints[1], b: e.ints[2], fadeSpeed: e.floats[0], alpha: e.floats[1] });
        break;
      case 'fade':
        this.fades.push({ start: e.t, end: e.ints[0], r: e.ints[1], g: e.ints[2], b: e.ints[3], mode: e.ints[4] });
        break;
      case 'cls':
        this.cls = { on: e.ints[0] !== 0, r: e.ints[1], g: e.ints[2], b: e.ints[3] };
        break;
      case 'image':
        this.imageTexts = [];
        this.image = e.text === '' || e.text === '0' ? null : { path: e.text, masked: e.ints[0] !== 0 };
        break;
      case 'itxt':
        if (this.image) this.imageTexts.push({ text: e.text, x: e.ints[0], y: e.ints[1], color: e.ints[2], align: e.ints[3] });
        break;
      default:
        this.d.log(`sequence event ${e.kind} is not implemented`);
    }
  }

  private setPivot(): void {
    const fw = forward(this.camera);
    this.pivot = { x: this.camera.x + fw.x * FAR, y: this.camera.y + fw.y * FAR, z: this.camera.z + fw.z * FAR };
  }

  private moveCamera(): void {
    const m = this.move;
    if (m) {
      const time = this.elapsed();
      const perc = Math.max(0, Math.min(1, (time - m.startT) / Math.max(m.endT - m.startT, 1)));
      this.camera.x = m.sx + (m.ex - m.sx) * perc;
      this.camera.y = m.sy + (m.ey - m.sy) * perc;
      this.camera.z = m.sz + (m.ez - m.sz) * perc;
      if (time >= m.endT) this.move = null;
    }
    if (this.follow) {
      const p = this.d.entityPos(this.follow.cls, this.follow.id);
      if (p) {
        this.camera.x = p.x + this.follow.dx;
        this.camera.y = p.y + this.follow.dy;
        this.camera.z = p.z + this.follow.dz;
      }
    }
    const floor = this.d.terrainY(this.camera.x, this.camera.z) + CAM_MIN_ABOVE_GROUND;
    if (this.camera.y < floor) this.camera.y = floor;
  }

  private rotateCamera(): void {
    switch (this.camMode) {
      case 0: this.pointAt(0, 0, 0); break;
      case 1: {
        const p = this.d.entityPos(this.camTarget.cls, this.camTarget.id);
        if (p) this.pointAt(p.x, p.y, p.z);
        break;
      }
      case 2: {
        const m = this.move;
        if (!m) break;
        const perc = Math.max(0, Math.min(1, (this.elapsed() - m.startT) / Math.max(m.endT - m.startT, 1)));
        this.pointAt(this.pivot.x + (m.edx - this.pivot.x) * perc, this.pivot.y + (m.edy - this.pivot.y) * perc, this.pivot.z + (m.edz - this.pivot.z) * perc);
        break;
      }
      default:
        break;
    }
  }

  private pointAt(x: number, y: number, z: number): void {
    const dx = x - this.camera.x;
    const dy = y - this.camera.y;
    const dz = z - this.camera.z;
    const h = Math.hypot(dx, dz);
    if (h === 0 && dy === 0) return;
    this.camera.yaw = Math.atan2(-dx, dz) / DEG;
    this.camera.pitch = -Math.atan2(dy, h) / DEG;
  }
}

function clampPos(p: number): number {
  return p >= 0 && p <= 2 ? Math.trunc(p) : 0;
}

/** 类名到编号；"self"/未知取脚本环境的类。 */
function classCode(name: string, envCls: number): number {
  switch (name.trim().toLowerCase()) {
    case 'global': return 0;
    case 'object': return 1;
    case 'unit': return 2;
    case 'item': return 3;
    case 'info': return 4;
    default: return envCls;
  }
}
