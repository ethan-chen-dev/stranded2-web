/** 按 URL 缓存的资源加载：文本、二进制、贴图、模型。URL 根即 mod 根目录。 */
import * as THREE from 'three';
import { latin1 } from '../formats/binary-reader';
import { parseB3D, TEX_ALPHA, TEX_MASKED, TEX_CLAMP_U, TEX_CLAMP_V, FX_FULLBRIGHT, FX_VERTEX_COLORS, FX_TWO_SIDED, type B3DBrush, type B3DModel, type B3DTexture } from '../formats/b3d';
import { b3dToThree, type ThreeModel } from './b3d-to-three';
import { modUrl, textureCandidates } from './paths';
import type { Log } from '../viewer/log';

export interface ModelOptions {
  fx?: number;
  color?: [number, number, number];
  alpha?: number;
}

export class Resources {
  private readonly cache = new Map<string, Promise<unknown>>();

  constructor(private readonly log: Log) {}

  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    let p = this.cache.get(key) as Promise<T> | undefined;
    if (!p) {
      p = load();
      this.cache.set(key, p);
    }
    return p;
  }

  bytes(url: string): Promise<Uint8Array> {
    return this.cached(`bytes:${url}`, async () => {
      const res = await fetch(encodeURI(url));
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return new Uint8Array(await res.arrayBuffer());
    });
  }

  async text(url: string): Promise<string> {
    return latin1(await this.bytes(url));
  }

  /** 加载失败返回 null 并记录警告。flags 为 b3d 贴图标志。 */
  texture(url: string, flags = 0): Promise<THREE.Texture | null> {
    return this.cached(`tex:${url}:${flags}`, async () => {
      const image = await loadImage(encodeURI(url));
      if (!image) {
        this.log.warn(`贴图缺失 ${url}`);
        return null;
      }
      const tex = flags & TEX_MASKED ? new THREE.CanvasTexture(maskBlack(image)) : new THREE.Texture(image);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = flags & TEX_CLAMP_U ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
      tex.wrapT = flags & TEX_CLAMP_V ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
      tex.needsUpdate = true;
      return tex;
    });
  }

  /** 依次尝试候选 URL，全部失败返回 null。 */
  async textureFrom(candidates: string[], flags = 0): Promise<THREE.Texture | null> {
    for (const url of candidates) {
      const image = await loadImage(encodeURI(url));
      if (image) return this.texture(url, flags);
    }
    this.log.warn(`贴图缺失 ${candidates.join(' | ')}`);
    return null;
  }

  b3d(url: string): Promise<B3DModel> {
    return this.cached(`b3d:${url}`, async () => parseB3D(await this.bytes(url)));
  }

  /** 解析模型并按定义的 fx/颜色/透明度生成材质；同一组参数共享一份。失败返回 null。 */
  model(blitzPath: string, opts: ModelOptions = {}): Promise<ThreeModel | null> {
    const url = modUrl(blitzPath);
    const fx = opts.fx ?? 0;
    const color = opts.color ?? [255, 255, 255];
    const alpha = opts.alpha ?? 1;
    const key = `model:${url}|${fx}|${color.join(',')}|${alpha}`;
    return this.cached(key, async () => {
      let parsed: B3DModel;
      try {
        parsed = await this.b3d(url);
      } catch (e) {
        this.log.warn(`模型加载失败 ${url}: ${(e as Error).message}`);
        return null;
      }
      const textures = await Promise.all(
        parsed.textures.map(t => this.textureFrom(textureCandidates(url, t.file), t.flags)),
      );
      const tint = new THREE.Color(color[0] / 255, color[1] / 255, color[2] / 255);
      return b3dToThree(parsed, (brush, texDefs) => makeMaterial(brush, texDefs, textures, fx, tint, alpha));
    });
  }
}

function makeMaterial(
  brush: B3DBrush, texDefs: B3DTexture[], textures: (THREE.Texture | null)[],
  fx: number, tint: THREE.Color, alpha: number,
): THREE.Material {
  const effects = fx | brush.fx;
  const texId = brush.textureIds.find(id => id >= 0);
  const texDef = texId !== undefined ? texDefs[texId] : undefined;
  const map = texId !== undefined ? textures[texId] : null;
  const cutout = !!texDef && (texDef.flags & (TEX_MASKED | TEX_ALPHA)) !== 0;
  const opacity = brush.color[3] * alpha;

  const params: THREE.MeshLambertMaterialParameters = {
    color: new THREE.Color(brush.color[0], brush.color[1], brush.color[2]).multiply(tint),
    side: effects & FX_TWO_SIDED ? THREE.DoubleSide : THREE.FrontSide,
    vertexColors: (effects & FX_VERTEX_COLORS) !== 0,
    transparent: opacity < 1 || (!!texDef && (texDef.flags & TEX_ALPHA) !== 0),
    opacity,
    alphaTest: cutout ? 0.5 : 0,
  };
  if (map) params.map = map;
  return effects & FX_FULLBRIGHT ? new THREE.MeshBasicMaterial(params) : new THREE.MeshLambertMaterial(params);
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Blitz3D 遮罩贴图：纯黑像素透明。 */
function maskBlack(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] === 0 && px[i + 1] === 0 && px[i + 2] === 0) px[i + 3] = 0;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}
