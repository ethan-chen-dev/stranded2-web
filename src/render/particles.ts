/**
 * 三维粒子与实体动画，依据 particles.bb 的 p_add、p_update（只含 3D 部分）、p_explosion 与 p_parent。
 * 粒子位置按 Blitz 左手系记录，放进场景时 z 取反；每帧推进量 f = 循环毫秒 / 20。
 * 精灵贴图（*_a.bmp）没有 alpha 通道：叠加混合（EntityBlend 3）直接用原贴图，普通混合改用按 rgb 平均值
 * 生成 alpha、颜色取白的贴图，于是 EntityColor 就是材质颜色。flames0_a.png 自带 alpha。
 * 雨雪挂在只跟随镜头 x/z 的 camxz 支点下；攻击图标与全屏淡入淡出、闪光固定在镜头前。
 * 101..104 不新建精灵，驱动调用方已有的场景对象（原版 tmp_ph），结束时交给 onDone 释放。
 */
import * as THREE from 'three';

export const P = {
  attack: 4, debug: 5, bubbles: 10, rwave: 11, splash: 12, wave: 15, hover: 19, smoke: 20, spark: 21,
  splatter: 22, subsplatter: 23, wood: 24, puddle: 25, flames: 30, firespark: 35, risingflare: 40,
  explode: 45, shockwave: 46, starflare: 50, spawn: 51, impact: 60, rain: 70, snow: 71,
  fade: 98, seqfade: 99, flash: 100, fadeout: 101, fall: 102, resfade: 103, stuck: 104,
} as const;

export interface ParticleDeps {
  scene: THREE.Scene;
  camera: THREE.Camera;
  textures: (url: string) => Promise<THREE.Texture | null>;
  /** 地面高度（e_tery），z 为 Blitz 坐标。 */
  terrainY(x: number, zBlitz: number): number;
  /** 镜头在水下（g_dive）。 */
  diving(): boolean;
  random?: () => number;
  /** 序列开始后的毫秒数（MilliSecs()-seq_start）；没有序列在播放时为 null，Cp_seqfade 随即移除。 */
  sequenceMs?: () => number | null;
}

/**
 * p_add 返回的粒子，对应原版 TCp。字段即原版 Tp 的同名字段，调用方可以在创建后改写
 * （如爆炸烟雾 a=fadein、fadein=0，投射物尾迹改 r）；方法对应原版对 TCp\h 的 Entity* 调用，可链式调用。
 */
export interface ParticleHandle {
  readonly typ: number;
  fx: number; fy: number; fz: number;
  r: number; g: number; b: number;
  a: number; size: number; rot: number; fadein: number;
  /** Tp\x、Tp\y：溅水的宽与高；Cp_seqfade 的开始与结束时间（序列毫秒）。 */
  sx: number; sy: number;
  /**
   * EntityColor，0..255。颜色另存一份，Cp_subsplatter 落地时按它给血泊上色（原版读 Tp\r/g/b，
   * 唯一的调用方 vomit 把同一组值同时写进 Tp\r/g/b 与 EntityColor）；字段 r/g/b 在别的类型里是速率，不覆盖。
   */
  color(r: number, g: number, b: number): ParticleHandle;
  /** Tp\frame：Cp_subsplatter 落地时生成血泊的方式（0 随机小血泊、1 随机小血泊并上色、2 必定大血泊并上色）。 */
  frame(n: number): ParticleHandle;
  /** Tp\fx：Cp_spawn 的推进倍率（corona 的 speed）。 */
  speed(fx: number): ParticleHandle;
  /** EntityBlend 3。 */
  additive(): ParticleHandle;
  /** EntityBlend：1 普通混合，3 叠加。 */
  blend(mode: 1 | 3): ParticleHandle;
  /** EntityAlpha：只改显示的透明度，不改字段 a。 */
  alpha(a: number): ParticleHandle;
  /** EntityOrder：负值不做深度测试并画在其他物体之后。 */
  order(n: number): ParticleHandle;
  /** TranslateEntity，Blitz 坐标。 */
  translate(dx: number, dy: number, dz: number): ParticleHandle;
  /**
   * p_parent：目标存在时记下与它的 x/z 偏移，之后 Cp_spawn 每帧按目标 x/z 加偏移放置，高度保持自身。
   * 目标返回 null（单位已不存在）时这一帧不跟随，粒子照常淡出，与原版 p_toparent 一致。坐标为 Blitz 坐标。
   */
  follow(target: () => { x: number; y: number; z: number } | null): ParticleHandle;
}

/**
 * 101..104 的参数，对应原版调用方经 tmp_ph 交来的实体与 p_add 的 y#、z#、a#：
 * - fadeout：alpha 为起始透明度（y#），speed 为每帧减少量（z#）；
 * - fall：倒下方向随机，不需要参数；
 * - resfade：speed 为每帧透明度减少量（y#），grow 为每帧三轴缩放增加量（z#），
 *   alpha 与 scale 为调用方随后写入的 TCp\a 与 TCp\fx/fy/fz（物品的 alpha 与 scale）；
 * - stuck：alpha 为起始透明度（a#，物品的 alpha），每帧减少 0.01。
 */
export type ParticleAnimation =
  | { typ: typeof P.fadeout; alpha: number; speed: number }
  | { typ: typeof P.fall }
  | { typ: typeof P.resfade; speed: number; grow: number; alpha: number; scale: readonly [number, number, number] }
  | { typ: typeof P.stuck; alpha: number };

const DEG = Math.PI / 180;
const sin = (deg: number) => Math.sin(deg * DEG);
const cos = (deg: number) => Math.cos(deg * DEG);

const SPRITES = '/sprites/';
const TEX = {
  flare: [0, 1, 2].map(i => `${SPRITES}flare${i}_a.bmp`),
  bubbles: [0, 1].map(i => `${SPRITES}bubbles${i}_a.bmp`),
  roundwave: `${SPRITES}roundwave0_a.bmp`,
  wave: `${SPRITES}wave0_a.bmp`,
  smoke: [0, 1].map(i => `${SPRITES}smoke${i}_a.bmp`),
  spark: `${SPRITES}spark0_a.bmp`,
  splatter: [0, 1, 2].map(i => `${SPRITES}splatter${i}_a.bmp`),
  woodfrag: [0, 1, 2, 3, 4].map(i => `${SPRITES}woodfrag${i}_a.bmp`),
  flames: `${SPRITES}flames0_a.png`,
  starflare: `${SPRITES}starflare_a.bmp`,
  puddle: `${SPRITES}puddle0_a.bmp`,
  shockwave: `${SPRITES}shockwave_a.bmp`,
  splash: `${SPRITES}splash0_a.bmp`,
  attack: [`${SPRITES}attack1_a.bmp`, `${SPRITES}attack2_a.bmp`],
  rain: '/sys/gfx/rain_a.bmp',
  snow: '/sys/gfx/snow_a.bmp',
};
const ALL_TEXTURES = Object.values(TEX).flat();
/** 自带 alpha 通道、普通混合时不另算 alpha 的贴图。 */
const ALPHA_TEXTURES = new Set([TEX.flames]);

