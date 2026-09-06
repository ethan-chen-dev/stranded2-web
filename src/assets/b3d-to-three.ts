/**
 * B3D 数据转 Three.js 对象。Blitz3D 左手系到 Three 右手系：
 * 位置与法线 z 取反，三角形绕序反转，uv 的 v 变 1-v，四元数 (w,x,y,z) 变 (w,-x,-y,z)。
 */
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { B3DBrush, B3DModel, B3DNode, B3DTexture } from '../formats/b3d';

export type MaterialFactory = (brush: B3DBrush, textures: B3DTexture[]) => THREE.Material;

export interface ThreeModel {
  object: THREE.Object3D;
  clips: THREE.AnimationClip[];
  /** 'all' 剪辑的帧率，帧号除以它得到时间。 */
  fps: number;
  frames: number;
  skinned: boolean;
}

/** 'all' 剪辑固定用这个帧率；播放速度由 action.timeScale 调整。 */
export const CLIP_FPS = 30;

const DEFAULT_BRUSH: B3DBrush = { name: '', color: [1, 1, 1, 1], shininess: 0, blend: 1, fx: 0, textureIds: [] };

export function convertQuaternion(q: [number, number, number, number]): THREE.Quaternion {
  const [w, x, y, z] = q;
  return new THREE.Quaternion(-x, -y, z, w);
}

interface Build {
  model: B3DModel;
  makeMaterial: MaterialFactory;
  materials: Map<number, THREE.Material>;
  bones: THREE.Bone[];
  boneNodes: B3DNode[];
  hasBones: boolean;
  skinnedMesh?: THREE.SkinnedMesh;
  skinnedNode?: B3DNode;
  tracks: THREE.KeyframeTrack[];
  usedNames: Set<string>;
  maxFrame: number;
}

export function b3dToThree(model: B3DModel, makeMaterial: MaterialFactory): ThreeModel {
  const b: Build = {
    model, makeMaterial, materials: new Map(), bones: [], boneNodes: [],
    hasBones: containsBone(model.root), tracks: [], usedNames: new Set(), maxFrame: 0,
  };
  const object = buildNode(b, model.root);
  object.updateMatrixWorld(true);

  if (b.skinnedMesh && b.skinnedNode) {
    applySkin(b, b.skinnedMesh, b.skinnedNode);
    b.skinnedMesh.bind(new THREE.Skeleton(b.bones));
  }

  const anim = findAnim(model.root);
  const frames = anim?.frames ?? b.maxFrame;
  const clips: THREE.AnimationClip[] = [];
  if (b.tracks.length > 0) {
    clips.push(new THREE.AnimationClip('all', Math.max(frames, b.maxFrame) / CLIP_FPS, b.tracks));
  }
  return { object, clips, fps: CLIP_FPS, frames, skinned: !!b.skinnedMesh };
}

/**
 * 截取 start..end 帧（含两端）为独立片段，对应原版 ExtractAnimSeq。
 * 两端按插值采样，区间内的关键帧原样保留：原版模型的关键帧很稀疏（如 bird01 只在 1、16、17、18、20 帧有键），
 * 只按关键帧过滤会丢掉区间前段的过渡，造成动画只剩末尾几帧反复播放。
 */
export function subclip(clip: THREE.AnimationClip, name: string, start: number, end: number, fps: number): THREE.AnimationClip {
  const t0 = start / fps;
  const t1 = Math.max(end, start) / fps;
  const duration = Math.max(t1 - t0, 1 / fps);
  const tracks: THREE.KeyframeTrack[] = [];
  for (const track of clip.tracks) {
    const size = track.getValueSize();
    const interp = (track as unknown as { createInterpolant(): { evaluate(t: number): ArrayLike<number> } }).createInterpolant();
    const times: number[] = [];
    const values: number[] = [];
    const push = (t: number, v: ArrayLike<number>) => {
      times.push(t - t0);
      for (let i = 0; i < size; i++) values.push(v[i]);
    };
    push(t0, interp.evaluate(t0));
    for (let i = 0; i < track.times.length; i++) {
      const t = track.times[i];
      if (t > t0 && t < t1) push(t, track.values.subarray(i * size, (i + 1) * size));
    }
    if (t1 > t0) push(t1, interp.evaluate(t1));
    const Track = track.constructor as new (name: string, times: number[], values: number[]) => THREE.KeyframeTrack;
    tracks.push(new Track(track.name, times, values));
  }
  return new THREE.AnimationClip(name, duration, tracks);
}

