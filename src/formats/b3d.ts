/** Blitz3D 模型文件（BB3D 分块格式）解析。数据保持左手系原样，坐标转换在渲染层做。 */
import { BinaryReader } from './binary-reader';

export interface B3DTexture {
  file: string;
  flags: number;
  blend: number;
  pos: [number, number];
  scale: [number, number];
  rotation: number;
}

export interface B3DBrush {
  name: string;
  color: [number, number, number, number];
  shininess: number;
  blend: number;
  fx: number;
  textureIds: number[];
}

export interface B3DVertices {
  flags: number;
  texCoordSets: number;
  texCoordSetSize: number;
  count: number;
  positions: Float32Array;
  normals?: Float32Array;
  colors?: Float32Array;
  texCoords: Float32Array;
}

export interface B3DTriangles {
  brushId: number;
  indices: Uint32Array;
}

export interface B3DMesh {
  brushId: number;
  vertices: B3DVertices;
  triangles: B3DTriangles[];
}

export interface B3DKey {
  frame: number;
  position?: [number, number, number];
  scale?: [number, number, number];
  /** w, x, y, z */
  rotation?: [number, number, number, number];
}

export interface B3DNode {
  name: string;
  position: [number, number, number];
  scale: [number, number, number];
  /** w, x, y, z */
  rotation: [number, number, number, number];
  mesh?: B3DMesh;
  bone?: { vertexIds: Uint32Array; weights: Float32Array };
  keys: B3DKey[];
  keyFlags: number;
  anim?: { flags: number; frames: number; fps: number };
  children: B3DNode[];
}

export interface B3DModel {
  version: number;
  textures: B3DTexture[];
  brushes: B3DBrush[];
  root: B3DNode;
}

export const TEX_COLOR = 1;
export const TEX_ALPHA = 2;
export const TEX_MASKED = 4;
export const TEX_MIPMAP = 8;
export const TEX_CLAMP_U = 16;
export const TEX_CLAMP_V = 32;
export const TEX_SPHERE = 64;

export const FX_FULLBRIGHT = 1;
export const FX_VERTEX_COLORS = 2;
export const FX_FLAT = 4;
export const FX_NO_FOG = 8;
export const FX_TWO_SIDED = 16;
export const FX_FORCE_ALPHA = 32;

export function parseB3D(bytes: Uint8Array): B3DModel {
  const r = new BinaryReader(bytes);
  const tag = r.tag();
  if (tag !== 'BB3D') throw new Error(`not a b3d file (tag ${JSON.stringify(tag)})`);
  const len = r.i32();
  const end = r.offset + len;
  const version = r.i32();

  const textures: B3DTexture[] = [];
  const brushes: B3DBrush[] = [];
  let root: B3DNode | undefined;

  while (r.offset < end) {
    const t = r.tag();
    const l = r.i32();
    const chunkEnd = r.offset + l;
    switch (t) {
      case 'TEXS':
        while (r.offset < chunkEnd) {
          textures.push({
            file: r.cstring(), flags: r.i32(), blend: r.i32(),
            pos: [r.f32(), r.f32()], scale: [r.f32(), r.f32()], rotation: r.f32(),
          });
        }
        break;
      case 'BRUS': {
        const nTexs = r.i32();
        while (r.offset < chunkEnd) {
          const b: B3DBrush = {
            name: r.cstring(), color: [r.f32(), r.f32(), r.f32(), r.f32()],
            shininess: r.f32(), blend: r.i32(), fx: r.i32(), textureIds: [],
          };
          for (let i = 0; i < nTexs; i++) b.textureIds.push(r.i32());
          brushes.push(b);
        }
        break;
      }
      case 'NODE':
        root = readNode(r, chunkEnd);
        break;
    }
    r.offset = chunkEnd;
  }

  if (!root) root = emptyNode('');
  return { version, textures, brushes, root };
}

function emptyNode(name: string): B3DNode {
  return { name, position: [0, 0, 0], scale: [1, 1, 1], rotation: [1, 0, 0, 0], keys: [], keyFlags: 0, children: [] };
}

