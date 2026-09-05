import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Player, PLAYER, type PlayerInput } from './player';

const idle: PlayerInput = { forward: false, backward: false, left: false, right: false, jump: false, lookDx: 0, lookDy: 0 };
const flat = { heightAt: () => 0 };

function run(p: Player, input: PlayerInput, ms: number, ground = flat, onStep?: (p: Player, t: number) => void): void {
  const step = 10;
  for (let t = 0; t < ms; t += step) {
    p.update(step, t + 1000, input, ground, null);
    onStep?.(p, t);
  }
}

describe('Player', () => {
  it('stands on the ground', () => {
    const p = new Player(new THREE.Vector3(0, 17, 0), 0, 0);
    run(p, idle, 1000);
    expect(p.position.y).toBeCloseTo(17, 3);
  });
  it('jumps about 45 and lands', () => {
    const p = new Player(new THREE.Vector3(0, 17, 0), 0, 0);
    let peak = 0;
    let t = 1000;
    p.update(10, t, { ...idle, jump: true }, flat, null);
    for (let i = 0; i < 200; i++) {
      t += 10;
      p.update(10, t, idle, flat, null);
      peak = Math.max(peak, p.position.y);
    }
    expect(peak).toBeGreaterThan(55);
    expect(peak).toBeLessThan(66);
    expect(p.position.y).toBeCloseTo(17, 3);
  });
  it('falls to the ground', () => {
    const p = new Player(new THREE.Vector3(0, 117, 0), 0, 0);
    run(p, idle, 3000);
    expect(p.position.y).toBeCloseTo(17, 3);
  });
  it('swims when the ground is deep', () => {
    const p = new Player(new THREE.Vector3(0, 17, 0), 0, 0);
    run(p, idle, 3000, { heightAt: () => -30 });
    expect(p.swimming).toBe(true);
    expect(p.position.y).toBeCloseTo(PLAYER.seaSwimY, 3);
  });
  it('walks 80 per second forward, 60 on each axis diagonally', () => {
    const p = new Player(new THREE.Vector3(0, 17, 0), 0, 0);
    run(p, { ...idle, forward: true }, 1000);
    expect(p.position.z).toBeCloseTo(-80, 0);
    expect(p.movedThisFrame).toBe(true);
    const q = new Player(new THREE.Vector3(0, 17, 0), 0, 0);
    run(q, { ...idle, forward: true, right: true }, 1000);
    expect(q.position.x).toBeCloseTo(60, 0);
    expect(q.position.z).toBeCloseTo(-60, 0);
  });
  it('turns with the mouse and clamps pitch', () => {
    const p = new Player(new THREE.Vector3(0, 17, 0), 0, 0);
    p.update(10, 1000, { ...idle, lookDx: 100, lookDy: 100000 }, flat, null);
    expect(p.yaw).toBeCloseTo(-0.2, 6);
    expect(p.pitch).toBeCloseTo(-PLAYER.maxPitch, 6);
  });
});