/** 粒子所在的坐标系：世界、camxz 支点（只跟随镜头 x/z）、镜头。 */
const WORLD = 0, CAMXZ = 1, CAMERA = 2;
/** 全屏层（Cp_fade/seqfade/flash）与 EntityOrder 负值的绘制顺序基数。 */
const ORDER_STEP = 1000;

type PMat = THREE.SpriteMaterial | THREE.MeshBasicMaterial | THREE.MeshLambertMaterial;

class Part implements ParticleHandle {
  fx = 0; fy = 0; fz = 0;
  r = 0; g = 0; b = 0;
  a = 0; size = 1; rot = 0; fadein = 0;
  sx = 0; sy = 0;
  kind = 0;
  /** EntityColor 设下的颜色，0..255。 */
  cr = 255; cg = 255; cb = 255;

  /** 实体位置（Blitz），WORLD 为世界坐标，CAMXZ 与 CAMERA 为相对支点或镜头的局部坐标。 */
  px = 0; py = 0; pz = 0;
  space = WORLD;
  /** SpriteViewMode：1 朝向镜头，2 固定朝向，4 只绕竖轴转向镜头；0 为普通网格（爆炸球、血泊）。 */
  view = 1;
  pitch = 0; yaw = 0; roll = 0;
  /** ScaleSprite 的宽高。 */
  w = 1; h = 1;
  /** EntityAlpha 设下的透明度。 */
  shown = 1;
  autofade: [number, number] | null = null;
  obj: THREE.Object3D | null = null;
  mat: PMat | null = null;
  raw: THREE.Texture | null = null;
  ownGeometry: THREE.BufferGeometry | null = null;
  blendMode: 1 | 3 = 1;
  target: (() => { x: number; y: number; z: number } | null) | null = null;
  parentX = 0; parentZ = 0;
  dead = false;

  constructor(readonly typ: number, private readonly owner: Particles) {}

  color(r: number, g: number, b: number): ParticleHandle {
    this.cr = r; this.cg = g; this.cb = b;
    const c = (v: number) => Math.min(255, Math.max(0, v)) / 255;
    this.mat?.color.setRGB(c(r), c(g), c(b));
    return this;
  }
  frame(n: number): ParticleHandle {
    this.kind = n;
    return this;
  }
  speed(fx: number): ParticleHandle {
    this.fx = fx;
    return this;
  }
  additive(): ParticleHandle { return this.blend(3); }
  blend(mode: 1 | 3): ParticleHandle {
    this.owner.setBlend(this, mode);
    return this;
  }
  alpha(a: number): ParticleHandle {
    this.shown = a;
    this.owner.sync(this);
    return this;
  }
  order(n: number): ParticleHandle {
    if (this.mat && n !== 0) {
      this.mat.depthTest = false;
      if (this.obj) this.obj.renderOrder = -n * ORDER_STEP;
    }
    return this;
  }
  translate(dx: number, dy: number, dz: number): ParticleHandle {
    this.px += dx; this.py += dy; this.pz += dz;
    this.owner.sync(this);
    return this;
  }
  follow(target: () => { x: number; y: number; z: number } | null): ParticleHandle {
    const t = target();
    if (t) {
      this.target = target;
      this.parentX = this.px - t.x;
      this.parentZ = this.pz - t.z;
    }
    return this;
  }
}

interface Anim {
  typ: number;
  obj: THREE.Object3D;
  a: number; r: number; g: number;
  fx: number; fy: number; fz: number;
  mats: { m: THREE.Material; base: number }[];
  onDone?: () => void;
}

export class Particles {
  readonly group = new THREE.Group();
  private readonly camxz = new THREE.Group();
  private readonly camRig = new THREE.Group();
  private readonly parts: Part[] = [];
  private readonly anims: Anim[] = [];
  private readonly tex = new Map<string, THREE.Texture>();
  private readonly lum = new WeakMap<THREE.Texture, THREE.Texture>();
  private readonly lumList: THREE.Texture[] = [];
  private readonly hasAlpha = new WeakSet<THREE.Texture>();
  private readonly spritePool: THREE.SpriteMaterial[] = [];
  private readonly basicPool: THREE.MeshBasicMaterial[] = [];
  private readonly plane = new THREE.PlaneGeometry(2, 2);
  /** CreateSphere 默认 8 段。 */
  private readonly sphere = new THREE.SphereGeometry(1, 16, 8);
  private readonly random: () => number;
  private readonly ready: Promise<void>;
  private readonly camPos = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly turn = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(private readonly d: ParticleDeps) {
    this.random = d.random ?? Math.random;
    this.group.name = 'particles';
    this.camxz.name = 'camxz';
    this.camRig.name = 'camera-particles';
    this.camRig.matrixAutoUpdate = false;
    this.group.add(this.camxz, this.camRig);
    d.scene.add(this.group);
    this.ready = this.loadAll();
  }

  /** 全部粒子贴图加载完毕（失败的跳过）时兑现；贴图未就绪的粒子类型不创建。 */
  load(): Promise<void> {
    return this.ready;
  }

  get count(): number {
    return this.parts.length + this.anims.length;
  }

  get all(): readonly ParticleHandle[] {
    return this.parts;
  }

  private async loadAll(): Promise<void> {
    await Promise.all(ALL_TEXTURES.map(async url => {
      let t: THREE.Texture | null = null;
      try {
        t = await this.d.textures(url);
      } catch {
        t = null;
      }
      if (!t) return;
      if (url === TEX.rain) {
        // ScaleTexture gfx_rain,1,3：竖向拉长 3 倍
        t = t.clone();
        t.repeat.set(1, 1 / 3);
        t.needsUpdate = true;
      }
      if (ALPHA_TEXTURES.has(url)) this.hasAlpha.add(t);
      this.tex.set(url, t);
    }));
  }