function readNode(r: BinaryReader, end: number): B3DNode {
  const node = emptyNode(r.cstring());
  node.position = [r.f32(), r.f32(), r.f32()];
  node.scale = [r.f32(), r.f32(), r.f32()];
  node.rotation = [r.f32(), r.f32(), r.f32(), r.f32()];

  while (r.offset < end) {
    const t = r.tag();
    const l = r.i32();
    const chunkEnd = r.offset + l;
    switch (t) {
      case 'MESH':
        node.mesh = readMesh(r, chunkEnd);
        break;
      case 'BONE': {
        const n = Math.floor(l / 8);
        const vertexIds = new Uint32Array(n);
        const weights = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          vertexIds[i] = r.i32();
          weights[i] = r.f32();
        }
        node.bone = { vertexIds, weights };
        break;
      }
      case 'KEYS': {
        const flags = r.i32();
        node.keyFlags |= flags;
        while (r.offset < chunkEnd) {
          const key: B3DKey = { frame: r.i32() };
          if (flags & 1) key.position = [r.f32(), r.f32(), r.f32()];
          if (flags & 2) key.scale = [r.f32(), r.f32(), r.f32()];
          if (flags & 4) key.rotation = [r.f32(), r.f32(), r.f32(), r.f32()];
          node.keys.push(key);
        }
        break;
      }
      case 'ANIM':
        node.anim = { flags: r.i32(), frames: r.i32(), fps: r.f32() };
        break;
      case 'NODE':
        node.children.push(readNode(r, chunkEnd));
        break;
    }
    r.offset = chunkEnd;
  }
  node.keys.sort((a, b) => a.frame - b.frame);
  return node;
}

function readMesh(r: BinaryReader, end: number): B3DMesh {
  const brushId = r.i32();
  let vertices: B3DVertices | undefined;
  const triangles: B3DTriangles[] = [];

  while (r.offset < end) {
    const t = r.tag();
    const l = r.i32();
    const chunkEnd = r.offset + l;
    if (t === 'VRTS') {
      const flags = r.i32();
      const texCoordSets = r.i32();
      const texCoordSetSize = r.i32();
      const hasNormals = (flags & 1) !== 0;
      const hasColors = (flags & 2) !== 0;
      const floatsPerVertex = 3 + (hasNormals ? 3 : 0) + (hasColors ? 4 : 0) + texCoordSets * texCoordSetSize;
      const count = Math.floor((chunkEnd - r.offset) / (floatsPerVertex * 4));
      const positions = new Float32Array(count * 3);
      const normals = hasNormals ? new Float32Array(count * 3) : undefined;
      const colors = hasColors ? new Float32Array(count * 4) : undefined;
      const tcPer = texCoordSets * texCoordSetSize;
      const texCoords = new Float32Array(count * tcPer);
      for (let i = 0; i < count; i++) {
        positions[i * 3] = r.f32();
        positions[i * 3 + 1] = r.f32();
        positions[i * 3 + 2] = r.f32();
        if (normals) {
          normals[i * 3] = r.f32();
          normals[i * 3 + 1] = r.f32();
          normals[i * 3 + 2] = r.f32();
        }
        if (colors) {
          for (let k = 0; k < 4; k++) colors[i * 4 + k] = r.f32();
        }
        for (let k = 0; k < tcPer; k++) texCoords[i * tcPer + k] = r.f32();
      }
      vertices = { flags, texCoordSets, texCoordSetSize, count, positions, normals, colors, texCoords };
    } else if (t === 'TRIS') {
      const triBrush = r.i32();
      const n = Math.floor((chunkEnd - r.offset) / 4);
      const indices = new Uint32Array(n - (n % 3));
      for (let i = 0; i < indices.length; i++) indices[i] = r.i32();
      triangles.push({ brushId: triBrush, indices });
    }
    r.offset = chunkEnd;
  }

  if (!vertices) {
    vertices = { flags: 0, texCoordSets: 0, texCoordSetSize: 0, count: 0, positions: new Float32Array(0), texCoords: new Float32Array(0) };
  }
  return { brushId, vertices, triangles };
}