/** 复制一份可独立摆放和播放动画的实例。 */
export function instantiate(m: ThreeModel): { object: THREE.Object3D; mixer?: THREE.AnimationMixer } {
  const object = skeletonClone(m.object);
  const mixer = m.clips.length > 0 ? new THREE.AnimationMixer(object) : undefined;
  return { object, mixer };
}

function containsBone(n: B3DNode): boolean {
  return !!n.bone || n.children.some(containsBone);
}

function findAnim(n: B3DNode): B3DNode['anim'] {
  if (n.anim) return n.anim;
  for (const c of n.children) {
    const a = findAnim(c);
    if (a) return a;
  }
  return undefined;
}

function uniqueName(b: Build, name: string): string {
  let candidate = name === '' ? 'node' : name;
  let i = 1;
  while (b.usedNames.has(candidate)) candidate = `${name === '' ? 'node' : name}#${i++}`;
  b.usedNames.add(candidate);
  return candidate;
}

function buildNode(b: Build, n: B3DNode): THREE.Object3D {
  let obj: THREE.Object3D;
  if (n.mesh && b.hasBones && !b.skinnedMesh) {
    const sm = new THREE.SkinnedMesh(buildGeometry(b, n), meshMaterials(b, n));
    b.skinnedMesh = sm;
    b.skinnedNode = n;
    obj = sm;
  } else if (n.mesh) {
    obj = new THREE.Mesh(buildGeometry(b, n), meshMaterials(b, n));
  } else if (b.hasBones) {
    const bone = new THREE.Bone();
    obj = bone;
  } else {
    obj = new THREE.Group();
  }
  if (n.bone || (b.hasBones && obj instanceof THREE.Bone)) {
    if (obj instanceof THREE.Bone) {
      b.bones.push(obj);
      b.boneNodes.push(n);
    }
  }

  obj.name = uniqueName(b, n.name);
  obj.position.set(n.position[0], n.position[1], -n.position[2]);
  obj.scale.set(n.scale[0], n.scale[1], n.scale[2]);
  obj.quaternion.copy(convertQuaternion(n.rotation));

  addTracks(b, obj.name, n);

  for (const c of n.children) obj.add(buildNode(b, c));
  return obj;
}

function meshMaterials(b: Build, n: B3DNode): THREE.Material[] {
  const ids = brushOrder(n);
  return ids.map(id => materialFor(b, id));
}

