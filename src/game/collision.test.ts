import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ObjectCollider } from './collision';

function box(x: number, y: number, z: number, width = 20): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(width, 100, 20), new THREE.MeshBasicMaterial());
  m.position.set(x, y, z);
  m.updateMatrixWorld(true);
  return m;
}

describe('ObjectCollider', () => {
  const wall = box(0, 50, -30);
  const collider = new ObjectCollider([{ object: wall, col: 1 }]);
  it('stops before the wall', () => {
    const r = collider.resolveMove(new THREE.Vector3(0, 17, 0), new THREE.Vector3(0, 0, -15), 8, 17);
    expect(r.z).toBeCloseTo(-12, 3);
    expect(r.x).toBeCloseTo(0, 6);
  });
  it('passes when far enough', () => {
    const r = collider.resolveMove(new THREE.Vector3(0, 17, 0), new THREE.Vector3(0, 0, -5), 8, 17);
    expect(r.z).toBeCloseTo(-5, 6);
  });
  it('slides along a wide wall diagonally', () => {
    const wide = new ObjectCollider([{ object: box(0, 50, -30, 400), col: 1 }]);
    const r = wide.resolveMove(new THREE.Vector3(0, 17, -5), new THREE.Vector3(-10, 0, -10), 8, 17);
    expect(r.z).toBeGreaterThanOrEqual(-7.01);
    expect(r.x).toBeLessThan(-5);
  });
  it('pushes out when overlapping', () => {
    const p = collider.pushOut(new THREE.Vector3(0, 17, -15), 8);
    expect(p.z).toBeGreaterThan(2.9);
  });
  it('ignores col 0 and 2', () => {
    const c = new ObjectCollider([{ object: box(0, 50, -30), col: 0 }, { object: box(0, 50, -30), col: 2 }]);
    expect(c.items.length).toBe(0);
    const r = c.resolveMove(new THREE.Vector3(0, 17, 0), new THREE.Vector3(0, 0, -15), 8, 17);
    expect(r.z).toBeCloseTo(-15, 6);
  });
});
