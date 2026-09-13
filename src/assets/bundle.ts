/**
 * 素材包：构建时把 mod 目录打成 assets.zip，页面启动时一次下载并解压到内存，
 * 之后模型、贴图、音效都从内存读，避免上千个小请求。下载结果按内容哈希存进 Cache Storage，
 * 再次访问不重复下载。开发服务器没有素材包（assets.json 不存在）时回退为逐文件请求。
 */
import { unzipSync } from 'fflate';
import { BASE_URL } from './paths';

const CACHE_NAME = 'stranded2-assets';
const MIME: Record<string, string> = {
  bmp: 'image/bmp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg',
};

export interface BundleManifest {
  hash: string;
  size: number;
  files: number;
}

export interface BundleProgress {
  loaded: number;
  total: number;
  /** 'cache' 表示直接来自本地缓存。 */
  source: 'cache' | 'network';
}

export class AssetBundle {
  private readonly urls = new Map<string, string>();

  private constructor(private readonly files: Map<string, Uint8Array>) {}

  get count(): number {
    return this.files.size;
  }

  private key(modPath: string): string {
    return modPath.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  }

  has(modPath: string): boolean {
    return this.files.has(this.key(modPath));
  }

  bytes(modPath: string): Uint8Array | undefined {
    return this.files.get(this.key(modPath));
  }

  /** 图片与音频用 blob URL 交给 Image/Audio 元素；同一文件复用。 */
  blobUrl(modPath: string): string | undefined {
    const key = this.key(modPath);
    const data = this.files.get(key);
    if (!data) return undefined;
    let url = this.urls.get(key);
    if (!url) {
      const ext = key.slice(key.lastIndexOf('.') + 1);
      url = URL.createObjectURL(new Blob([data as BlobPart], { type: MIME[ext] ?? 'application/octet-stream' }));
      this.urls.set(key, url);
    }
    return url;
  }

  /** 读取 assets.json，没有则返回 null（开发服务器或旧部署）。 */
  static async load(onProgress?: (p: BundleProgress) => void): Promise<AssetBundle | null> {
    let manifest: BundleManifest;
    try {
      const res = await fetch(`${BASE_URL}assets.json`, { cache: 'no-cache' });
      if (!res.ok) return null;
      manifest = await res.json();
    } catch {
      return null;
    }
    const url = `${BASE_URL}assets.zip?v=${manifest.hash}`;
    const data = await fetchCached(url, manifest, onProgress);
    if (!data) return null;
    const unzipped = unzipSync(data);
    const files = new Map<string, Uint8Array>();
    for (const [name, bytes] of Object.entries(unzipped)) if (!name.endsWith('/')) files.set(name.toLowerCase(), bytes);
    return new AssetBundle(files);
  }
}

async function fetchCached(url: string, manifest: BundleManifest, onProgress?: (p: BundleProgress) => void): Promise<Uint8Array | null> {
  const cache = typeof caches !== 'undefined' ? await caches.open(CACHE_NAME).catch(() => null) : null;
  if (cache) {
    const hit = await cache.match(url);
    if (hit) {
      onProgress?.({ loaded: manifest.size, total: manifest.size, source: 'cache' });
      return new Uint8Array(await hit.arrayBuffer());
    }
  }
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return null;
  }
  if (!res.ok || !res.body) return null;
  const total = Number(res.headers.get('content-length')) || manifest.size;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.({ loaded, total, source: 'network' });
  }
  const data = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) { data.set(c, offset); offset += c.length; }
  if (cache) {
    try {
      for (const key of await cache.keys()) if (key.url !== new URL(url, location.href).href) await cache.delete(key);
      await cache.put(url, new Response(data as BlobPart, { headers: { 'content-type': 'application/zip', 'content-length': String(data.length) } }));
    } catch {
      /* 缓存写入失败只影响下次访问的速度 */
    }
  }
  return data;
}

let current: AssetBundle | null = null;

export function setAssetBundle(b: AssetBundle | null): void {
  current = b;
}

export function assetBundle(): AssetBundle | null {
  return current;
}
