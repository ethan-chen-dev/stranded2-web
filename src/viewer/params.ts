/** 页面参数里的地图路径只接受文件索引中真实存在的地图，返回索引里的原始写法；找不到为 null。 */
export function resolveMapPath(requested: string, known: string[]): string | null {
  const key = requested.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  return known.find(k => k.toLowerCase() === key) ?? null;
}