function brushOrder(n: B3DNode): number[] {
  const ids: number[] = [];
  for (const t of n.mesh!.triangles) {
    const id = t.brushId >= 0 ? t.brushId : n.mesh!.brushId;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function materialFor(b: Build, id: number): THREE.Material {
  let m = b.materials.get(id);
  if (!m) {
    const brush = id >= 0 && id < b.model.brushes.length ? b.model.brushes[id] : DEFAULT_BRUSH;
    m = b.makeMaterial(brush, b.model.textures);
    b.materials.set(id, m);
  }
  return m;
}

function buildGeometry(b: Build, n: B3DNode): THREE.BufferGeometry {
  const mesh = n.mesh!;
  const v = mesh.vertices;
  const g = new THREE.BufferGeometry();

  const pos = new Float32Array(v.positions);
  for (let i = 2; i < pos.length; i += 3) pos[i] = -pos[i];
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));

  if (v.normals) {
    const nr = new Float32Array(v.normals);
    for (let i = 2; i < nr.length; i += 3) nr[i] = -nr[i];
    g.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
  }

  if (v.colors) {
    const col = new Float32Array(v.count * 3);
    for (let i = 0; i < v.count; i++) {
      col[i * 3] = v.colors[i * 4];
      col[i * 3 + 1] = v.colors[i * 4 + 1];
      col[i * 3 + 2] = v.colors[i * 4 + 2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }

  const tcPer = v.texCoordSets * v.texCoordSetSize;
  if (tcPer >= 2) {
    const uv = new Float32Array(v.count * 2);
    for (let i = 0; i < v.count; i++) {
      uv[i * 2] = v.texCoords[i * tcPer];
      uv[i * 2 + 1] = 1 - v.texCoords[i * tcPer + 1];
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }

  const ids = brushOrder(n);
  const total = mesh.triangles.reduce((s, t) => s + t.indices.length, 0);
  const index = new Uint32Array(total);
  let o = 0;
  for (const t of mesh.triangles) {
    const matIndex = ids.indexOf(t.brushId >= 0 ? t.brushId : mesh.brushId);
    g.addGroup(o, t.indices.length, matIndex);
    for (let i = 0; i < t.indices.length; i += 3) {
      index[o++] = t.indices[i];
      index[o++] = t.indices[i + 2];
      index[o++] = t.indices[i + 1];
    }
  }
  g.setIndex(new THREE.BufferAttribute(index, 1));

  if (!v.normals) g.computeVertexNormals();
  return g;
}

/** 每顶点最多 4 个骨骼影响；无影响的顶点绑到第一根骨骼。 */
function applySkin(b: Build, sm: THREE.SkinnedMesh, n: B3DNode): void {
  const count = n.mesh!.vertices.count;
  const influences: { bone: number; w: number }[][] = Array.from({ length: count }, () => []);
  b.boneNodes.forEach((bn, boneIndex) => {
    if (!bn.bone) return;
    const { vertexIds, weights } = bn.bone;
    for (let i = 0; i < vertexIds.length; i++) {
      const vid = vertexIds[i];
      if (vid >= 0 && vid < count) influences[vid].push({ bone: boneIndex, w: weights[i] });
    }
  });

  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  for (let vi = 0; vi < count; vi++) {
    const list = influences[vi].sort((a, c) => c.w - a.w).slice(0, 4);
    let sum = list.reduce((s, x) => s + x.w, 0);
    if (list.length === 0 || sum <= 0) {
      list.length = 0;
      list.push({ bone: 0, w: 1 });
      sum = 1;
    }
    list.forEach((x, k) => {
      skinIndex[vi * 4 + k] = x.bone;
      skinWeight[vi * 4 + k] = x.w / sum;
    });
  }
  sm.geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  sm.geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
}

function addTracks(b: Build, name: string, n: B3DNode): void {
  if (n.keys.length === 0) return;
  const posT: number[] = [], posV: number[] = [];
  const rotT: number[] = [], rotV: number[] = [];
  const sclT: number[] = [], sclV: number[] = [];
  for (const k of n.keys) {
    const t = k.frame / CLIP_FPS;
    if (k.frame > b.maxFrame) b.maxFrame = k.frame;
    if (k.position) { posT.push(t); posV.push(k.position[0], k.position[1], -k.position[2]); }
    if (k.rotation) { const q = convertQuaternion(k.rotation); rotT.push(t); rotV.push(q.x, q.y, q.z, q.w); }
    if (k.scale) { sclT.push(t); sclV.push(k.scale[0], k.scale[1], k.scale[2]); }
  }
  if (posT.length) b.tracks.push(new THREE.VectorKeyframeTrack(`${name}.position`, posT, posV));
  if (rotT.length) b.tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, rotT, rotV));
  if (sclT.length) b.tracks.push(new THREE.VectorKeyframeTrack(`${name}.scale`, sclT, sclV));
}
