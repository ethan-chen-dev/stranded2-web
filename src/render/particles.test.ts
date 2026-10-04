import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Particles, P } from './particles';

function setup(opts: { random?: () => number; ground?: number; diving?: boolean; seq?: number | null; textures?: boolean; wallX?: number } = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1.5, 1, 10000);
  const ground = { y: opts.ground ?? -50 };
  const particles = new Particles({
    scene, camera,
    textures: opts.textures === false ? () => new Promise(() => undefined) : () => Promise.resolve(new THREE.Texture()),
    terrainY: () => ground.y,
    diving: () => opts.diving ?? false,
    random: opts.random ?? (() => 0),
    sequenceMs: () => opts.seq ?? null,
    collide: opts.wallX === undefined ? undefined : (a, b) => (b.x >= opts.wallX! ? { x: opts.wallX! - 2, y: b.y, z: b.z } : null),
  });
  return { scene, camera, particles, ground };
}

const visuals = (g: THREE.Object3D) => {
  let n = 0;
  g.traverse(o => { if ((o as THREE.Mesh).isMesh || (o as THREE.Sprite).isSprite) n++; });
  return n;
};

const frames = (particles: Particles, n: number) => { for (let i = 0; i < n; i++) particles.update(20); };

describe('Particles', () => {
  it('skips particles whose texture is not loaded yet', () => {
    const { particles } = setup({ textures: false });
    expect(particles.add(0, 10, 0, P.smoke, 3)).toBeNull();
    expect(particles.count).toBe(0);
  });

  it('grows an impact flare and removes it once its alpha drops below zero', async () => {
    const { particles } = setup();
    await particles.load();
    const p = particles.add(0, 10, 0, P.impact, 4, 0.5)!;
    expect(p).not.toBeNull();
    frames(particles, 9);
    expect(particles.count).toBe(1);
    expect(p.size).toBeCloseTo(4 + 9 * 1.5);
    frames(particles, 2);
    expect(particles.count).toBe(0);
  });

  it('turns a bubble reaching the surface into a round wave', async () => {
    const { particles } = setup();
    await particles.load();
    particles.add(5, -4, 7, P.bubbles, 2);
    particles.update(100);
    expect(particles.all.map(p => p.typ)).toEqual([P.rwave]);
    const wave = particles.all[0];
    expect(wave.a).toBeCloseTo(0.4 - 0.02 * 5);
  });

  it('puts flames spawned under water out as smoke and bubbles', async () => {
    const { particles } = setup();
    await particles.load();
    expect(particles.add(0, -5, 0, P.flames, 5)).toBeNull();
    expect(particles.all.map(p => p.typ).sort()).toEqual([P.bubbles, P.smoke]);
    const smoke = particles.all.find(p => p.typ === P.smoke)!;
    expect(smoke.fadein).toBeCloseTo(0.3);
  });

  it('keeps rain under the camera x/z and drops it at the water line', async () => {
    const { particles, camera, scene } = setup();
    await particles.load();
    camera.position.set(100, 50, -200);
    particles.add(110, 0, 205, P.rain, 20);
    const drop = particles.all[0];
    expect(drop).toBeDefined();
    camera.position.set(300, 50, -200);
    particles.update(20);
    scene.updateMatrixWorld(true);
    let sprite: THREE.Object3D | undefined;
    scene.traverse(o => { if ((o as THREE.Mesh).isMesh) sprite = o; });
    const w = sprite!.getWorldPosition(new THREE.Vector3());
    expect(w.x).toBeCloseTo(310);
    expect(w.z).toBeCloseTo(-205);
    expect(w.y).toBeCloseTo(50 + 100 - 6);
    particles.update(20 * 30);
    expect(particles.count).toBe(0);
  });

  it('applies colour and additive overrides from the caller', async () => {
    const { particles } = setup();
    await particles.load();
    const p = particles.add(0, 10, 0, P.smoke, 3, 0.8)!.color(240, 240, 240).additive();
    let mat: THREE.SpriteMaterial | undefined;
    particles.group.traverse(o => { if ((o as THREE.Sprite).isSprite) mat = (o as THREE.Sprite).material; });
    expect(mat!.color.r).toBeCloseTo(240 / 255);
    expect(mat!.blending).toBe(THREE.AdditiveBlending);
    expect(p.fadein).toBeCloseTo(0.8);
  });

  it('colours the puddle of a vomit splatter with its own colour', async () => {
    const { particles, ground } = setup();
    await particles.load();
    ground.y = 0;
    particles.add(0, 20, 0, P.subsplatter, 4, 3)!.frame(2).color(100, 120, 0);
    frames(particles, 11);
    const puddle = particles.all.find(p => p.typ === P.puddle);
    expect(puddle).toBeDefined();
    let mat: THREE.MeshLambertMaterial | undefined;
    particles.group.traverse(o => { if ((o as THREE.Mesh).material instanceof THREE.MeshLambertMaterial) mat = (o as THREE.Mesh).material as THREE.MeshLambertMaterial; });
    expect(mat!.color.g).toBeCloseTo(120 / 255);
  });

  it('moves a spawn glow with the unit it follows', async () => {
    const { particles } = setup();
    await particles.load();
    const unit = { x: 0, y: 0, z: 0 };
    const p = particles.add(10, 5, 20, P.spawn, 4, 1)!.speed(2).follow(() => unit);
    unit.x = 100;
    unit.z = 50;
    particles.update(20);
    let pos: THREE.Vector3 | undefined;
    particles.group.traverse(o => { if ((o as THREE.Mesh).isMesh) pos = o.position; });
    expect(pos!.x).toBeCloseTo(110);
    expect(pos!.z).toBeCloseTo(-70);
    expect(p.a).toBeCloseTo(1 - 0.04);
  });

  it('fades a flash overlay at its speed', async () => {
    const { particles } = setup();
    await particles.load();
    const flash = particles.add(0, 0, 0, P.flash, 0.1, 0.5)!.color(255, 0, 0);
    particles.update(20);
    expect(flash.a).toBeCloseTo(0.4);
    frames(particles, 5);
    expect(particles.count).toBe(0);
  });

  it('topples a dead tree and reports when it has sunk below the ground', () => {
    const { particles, scene } = setup({ ground: 0 });
    const tree = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    scene.add(tree);
    let done = 0;
    particles.animate(tree, { typ: P.fall }, () => { done++; });
    particles.update(20 * 100);
    expect(done).toBe(0);
    expect(tree.position.y).toBeCloseTo(-90);
    expect(tree.quaternion.equals(new THREE.Quaternion())).toBe(false);
    particles.update(20 * 300);
    expect(done).toBe(1);
    expect(particles.count).toBe(0);
  });

  it('fades out a tail on its own material copy', () => {
    const { particles, scene } = setup();
    const shared = new THREE.MeshBasicMaterial();
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared);
    scene.add(tail);
    particles.animate(tail, { typ: P.fadeout, alpha: 0.3, speed: 0.025 });
    particles.update(20);
    expect((tail.material as THREE.Material).opacity).toBeCloseTo(0.275);
    expect(shared.opacity).toBe(1);
    frames(particles, 12);
    expect(tail.parent).toBeNull();
  });

  it('clears every particle from the scene group', async () => {
    const { particles } = setup();
    await particles.load();
    particles.add(0, 10, 0, P.smoke, 3);
    particles.add(0, 10, 0, P.explode, 3);
    particles.add(0, 0, 0, P.puddle, 5);
    particles.add(0, 0, 0, P.rain, 20);
    particles.add(0, 0, 0, P.fade, 0.05, 0.5);
    expect(visuals(particles.group)).toBe(5);
    particles.clear();
    expect(particles.count).toBe(0);
    expect(visuals(particles.group)).toBe(0);
  });

  it('stops a spark at a scene object instead of flying through it', async () => {
    const { particles } = setup({ wallX: 5, random: () => 1 });
    await particles.load();
    const spark = particles.add(0, 20, 0, P.spark, 1, 3)!;
    spark.fx = 2;
    spark.fy = 0;
    spark.fz = 0;
    frames(particles, 10);
    expect(spark.fx).toBe(0);
  });
});