  private rnd(a: number, b: number): number {
    return a + this.random() * (b - a);
  }

  /** Blitz Rand：闭区间整数，单参数时为 1..a。 */
  private rand(a: number, b?: number): number {
    if (b === undefined) { b = a; a = 1; }
    return a + Math.floor(this.random() * (b - a + 1));
  }

  private t(url: string): THREE.Texture | null {
    return this.tex.get(url) ?? null;
  }

  /** p_add：创建 3D 粒子，坐标为 Blitz 坐标。贴图未就绪或火焰落在水下时不创建，返回 null。 */
  add(x: number, y: number, z: number, typ: number, size = 1, a = 1): ParticleHandle | null {
    this.syncCamera();
    const p = new Part(typ, this);
    p.px = x; p.py = y; p.pz = z;
    p.size = size;
    switch (typ) {
      case P.attack: {
        const right = x > 0;
        if (!this.sprite(p, this.t(TEX.attack[right ? 0 : 1]), 3)) return null;
        p.r = right ? 1 : 0;
        p.rot = right ? 20 : -20;
        this.scale(p, size, size);
        // 镜头前 10、下方 7，随后挂到镜头上
        p.space = CAMERA;
        p.px = 0; p.py = -7; p.pz = 10;
        p.shown = a;
        p.a = a;
        p.order(-5);
        break;
      }
      case P.debug:
        this.sprite(p, null, 1, true);
        p.a = a;
        break;
      case P.bubbles:
        if (!this.sprite(p, this.t(TEX.bubbles[this.rand(0, 1)]), 3)) return null;
        this.scale(p, size, size);
        p.fy = this.rnd(0.3, 1);
        p.a = a;
        break;
      case P.rwave:
        if (!this.sprite(p, this.t(TEX.roundwave), 3, false, 2)) return null;
        this.scale(p, size, size);
        p.rot = this.rand(360);
        p.fy = this.rnd(0.05, 0.1);
        p.a = a;
        if (this.d.diving()) {
          p.py = -1;
          this.rotate(p, -90, 0, -90);
        } else {
          p.py = 2;
          this.rotate(p, 90, 0, 90);
        }
        break;
      case P.splash:
        if (!this.sprite(p, this.t(TEX.splash), 3, false, 4)) return null;
        this.scale(p, size, size);
        p.py = y + 1;
        p.shown = a;
        p.sx = size;
        p.sy = size;
        p.a = a;
        p.fx = size / 15;
        break;
      case P.wave: {
        if (!this.sprite(p, this.t(TEX.wave), 3, false, 2)) return null;
        p.py = 1;
        this.scale(p, size, size);
        this.rotate(p, 90, 0, 90);
        p.rot = a - 90;
        p.fy = a + this.rnd(-5, 5);
        p.a = this.rnd(-0.1, 0.01);
        p.shown = p.a;
        const push = (lo: number, hi: number) => {
          p.px += sin(p.fy) * this.rnd(lo, hi);
          p.pz += -cos(p.fy) * this.rnd(lo, hi);
        };
        push(40, 50);
        if (this.rand(10) === 1) {
          push(20, 30);
          if (this.rand(3) === 1) push(20, 30);
        }
        p.autofade = [1000, 1500];
        p.fadein = this.rnd(0.7, 1);
        break;
      }
      case P.hover: {
        let tex: THREE.Texture | null;
        const pick = this.rand(9);
        if (pick <= 3) tex = this.t(TEX.spark);
        else if (pick <= 8) tex = this.t(TEX.splatter[this.rand(0, 2)]);
        else tex = this.t(TEX.woodfrag[this.rand(0, 4)]);
        if (!this.sprite(p, tex, 3)) return null;
        this.scale(p, size, size);
        p.color(this.rand(200, 255), this.rand(240, 255), this.rand(220, 255));
        p.a = 0;
        p.shown = 0;
        p.fadein = this.rnd(0.2, 0.45);
        p.r = this.rnd(-5, 5);
        p.fx = this.rnd(-0.5, 0.5);
        p.fy = this.rnd(-0.5, 0.5);
        p.fz = this.rnd(-0.5, 0.5);
        break;
      }
      case P.smoke: {
        if (!this.sprite(p, this.t(TEX.smoke[this.rand(0, 1)]), 1)) return null;
        this.scale(p, size, size);
        const c = this.rand(100, 150);
        p.color(c, c, c);
        p.rot = this.rand(360);
        p.fx = this.rnd(0.05, 0.1);
        p.fy = this.rnd(0.15, 0.35);
        p.fz = this.rnd(-1.5, 1.5);
        p.r = 0.007;
        p.a = 0;
        p.fadein = a;
        p.shown = 0;
        break;
      }
      case P.spark:
        if (!this.sprite(p, this.t(TEX.spark), 3)) return null;
        this.scale(p, size, size);
        p.color(255, this.rand(50, 255), 0);
        p.rot = this.rand(360);
        p.fx = this.rnd(-2, 2);
        p.fy = this.rnd(-2, 2);
        p.fz = this.rnd(-2, 2);
        p.a = a;
        break;
      case P.splatter:
        if (!this.sprite(p, this.t(TEX.splatter[this.rand(0, 2)]), 1)) return null;
        this.scale(p, size, size);
        p.color(this.rand(150, 200), 0, 0);
        p.rot = this.rand(360);
        p.fx = this.rnd(-2, 2);
        p.fy = this.rnd(-2, 2);
        p.fz = this.rnd(-2, 2);
        p.a = a;
        break;
      case P.subsplatter:
        if (!this.sprite(p, this.t(TEX.splatter[this.rand(0, 2)]), 1)) return null;
        this.scale(p, size, size);
        p.color(this.rand(150, 200), 0, 0);
        p.rot = this.rand(360);
        p.a = a;
        break;
      case P.wood:
        if (!this.sprite(p, this.t(TEX.woodfrag[this.rand(0, 4)]), 1)) return null;
        this.scale(p, size, size);
        p.color(this.rand(65, 100), 40, 0);
        p.rot = this.rand(360);
        p.fx = this.rnd(-2, 2);
        p.fy = this.rnd(-2, 1);
        p.fz = this.rnd(-2, 2);
        p.a = a;
        p.fadein = this.rnd(-35, 35);
        break;
      case P.puddle:
        if (!this.puddle(p, x, z, size)) return null;
        p.color(this.rand(100, 160), 0, 0);
        p.a = a;
        p.shown = a;
        break;
      case P.flames: {
        p.px += this.rnd(-1.8, 1.8);
        p.py += this.rnd(-1.8, 1.8);
        p.pz += this.rnd(-1.8, 1.8);
        if (y < 0) {
          // 水下的火焰换成烟和气泡
          if (this.rand(3) === 1) this.add(x, y, z, P.smoke, this.rnd(3, 5), this.rnd(0.3, 0.5));
          if (this.rand(20) === 1) this.add(x, y, z, P.bubbles, this.rnd(1, 3));
          return null;
        }
        if (!this.sprite(p, this.t(TEX.flames), 3)) return null;
        this.scale(p, size, size * 1.7);
        p.fy = size * 1.7;
        p.a = a;
        break;
      }
      case P.firespark:
        p.px += this.rnd(-2, 2);
        p.py += this.rnd(-2, 2);
        p.pz += this.rnd(-2, 2);
        if (!this.sprite(p, this.t(TEX.spark), 3)) return null;
        this.scale(p, size, size);
        p.color(255, this.rand(50, 255), 0);
        p.rot = this.rand(360);
        p.a = a;
        p.fy = this.rnd(0.5, 2);
        p.fx = this.rand(360);
        p.fz = this.rand(360);
        break;
      case P.risingflare:
        if (!this.sprite(p, this.t(TEX.flare[1]), 3)) return null;
        this.scale(p, size, size);
        p.color(255, 0, 0);
        p.rot = this.rand(360);
        p.fx = this.rnd(0.05, 0.1);
        p.fy = this.rnd(0.3, 0.5);
        p.fz = this.rnd(-5, 5);
        p.a = a;
        break;
      case P.explode: {
        const tex = this.t(TEX.smoke[this.rand(0, 1)]);
        if (!tex) return null;
        const mat = this.basicMaterial(tex, 3);
        const mesh = new THREE.Mesh(this.sphere, mat);
        p.obj = mesh;
        p.mat = mat;
        p.raw = tex;
        p.blendMode = 3;
        p.view = 0;
        this.group.add(mesh);
        p.color(255, this.rand(50, 255), 0);
        p.rot = this.rand(360);
        this.rotate(p, this.rnd(0, 360), this.rnd(0, 360), this.rnd(0, 360));
        p.shown = a;
        p.a = a;
        break;
      }
      case P.shockwave:
        if (!this.sprite(p, this.t(TEX.shockwave), 3, false, 2)) return null;
        this.scale(p, size, size);
        p.rot = this.rand(360);
        p.fy = this.rnd(0.5, 0.7);
        p.a = a;
        this.rotate(p, 90, 0, 90);
        p.color(255, this.rand(50, 200), 0);
        break;
      case P.starflare:
        if (!this.sprite(p, this.t(TEX.starflare), 3)) return null;
        this.scale(p, size, size);
        p.color(this.rand(50, 150), 150, 0);
        p.rot = this.rand(360);
        p.fx = this.rnd(0.02, 0.06);
        p.fy = this.rnd(0.10, 0.20);
        p.fz = this.rnd(-5, 5);
        p.r = this.rnd(0.007, 0.01);
        p.a = a;
        break;
      case P.spawn:
        if (!this.sprite(p, this.t(TEX.starflare), 3, false, 4)) return null;
        this.scale(p, size, size * 2.5);
        p.color(this.rand(50, 150), 150, 0);
        p.fy = size * 2.5;
        p.a = a;
        p.fz = 1;
        p.fx = 1;
        break;
      case P.impact:
        if (!this.sprite(p, this.t(TEX.flare[0]), 3)) return null;
        this.scale(p, size, size);
        p.color(255, this.rand(150, 255), 150);
        p.rot = this.rand(360);
        p.shown = a;
        p.a = a;
        break;
      case P.rain:
        if (!this.sprite(p, this.t(TEX.rain), 3, false, 4, this.camxz)) return null;
        p.a = 0.1;
        this.scale(p, size, size * 2);
        p.shown = a;
        this.toCamxz(p, x, this.camPos.y + this.rand(100, 150), z);
        p.fy = this.rnd(6, 8);
        p.rot = this.rnd(-3, 3);
        break;
      case P.snow:
        if (!this.sprite(p, this.t(TEX.snow), 3, false, 1, this.camxz)) return null;
        p.a = 0.1;
        this.scale(p, size, size);
        p.shown = a;
        this.toCamxz(p, x, this.camPos.y + this.rand(100, 200), z);
        p.fy = this.rnd(3, 4);
        p.rot = this.rnd(0, 360);
        break;
      case P.fade:
        this.overlay(p);
        p.fx = size;
        p.a = 0;
        p.fadein = a;
        p.shown = 0;
        break;
      case P.seqfade:
        this.overlay(p);
        break;
      case P.flash:
        this.overlay(p);
        p.a = a;
        p.fx = size;
        break;
      default:
        return null;
    }
    this.parts.push(p);
    this.sync(p);
    return p;
  }

