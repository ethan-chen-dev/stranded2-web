import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readRefBytes } from '../test/reference';
import { parseB3D } from '../formats/b3d';
import { b3dToThree, instantiate, subclip } from './b3d-to-three';

const basic = () => new THREE.MeshBasicMaterial();
const meshesOf = (o: THREE.Object3D) => {
  const out: THREE.Mesh[] = [];
  o.traverse(c => { if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh); });
  return out;
};

describe('b3dToThree', () => {
  it('builds a static mesh for palm01', () => {
    const src = parseB3D(readRefBytes('gfx/palm01.b3d'));
    const m = b3dToThree(src, basic);
    const meshes = meshesOf(m.object);
    expect(meshes.length).toBe(1);
    expect(m.skinned).toBe(false);
    const g = meshes[0].geometry;
    expect(g.index!.count).toBe(src.root.mesh!.triangles.reduce((s, t) => s + t.indices.length, 0));
    expect(g.groups.length).toBe(7);
    expect(g.getAttribute('position').count).toBe(src.root.mesh!.vertices.count);
    expect(g.getAttribute('normal')).toBeDefined();
    expect(Array.isArray(meshes[0].material)).toBe(true);
  });
  it('mirrors z and flips winding and v', () => {
    const src = parseB3D(readRefBytes('gfx/palm01.b3d'));
    const m = b3dToThree(src, basic);
    const mesh = meshesOf(m.object)[0];
    const v = src.root.mesh!.vertices;
    expect(mesh.geometry.getAttribute('position').getZ(0)).toBeCloseTo(-v.positions[2]);
    const tri = src.root.mesh!.triangles[0].indices;
    const idx = mesh.geometry.index!;
    expect([idx.getX(0), idx.getX(1), idx.getX(2)]).toEqual([tri[0], tri[2], tri[1]]);
    const tc = v.texCoordSets * v.texCoordSetSize;
    expect(mesh.geometry.getAttribute('uv').getY(0)).toBeCloseTo(1 - v.texCoords[1], 5);
    expect(tc).toBeGreaterThanOrEqual(2);
  });
  it('builds a skinned mesh with clip for raptor', () => {
    const m = b3dToThree(parseB3D(readRefBytes('gfx/raptor.b3d')), basic);
    let skinned: THREE.SkinnedMesh | undefined;
    m.object.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = o as THREE.SkinnedMesh; });
    expect(skinned).toBeDefined();
    expect(m.skinned).toBe(true);
    expect(skinned!.skeleton.bones.length).toBe(15);
    expect(skinned!.geometry.getAttribute('skinIndex')).toBeDefined();
    expect(m.clips.length).toBe(1);
    expect(m.clips[0].name).toBe('all');
    expect(m.clips[0].duration).toBeGreaterThan(0);
    expect(m.frames).toBeGreaterThan(1);
    const idle = subclip(m.clips[0], 'idle1', 4, 8, m.fps);
    expect(idle.duration).toBeGreaterThan(0);
    expect(idle.duration).toBeLessThan(m.clips[0].duration);
  });
  it('instantiates independent copies', () => {
    const m = b3dToThree(parseB3D(readRefBytes('gfx/raptor.b3d')), basic);
    const a = instantiate(m);
    const b = instantiate(m);
    expect(a.object).not.toBe(b.object);
    expect(a.mixer).toBeDefined();
    const sa = meshesOf(a.object)[0] as THREE.SkinnedMesh;
    const sb = meshesOf(b.object)[0] as THREE.SkinnedMesh;
    expect(sa.skeleton).not.toBe(sb.skeleton);
    expect(sa.skeleton.bones[0]).not.toBe(sb.skeleton.bones[0]);
  });
  it('gives every node a unique name for animation binding', () => {
    const m = b3dToThree(parseB3D(readRefBytes('gfx/raptor.b3d')), basic);
    const names: string[] = [];
    m.object.traverse(o => names.push(o.name));
    expect(new Set(names).size).toBe(names.length);
  });
});
