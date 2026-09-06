/** 原版反斜杠路径与浏览器 URL 之间的转换。URL 根即 mod 根目录；部署到子路径时由 assetUrl 加上 vite base。 */

/** 部署子路径（vite base），结尾带斜杠；开发与测试时为 '/'。 */
export const BASE_URL: string = (import.meta.env?.BASE_URL as string | undefined) ?? '/';

/** mod 根目录下的路径转成实际请求 URL。 */
export function assetUrl(modPath: string): string {
  const p = modPath.replace(/\\/g, '/').replace(/^\/+/, '');
  return BASE_URL + p;
}

export function modUrl(blitzPath: string): string {
  const p = blitzPath.replace(/\\/g, '/');
  return p.startsWith('/') ? p : '/' + p;
}

export function dirname(url: string): string {
  const i = url.lastIndexOf('/');
  return i <= 0 ? '/' : url.slice(0, i);
}

function joinUrl(dir: string, rel: string): string {
  return (dir === '/' ? '' : dir) + '/' + rel;
}

/** 模型内贴图名先按模型所在目录解析，再回退到 gfx/ 下同名文件。 */
export function textureCandidates(modelUrl: string, texFile: string): string[] {
  let rel = texFile.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(rel)) rel = rel.slice(rel.lastIndexOf('/') + 1);
  while (rel.startsWith('./')) rel = rel.slice(2);
  const base = rel.slice(rel.lastIndexOf('/') + 1);
  const out = [joinUrl(dirname(modelUrl), rel)];
  const fallback = '/gfx/' + base;
  if (fallback !== out[0]) out.push(fallback);
  return out;
}