  /** p_explosion 的粒子部分：三层爆炸球、冲击波与火光烟雾；爆炸音效由调用方播放。 */
  explosion(x: number, y: number, z: number, size: number): void {
    for (let i = 0; i < 3; i++) this.add(x, y, z, P.explode, size, this.rnd(1, 1.5));
    this.add(x, y + 15, z, P.shockwave, size * 3);
    for (let i = 0; i < 10; i++) {
      const fire = this.add(x + this.rnd(-size * 5, size * 5), y + this.rnd(0, size * 3), z + this.rnd(-size * 3, size * 3), P.smoke, this.rnd(10, 30), this.rnd(0.9, 1.5));
      fire?.color(255, this.rand(50, 200), 0).additive();
      if (fire) {
        fire.a = fire.fadein;
        fire.fadein = 0;
      }
      if (this.rand(4) !== 1) {
        if (fire) fire.alpha(fire.a);
        this.add(x + this.rnd(-size * 3, size * 3), y + this.rnd(size, size * 3), z + this.rnd(-size * 3, size * 3), P.smoke, this.rnd(10, 30), this.rnd(0.9, 1.5));
      }
    }
  }

  /**
   * 原版 p_add 的 101..104：驱动已有的场景对象。透明度改在对象自己的材质副本上，不影响共享材质。
   * 原版释放实体时调用 onDone；不传 onDone 时把对象从父节点摘下。
   */
  animate(object: THREE.Object3D, anim: ParticleAnimation, onDone?: () => void): void {
    const a: Anim = { typ: anim.typ, obj: object, a: 0, r: 0, g: 0, fx: 0, fy: 0, fz: 0, mats: [], onDone };
    switch (anim.typ) {
      case P.fadeout:
        a.a = anim.alpha;
        a.fx = anim.speed;
        break;
      case P.fall:
        a.fx = this.rand(0, 1) ? -1 : 1;
        a.fz = this.rand(0, 1) ? -1 : 1;
        break;
      case P.resfade:
        a.r = anim.speed;
        a.g = anim.grow;
        a.a = anim.alpha;
        [a.fx, a.fy, a.fz] = anim.scale;
        object.scale.set(a.fx, a.fy, a.fz);
        break;
      case P.stuck:
        a.a = anim.alpha;
        break;
    }
    if (anim.typ !== P.fall) this.ownMaterials(a);
    this.anims.push(a);
  }

