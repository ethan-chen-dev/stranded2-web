/**
 * 岸边浪花，依据 e_environment.bb：e_environment_setup_water 的浪点矩阵与方向检测，e_environment_update 的定时生成。
 * 地形以 8 为步长采样，落进 16 见方的格子（后写的采样覆盖高度）；|高度|<5 的格子是海岸。
 * 清理时把邻格中 |高度| 大于本格高度（不取绝对值，沿用原版）的标记清掉；方向为 12 个方向里前后 8 处高度差最大者，
 * 差为负时转 180 度；沿方向反面每 10 探到 minwavespace，碰到陆地的浪点删除（小水洼没有浪）。
 */
export interface WavePoint {
  x: number;
  z: number;
  /** Blitz yaw，度。 */
  dir: number;
}

const STEP = 8;
const CELL = 16;
const SHORE = 5;
const DIR_PROBE = 8;
const SPACE_STEP = 10;

/** Blitz MoveEntity 0,0,d 在 yaw 下的位移（前方为 (-sin, cos)）。 */
function forward(yawDeg: number, d: number): [number, number] {
  const a = yawDeg * Math.PI / 180;
  return [-Math.sin(a) * d, Math.cos(a) * d];
}

export function buildWavePoints(terrainSize: number, worldSize: number, terrainY: (x: number, z: number) => number, minWaveSpace: number): WavePoint[] {
  const half = (terrainSize / 2) * worldSize;
  const size = Math.trunc((terrainSize * worldSize) / CELL);
  const n = size + 1;
  const flag = new Uint8Array(n * n);
  const hy = new Float32Array(n * n);
  for (let x = -half; x <= half; x += STEP) {
    for (let z = -half; z <= half; z += STEP) {
      const h = terrainY(x, z);
      const i = Math.trunc((x + half) / CELL) * n + Math.trunc((z + half) / CELL);
      hy[i] = h;
      if (Math.abs(h) < SHORE) flag[i] = 1;
    }
  }
  const NEIGHBOURS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [1, -1], [-1, 1]];
  for (let x = 1; x <= size - 1; x++) {
    for (let z = 1; z <= size - 1; z++) {
      if (flag[x * n + z] !== 1) continue;
      const root = hy[x * n + z];
      for (const [dx, dz] of NEIGHBOURS) {
        const j = (x + dx) * n + (z + dz);
        if (Math.abs(hy[j]) > root) flag[j] = 0;
      }
    }
  }
  const out: WavePoint[] = [];
  for (let x = 0; x <= size; x++) {
    for (let z = 0; z <= size; z++) {
      if (flag[x * n + z] !== 1) continue;
      const wx = -half + x * CELL + CELL / 2;
      const wz = -half + z * CELL + CELL / 2;
      let bestA = 0;
      let bestV = 0;
      for (let a = 0; a <= 360; a += 30) {
        const [fx, fz] = forward(a, DIR_PROBE);
        const h1 = terrainY(wx + fx, wz + fz);
        const h2 = terrainY(wx - fx, wz - fz);
        if (Math.abs(h1 - h2) > Math.abs(bestV)) { bestA = a; bestV = h1 - h2; }
      }
      if (bestV < 0) bestA += 180;
      let land = false;
      const [bx, bz] = forward(bestA, -SPACE_STEP);
      for (let i = 0, px = wx, pz = wz; i <= minWaveSpace; i += SPACE_STEP) {
        px += bx;
        pz += bz;
        if (terrainY(px, pz) > 0) { land = true; break; }
      }
      if (!land) out.push({ x: wx, z: wz, dir: bestA });
    }
  }
  return out;
}

export interface WaveSpawnDeps {
  /** 镜头位置（Blitz）与是否在视野内。 */
  camera(): { x: number; y: number; z: number };
  inView(x: number, y: number, z: number): boolean;
  spawn(p: WavePoint, size: number): void;
  sound(file: string, volume: number): void;
  random(min: number, max: number): number;
  effects(): number;
}

/** 每 waveRate 毫秒（游戏时间）生成一轮浪花；离镜头 300 以内的浪一定生成并播放浪声。 */
export class ShoreWaves {
  private acc = 0;

  constructor(private readonly points: WavePoint[], private readonly waveRate: number, private readonly d: WaveSpawnDeps) {}

  get count(): number {
    return this.points.length;
  }

  update(dtMs: number): void {
    this.acc += dtMs;
    if (this.acc <= this.waveRate) return;
    this.acc = 0;
    const effects = this.d.effects();
    if (effects <= 0) return;
    const cam = this.d.camera();
    const many = effects > 1;
    let close = false;
    for (const p of this.points) {
      if (!many && this.d.random(1, 2) !== 1) continue;
      const dist = Math.hypot(p.x - cam.x, cam.y, p.z - cam.z);
      if (dist >= (many ? 1500 : 1000)) continue;
      if (dist < 300) close = true;
      else if (!this.d.inView(p.x, 0, p.z)) continue;
      this.d.spawn(p, this.d.random(20, 30));
    }
    if (close) this.d.sound(`wave${this.d.random(1, 3)}.wav`, 30 + Math.random() * 30);
  }
}
