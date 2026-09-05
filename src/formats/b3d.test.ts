import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { readRefBytes, MOD_ROOT } from '../test/reference';
import { parseB3D, type B3DNode } from './b3d';

const countTris = (n: B3DNode): number =>
  (n.mesh ? n.mesh.triangles.reduce((s, t) => s + t.indices.length / 3, 0) : 0) +
  n.children.reduce((s, c) => s + countTris(c), 0);
const findBones = (n: B3DNode): B3DNode[] => [...(n.bone ? [n] : []), ...n.children.flatMap(findBones)];

describe('parseB3D', () => {
  it('parses palm01 mesh', () => {
    const m = parseB3D(readRefBytes('gfx/palm01.b3d'));
    expect(m.textures.map(t => t.file)).toEqual(['.\\leaf02_a.png', '.\\trunk01.jpg']);
    expect(m.brushes.length).toBeGreaterThan(0);
    const mesh = m.root.mesh!;
    expect(mesh.vertices.count).toBeGreaterThan(0);
    expect(mesh.vertices.positions.length).toBe(mesh.vertices.count * 3);
    expect(mesh.vertices.texCoords.length).toBe(mesh.vertices.count * mesh.vertices.texCoordSets * mesh.vertices.texCoordSetSize);
    expect(mesh.triangles.length).toBe(7);
    expect(countTris(m.root)).toBeGreaterThan(0);
    expect(m.root.anim).toBeDefined();
  });
  it('parses raptor bones and keys', () => {
    const m = parseB3D(readRefBytes('gfx/raptor.b3d'));
    const bones = findBones(m.root);
    expect(bones.length).toBe(15);
    expect(bones.some(b => b.keys.length > 0)).toBe(true);
    expect(m.root.anim!.frames).toBeGreaterThan(1);
    const withMesh = (n: B3DNode): boolean => !!n.mesh || n.children.some(withMesh);
    expect(withMesh(m.root)).toBe(true);
  });
  it('parses strandedguy without textures', () => {
    const m = parseB3D(readRefBytes('gfx/strandedguy.b3d'));
    expect(m.textures.length).toBe(0);
    expect(m.brushes.length).toBeGreaterThan(0);
  });
  it('parses all 321 models', () => {
    const files = readdirSync(`${MOD_ROOT}/gfx`).filter(f => f.endsWith('.b3d'));
    expect(files.length).toBe(321);
    for (const f of files) expect(() => parseB3D(readRefBytes(`gfx/${f}`)), f).not.toThrow();
  });
});