  /** p_update 的 3D 部分。 */
  update(dtMs: number): void {
    const f = dtMs / 20;
    this.syncCamera();
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      if (p.dead) continue;
      this.step(p, f);
      if (!p.dead) this.sync(p);
    }
    let n = 0;
    for (const p of this.parts) if (!p.dead) this.parts[n++] = p;
    this.parts.length = n;

    n = 0;
    for (const a of this.anims) if (this.stepAnim(a, f)) this.anims[n++] = a;
    this.anims.length = n;
  }

  /** 换地图时清空全部粒子；实体动画直接放弃，对象随地图一起释放。 */
  clear(): void {
    for (const p of this.parts) this.release(p);
    this.parts.length = 0;
    for (const a of this.anims) this.restoreMaterials(a);
    this.anims.length = 0;
  }

  dispose(): void {
    this.clear();
    for (const m of this.spritePool) m.dispose();
    for (const m of this.basicPool) m.dispose();
    this.spritePool.length = 0;
    this.basicPool.length = 0;
    for (const t of this.lumList) t.dispose();
    this.lumList.length = 0;
    this.tex.get(TEX.rain)?.dispose();
    this.plane.dispose();
    this.sphere.dispose();
    this.group.removeFromParent();
  }

  private step(p: Part, f: number): void {
    switch (p.typ) {
      case P.attack:
        p.rot += p.r === 1 ? -30 * f : 30 * f;
        p.a -= 0.075 * f;
        p.shown = p.a;
        if (p.a < 0) this.kill(p);
        break;
      case P.debug:
        p.a -= 0.03 * f;
        p.shown = p.a;
        if (p.a < 0) this.kill(p);
        break;
      case P.bubbles:
        p.py += p.fy * f;
        p.a -= 0.01 * f;
        p.shown = p.a;
        if (p.py > -3 || p.a < 0) {
          if (p.py > -3) this.add(p.px, 1, p.pz, P.rwave, p.size * this.rnd(1, 2), 0.4);
          this.kill(p);
        }
        break;
      case P.rwave:
        p.size += p.fy * f;
        this.scale(p, p.size, p.size);
        p.a -= 0.02 * f;
        p.shown = p.a;
        if (p.a < 0) this.kill(p);
        break;
      case P.splash:
        p.a -= 0.05 * f;
        if (p.a > 0.6) {
          p.sx += p.fx * f;
          p.sy += p.fx * 2 * f;
        } else {
          p.sx += p.fx * 2 * f;
          p.sy -= p.fx * 2 * f;
        }
        this.scale(p, p.sx, p.sy);
        p.shown = p.a;
        if (p.a < 0) this.kill(p);
        break;
      case P.wave:
        p.size += 0.1 * f;
        this.scale(p, p.size, p.size);
        if (p.fx === 0) {
          p.a += 0.01 * f;
          if (p.a > p.fadein) {
            p.a = p.fadein;
            p.fx = 1;
          }
        } else {
          p.a -= 0.04 * f;
        }
        p.shown = p.a;
        p.px += -sin(p.fy) * f * 0.4;
        p.pz += cos(p.fy) * f * 0.4;
        if (p.fx === 1 && p.a < 0) this.kill(p);
        break;
      case P.hover:
        p.px += p.fx * f;
        p.py += p.fy * f;
        p.pz += p.fz * f;
        p.rot += p.r * f;
        if (p.fadein > 0) {
          p.a += 0.01 * f;
          p.shown = p.a;
          if (p.a >= p.fadein) {
            p.a = p.fadein;
            p.fadein = 0;
          }
          if (p.py > -10) {
            p.py = -10;
            p.fy = 0;
          }
        } else {
          p.a -= 0.002 * f;
          p.shown = p.a;
          if (p.a < 0) {
            this.kill(p);
          } else if (p.py > -10) {
            p.py = -10;
            p.fy = 0;
          }
        }
        break;
      case P.smoke:
        if (p.fadein > 0) {
          p.a += 0.034 * f;
          if (p.a >= p.fadein) {
            p.a = p.fadein;
            p.fadein = 0;
          }
          p.shown = p.a;
          p.size += p.fx * f;
          this.scale(p, p.size, p.size);
          p.py += p.fy * f;
          p.rot += p.fz * f;
        } else {
          p.size += p.fx * f;
          this.scale(p, p.size, p.size);
          p.py += p.fy * f;
          p.a -= p.r * f;
          p.shown = p.a;
          p.rot += p.fz * f;
          if (p.a < 0) this.kill(p);
        }
        break;
      case P.spark:
      case P.wood: {
        p.rot += p.fadein * f;
        p.fx *= 0.96;
        p.fz *= 0.96;
        p.px += p.fx * 2.5 * f;
        p.py += p.fy * 2.5 * f;
        p.pz += p.fz * 2.5 * f;
        p.a -= 0.025 * f;
        p.shown = p.a;
        // 原版带碰撞体，这里只停在地面上
        const ground = this.d.terrainY(p.px, p.pz);
        if (ground > p.py) {
          p.py = ground;
          p.fx = p.fy = p.fz = 0;
          p.fadein = 0;
        } else {
          p.fy -= 0.3 * f;
        }
        if (p.py < 0) {
          this.add(p.px, p.py, p.pz, P.smoke, this.rnd(1, 3), this.rnd(0.5, 0.9));
          this.add(p.px, p.py, p.pz, P.bubbles, this.rnd(1, 3), this.rnd(0.5, 0.9));
          p.a = -1;
        }
        if (p.a < 0) this.kill(p);
        break;
      }
      case P.splatter:
        p.fx *= 0.96;
        p.fy -= 0.3 * f;
        p.fz *= 0.96;
        if (p.py > -2) {
          p.a -= 0.05 * f;
          p.px += p.fx * 1.5 * f;
          p.py += p.fy * 2.5 * f;
          p.pz += p.fz * 1.5 * f;
          this.add(p.px, p.py, p.pz, P.subsplatter, this.rnd(2, 3), this.rnd(0.5, 1));
          if (this.d.terrainY(p.px, p.pz) >= p.py) {
            this.add(p.px, 0, p.pz, P.puddle, this.rnd(4, 10), this.rnd(0.5, 0.8));
            this.kill(p);
          } else {
            p.shown = p.a;
            if (p.a < 0) this.kill(p);
          }
        } else {
          p.size += 0.6 * f;
          this.scale(p, p.size, p.size);
          p.a -= 0.01 * f;
          if (p.a > 0.5) p.a = 0.5;
          p.shown = p.a;
          if (p.a < 0) this.kill(p);
        }
        break;
      case P.subsplatter:
        p.a -= 0.07 * f;
        if (this.d.terrainY(p.px, p.pz) >= p.py) {
          if (p.kind < 2) {
            if (this.rand(3) === 1) {
              const puddle = this.add(p.px, 0, p.pz, P.puddle, this.rnd(3, 5), this.rnd(0.3, 0.5));
              if (p.kind !== 0) puddle?.color(p.cr, p.cg, p.cb);
            }
          } else {
            this.add(p.px, 0, p.pz, P.puddle, this.rnd(4, 10), this.rnd(0.5, 0.8))?.color(p.cr, p.cg, p.cb);
          }
          this.kill(p);
        } else {
          p.py -= 2 * f;
          p.shown = p.a;
          if (p.a < 0) this.kill(p);
        }
        break;
      case P.puddle:
        p.a -= 0.005 * f;
        p.shown = p.a;
        if (p.a < 0) this.kill(p);
        break;
      case P.flames:
        p.py += 0.5 * f;
        p.size -= 0.15 * f;
        this.scale(p, p.size, p.fy);
        p.a -= 0.03 * f;
        p.shown = p.a;
        if (p.a < 0 || p.size < 0) {
          if (this.rand(3) === 1) {
            const smoke = this.add(p.px, p.py, p.pz, P.smoke, this.rnd(3, 5), this.rnd(0.1, 0.3));
            if (smoke) {
              smoke.r = 0.002;
              smoke.fx = this.rnd(0.1, 0.2);
              smoke.fy = this.rnd(0.4, 0.6);
            }
          }
          this.kill(p);
        }
        break;
      case P.firespark:
        p.fx = (p.fx + 10 * f) % 360;
        p.fz = (p.fz + 10 * f) % 360;
        p.px += sin(p.fx) * f;
        p.py += p.fy * f;
        p.pz += cos(p.fz) * f;
        p.a -= 0.02 * f;
        p.shown = p.a;
        if (p.a < 0) this.kill(p);
        break;
      case P.risingflare:
        p.size += p.fx * f;
        this.scale(p, p.size, p.size);
        p.py += p.fy * f;
        p.a -= 0.01 * f;
        p.shown = p.a;
        p.rot += p.fz * f;
        if (p.a < 0) this.kill(p);
        break;
      case P.explode:
        p.size += 5 * f;
        p.a -= 0.05 * f;
        p.shown = p.a;
        if (p.a < 0) this.kill(p);
        break;
      case P.shockwave:
        p.size += p.fy * f;
        this.scale(p, p.size, p.size);
        p.a -= 0.04 * f;
        p.shown = p.a;
        if (p.a < 0) this.kill(p);
        break;
      case P.starflare:
        p.size -= p.fx * f;
        if (p.size > 0) {
          this.scale(p, p.size, p.size);
          p.py += p.fy * f;
          p.a -= p.r * f;
          p.shown = p.a;
          p.rot += p.fz * f;
          if (p.a < 0) this.kill(p);
        } else {
          this.kill(p);
        }
        break;
      case P.spawn: {
        const k = p.fx * f * p.fz;
        p.py += 0.1 * k;
        p.size -= 0.01 * k;
        p.fy += 1.8 * k;
        this.scale(p, p.size, p.fy);
        p.a -= 0.02 * k;
        p.shown = p.a;
        if (p.target) {
          const t = p.target();
          if (t) {
            p.px = t.x + p.parentX;
            p.pz = t.z + p.parentZ;
          }
        }
        if (p.a < 0 || p.size < 0) this.kill(p);
        break;
      }
      case P.impact:
        p.size += 1.5 * f;
        this.scale(p, p.size, p.size);
        p.a -= 0.05 * f;
        p.shown = p.a;
        if (p.a < 0) this.kill(p);
        break;
      case P.rain:
      case P.snow:
        p.a += (p.typ === P.rain ? 0.05 : 0.02) * f;
        p.shown = p.a;
        p.py -= p.fy * f;
        if (p.py < 0) this.kill(p);
        break;
      case P.fade:
        if (p.fadein > 0) {
          p.a += p.fx * f;
          if (p.a > p.fadein) {
            p.a = p.fadein;
            p.fadein = 0;
          }
          p.shown = p.a;
        } else {
          p.a -= p.fx * f;
          p.shown = p.a;
          if (p.a < 0) this.kill(p);
        }
        break;
      case P.seqfade:
        this.stepSeqFade(p);
        break;
      case P.flash:
        p.a -= p.fx * f;
        p.shown = p.a;
        if (p.a < 0) this.kill(p);
        break;
    }
  }

  /**
   * Cp_seqfade：sx..sy 为序列时间内的起止毫秒，fx 为模式（0 渐显再渐隐、1 渐显、2 渐隐）。
   * 模式 0 的后半段原版按 1-t1/(t2/2) 计算，结果为负，于是渐显到顶后直接消失。
   */
  private stepSeqFade(p: Part): void {
    const seq = this.d.sequenceMs?.() ?? null;
    if (seq === null) {
      this.kill(p);
      return;
    }
    const time = Math.trunc(seq) + 1;
    const end = Math.round(p.sy), start = Math.round(p.sx);
    if (time > end) {
      this.kill(p);
      return;
    }
    const t1 = time - start;
    const t2 = end - start;
    switch (Math.round(p.fx)) {
      case 0: {
        const t3 = Math.trunc(t2 / 2);
        p.shown = t1 <= t3 ? t1 / t3 : 1 - t1 / t3;
        break;
      }
      case 1:
        p.shown = t1 / t2;
        break;
      case 2:
        p.shown = 1 - t1 / t2;
        break;
    }
  }

  /** 返回 false 表示动画结束、已移出列表。 */
  private stepAnim(a: Anim, f: number): boolean {
    switch (a.typ) {
      case P.fadeout:
        a.a -= a.fx * f;
        this.objectAlpha(a);
        break;
      case P.fall: {
        a.obj.position.y -= 0.9 * f;
        // TurnEntity 0.55*fx,0,0.27*fz：局部俯仰与滚转，俯仰正值为俯，镜像后取负
        this.euler.set(-0.55 * a.fx * f * DEG, 0, 0.27 * a.fz * f * DEG, 'YXZ');
        a.obj.quaternion.multiply(this.turn.setFromEuler(this.euler));
        a.obj.updateWorldMatrix(true, false);
        const w = a.obj.getWorldPosition(this.tmp);
        if (w.y + 300 < this.d.terrainY(w.x, -w.z)) {
          this.finish(a);
          return false;
        }
        return true;
      }
      case P.resfade:
        a.a -= a.r * f;
        a.fx += a.g * f;
        a.fy += a.g * f;
        a.fz += a.g * f;
        this.objectAlpha(a);
        a.obj.scale.set(a.fx, a.fy, a.fz);
        break;
      case P.stuck:
        a.a -= 0.01 * f;
        this.objectAlpha(a);
        break;
    }
    if (a.a < 0) {
      this.finish(a);
      return false;
    }
    return true;
  }

  private finish(a: Anim): void {
    if (a.onDone) a.onDone();
    else a.obj.removeFromParent();
    this.restoreMaterials(a);
  }

  /** 给对象换上自己的材质副本，记下原透明度；EntityAlpha 与材质自带透明度相乘。 */
  private ownMaterials(a: Anim): void {
    a.obj.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.material) return;
      const own = (src: THREE.Material): THREE.Material => {
        const c = src.clone();
        c.transparent = true;
        a.mats.push({ m: c, base: src.opacity });
        return c;
      };
      m.material = Array.isArray(m.material) ? m.material.map(own) : own(m.material);
    });
    this.objectAlpha(a);
  }

  private objectAlpha(a: Anim): void {
    const k = Math.min(1, Math.max(0, a.a));
    for (const { m, base } of a.mats) {
      m.opacity = base * k;
      m.visible = k > 0;
    }
  }

  private restoreMaterials(a: Anim): void {
    for (const { m } of a.mats) m.dispose();
    a.mats.length = 0;
  }

  private syncCamera(): void {
    const cam = this.d.camera;
    cam.updateWorldMatrix(true, false);
    this.camPos.setFromMatrixPosition(cam.matrixWorld);
    this.camxz.position.set(this.camPos.x, 0, this.camPos.z);
    this.camRig.matrix.copy(cam.matrixWorld);
    this.camRig.matrixWorldNeedsUpdate = true;
  }

  /** 挂到 camxz 时保留世界位置：记录相对支点的偏移（Blitz 坐标）。 */
  private toCamxz(p: Part, x: number, y: number, z: number): void {
    p.space = CAMXZ;
    p.px = x - this.camxz.position.x;
    p.py = y;
    p.pz = z + this.camxz.position.z;
  }

  /** CreateSprite + EntityTexture + EntityBlend；需要贴图但还没就绪时返回 false。 */
  private sprite(p: Part, tex: THREE.Texture | null, blend: 1 | 3, untextured = false, view = 1, parent: THREE.Object3D = this.group): boolean {
    if (!tex && !untextured) return false;
    p.raw = tex;
    p.blendMode = blend;
    p.view = view;
    if (view === 1) {
      const mat = this.spriteMaterial(this.mapFor(tex, blend), blend);
      p.mat = mat;
      p.obj = new THREE.Sprite(mat);
    } else {
      const mat = this.basicMaterial(this.mapFor(tex, blend), blend);
      p.mat = mat;
      p.obj = new THREE.Mesh(this.plane, mat);
    }
    if (p.typ === P.attack) {
      p.obj.frustumCulled = false;
      p.obj.onBeforeRender = this.cameraFollower(p.obj);
      this.camRig.add(p.obj);
    } else {
      parent.add(p.obj);
    }
    return true;
  }

  /** Cp_fade/seqfade/flash：镜头前铺满视野、不做深度测试、最后绘制的无贴图方块。 */
  private overlay(p: Part): void {
    const mat = this.basicMaterial(null, 1);
    mat.depthTest = false;
    mat.fog = false;
    const mesh = new THREE.Mesh(this.plane, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5 * ORDER_STEP;
    mesh.onBeforeRender = this.cameraFollower(mesh);
    p.obj = mesh;
    p.mat = mat;
    p.view = 0;
    p.space = CAMERA;
    this.camRig.add(mesh);
  }

  /** 渲染前按实际渲染的镜头重算世界矩阵，镜头在本帧 update 之后移动也不会错位。 */
  private cameraFollower(obj: THREE.Object3D): THREE.Object3D['onBeforeRender'] {
    return (_renderer, _scene, camera) => {
      obj.matrixWorld.multiplyMatrices(camera.matrixWorld, obj.matrix);
    };
  }

  /** Cp_puddle：以 (x,0,z) 为原点、四角贴着地面上方 1.5 的随机朝向方块。 */
  private puddle(p: Part, x: number, z: number, size: number): boolean {
    const r = this.rand(360);
    const tex = this.rand(2) === 1 ? this.t(TEX.puddle) : this.t(TEX.splatter[this.rand(0, 2)]);
    if (!tex) return false;
    const uv = [[0, 1], [0, 0], [1, 0], [1, 1]];
    const pos: number[] = [];
    const uvs: number[] = [];
    for (let i = 0; i < 4; i++) {
      const ang = (r + 90 * i) % 360;
      const tx = sin(ang) * size;
      const tz = cos(ang) * size;
      pos.push(tx, this.d.terrainY(x + tx, z + tz) + 1.5, -tz);
      uvs.push(uv[i][0], 1 - uv[i][1]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex([2, 1, 0, 3, 0, 2]);
    geo.computeVertexNormals();
    // EntityFX 16：双面；网格受光照
    const mat = new THREE.MeshLambertMaterial({
      map: this.mapFor(tex, 1), transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    p.obj = mesh;
    p.mat = mat;
    p.raw = tex;
    p.ownGeometry = geo;
    p.view = 0;
    p.py = 0;
    this.group.add(mesh);
    return true;
  }

  private scale(p: Part, w: number, h: number): void {
    p.w = w;
    p.h = h;
  }

  /** RotateEntity，Blitz 角度。 */
  private rotate(p: Part, pitch: number, yaw: number, roll: number): void {
    p.pitch = pitch;
    p.yaw = yaw;
    p.roll = roll;
  }

  /** 把粒子状态写到场景对象：位置、朝向、尺寸与透明度。 */
  sync(p: Part): void {
    const obj = p.obj;
    if (!obj || !p.mat) return;
    if (p.typ === P.fade || p.typ === P.seqfade || p.typ === P.flash) {
      this.fitOverlay(obj);
    } else {
      obj.position.set(p.px, p.py, -p.pz);
      if (p.view === 1) {
        obj.scale.set(2 * p.w, 2 * p.h, 1);
        (p.mat as THREE.SpriteMaterial).rotation = p.rot * DEG;
      } else if (p.view === 2) {
        obj.scale.set(p.w, p.h, 1);
        obj.rotation.set(-p.pitch * DEG, p.yaw * DEG, (p.roll + p.rot) * DEG, 'YXZ');
      } else if (p.view === 4) {
        obj.scale.set(p.w, p.h, 1);
        const w = this.worldOf(p);
        obj.rotation.set(0, Math.atan2(this.camPos.x - w.x, this.camPos.z - w.z), p.rot * DEG, 'YXZ');
      } else if (p.typ === P.explode) {
        obj.scale.setScalar(p.size);
        obj.rotation.set(-p.pitch * DEG, p.yaw * DEG, p.roll * DEG, 'YXZ');
      }
    }
    let k = p.shown;
    if (p.autofade) {
      const [near, far] = p.autofade;
      const dist = this.worldOf(p).distanceTo(this.camPos);
      k *= dist <= near ? 1 : dist >= far ? 0 : (far - dist) / (far - near);
    }
    k = Math.min(1, Math.max(0, k));
    p.mat.opacity = k;
    obj.visible = k > 0;
  }

  /** 原版在镜头前 5 处放 20×20 的方块；这里放在近裁剪面外侧并按视野放大，保证铺满。 */
  private fitOverlay(obj: THREE.Object3D): void {
    const cam = this.d.camera as THREE.PerspectiveCamera;
    if (cam.isPerspectiveCamera) {
      const dist = cam.near * 2;
      const halfH = dist * Math.tan((cam.fov * DEG) / 2) / cam.zoom * 1.2;
      obj.position.set(0, 0, -dist);
      obj.scale.set(halfH * Math.max(1, cam.aspect), halfH, 1);
    } else {
      obj.position.set(0, 0, -5);
      obj.scale.set(10, 10, 1);
    }
  }

  private worldOf(p: Part): THREE.Vector3 {
    if (p.space === CAMXZ) return this.tmp.set(this.camxz.position.x + p.px, p.py, this.camxz.position.z - p.pz);
    return this.tmp.set(p.px, p.py, -p.pz);
  }

  setBlend(p: Part, mode: 1 | 3): void {
    if (!p.mat || p.blendMode === mode) return;
    p.blendMode = mode;
    p.mat.blending = mode === 3 ? THREE.AdditiveBlending : THREE.NormalBlending;
    p.mat.map = this.mapFor(p.raw, mode);
    p.mat.needsUpdate = true;
  }

  /** 叠加混合用原贴图；普通混合用亮度生成 alpha 的贴图（自带 alpha 的除外）。 */
  private mapFor(tex: THREE.Texture | null, blend: 1 | 3): THREE.Texture | null {
    if (!tex || blend === 3 || this.hasAlpha.has(tex)) return tex;
    return this.luminanceAlpha(tex);
  }

  /** Blitz 对无 alpha 通道贴图取 rgb 平均值作 alpha；颜色取白，交给材质颜色。没有图像数据时用原贴图。 */
  private luminanceAlpha(tex: THREE.Texture): THREE.Texture {
    const cached = this.lum.get(tex);
    if (cached) return cached;
    const img = tex.image as (CanvasImageSource & { width: number; height: number }) | null | undefined;
    if (typeof document === 'undefined' || !img || !img.width || !img.height) return tex;
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return tex;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      px[i + 3] = (px[i] + px[i + 1] + px[i + 2]) / 3;
      px[i] = px[i + 1] = px[i + 2] = 255;
    }
    ctx.putImageData(data, 0, 0);
    const out = new THREE.CanvasTexture(canvas);
    out.colorSpace = tex.colorSpace;
    out.wrapS = tex.wrapS;
    out.wrapT = tex.wrapT;
    out.repeat.copy(tex.repeat);
    out.offset.copy(tex.offset);
    this.lum.set(tex, out);
    this.lumList.push(out);
    return out;
  }

  private spriteMaterial(map: THREE.Texture | null, blend: 1 | 3): THREE.SpriteMaterial {
    const m = this.spritePool.pop() ?? new THREE.SpriteMaterial();
    m.map = map;
    m.rotation = 0;
    this.resetMaterial(m, blend);
    return m;
  }

  private basicMaterial(map: THREE.Texture | null, blend: 1 | 3): THREE.MeshBasicMaterial {
    const m = this.basicPool.pop() ?? new THREE.MeshBasicMaterial();
    m.map = map;
    m.side = THREE.DoubleSide;
    this.resetMaterial(m, blend);
    return m;
  }

  private resetMaterial(m: THREE.SpriteMaterial | THREE.MeshBasicMaterial, blend: 1 | 3): void {
    m.color.setRGB(1, 1, 1);
    m.opacity = 1;
    m.transparent = true;
    m.depthWrite = false;
    m.depthTest = true;
    m.fog = true;
    m.blending = blend === 3 ? THREE.AdditiveBlending : THREE.NormalBlending;
    m.needsUpdate = true;
  }

  private kill(p: Part): void {
    p.dead = true;
    this.release(p);
  }

  private release(p: Part): void {
    p.obj?.removeFromParent();
    const m = p.mat;
    if (m instanceof THREE.SpriteMaterial) this.spritePool.push(m);
    else if (m instanceof THREE.MeshBasicMaterial) this.basicPool.push(m);
    else m?.dispose();
    p.ownGeometry?.dispose();
    p.obj = null;
    p.mat = null;
    p.ownGeometry = null;
  }
}
