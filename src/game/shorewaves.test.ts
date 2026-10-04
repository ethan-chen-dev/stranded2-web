import { describe, it, expect } from 'vitest';
import { buildWavePoints, ShoreWaves } from './shorewaves';

/** 半径 300 的圆岛，岸坡每单位 0.2，岛外是 -60 的海。 */
const island = (x: number, z: number) => Math.max(-60, (300 - Math.hypot(x, z)) * 0.2);

describe('shore waves', () => {
  it('puts wave points on the shoreline facing the same way around the island', () => {
    const pts = buildWavePoints(16, 64, island, 300);
    expect(pts.length).toBeGreaterThan(20);
    for (const p of pts) expect(Math.abs(island(p.x, p.z))).toBeLessThan(8);
    // 朝向是坡度方向：沿朝向前进地形变化最大，全岛一致指向同一侧（向岛内或向海）
    const inward = pts.map(p => {
      const a = p.dir * Math.PI / 180;
      const fx = -Math.sin(a), fz = Math.cos(a);
      return island(p.x + fx * 8, p.z + fz * 8) > island(p.x - fx * 8, p.z - fz * 8);
    });
    expect(new Set(inward).size).toBe(1);
  });
  it('drops waves in water too small for minwavespace', () => {
    const pond = (x: number, z: number) => (Math.hypot(x - 200, z) < 40 ? -20 : 40);
    expect(buildWavePoints(16, 64, pond, 300)).toEqual([]);
  });
  it('spawns near waves every wave rate and plays a wave sound when one is close', () => {
    const spawned: number[] = [];
    const sounds: string[] = [];
    const waves = new ShoreWaves([{ x: 0, z: 0, dir: 90 }, { x: 5000, z: 0, dir: 0 }], 3500, {
      camera: () => ({ x: 100, y: 20, z: 0 }), inView: () => false,
      spawn: (_p, size) => { spawned.push(size); }, sound: f => { sounds.push(f); },
      random: min => min, effects: () => 2,
    });
    waves.update(3000);
    expect(spawned).toEqual([]);
    waves.update(600);
    expect(spawned).toEqual([20]);
    expect(sounds).toEqual(['wave1.wav']);
  });
});
