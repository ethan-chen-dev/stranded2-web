/** 昼夜光照表（sys/lightcycle.inf）与原版的环境光、雾色公式。 */
export type RGB = [number, number, number];

export const VIEW_FACTOR = 4;
export const FOG_NEAR = 500 * VIEW_FACTOR - 250;
export const FOG_FAR = 500 * VIEW_FACTOR + 350;

const WHITE: RGB = [255, 255, 255];

/** 每行 `小时=r,g,b`；缺失的小时用白色。 */
export function parseLightcycle(text: string): RGB[] {
  const cycle: RGB[] = Array.from({ length: 24 }, () => [...WHITE] as RGB);
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const m = /^(\d+)\s*=\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(line);
    if (!m) continue;
    const h = Number(m[1]);
    if (h >= 0 && h < 24) cycle[h] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return cycle;
}

/** 小时 h 与 h+1 的颜色按 minute/59 插值。 */
export function lightColor(cycle: RGB[], hour: number, minute: number): RGB {
  const h1 = ((hour % 24) + 24) % 24;
  const h2 = (h1 + 1) % 24;
  const p = Math.min(Math.max(minute / 59, 0), 1);
  const a = cycle[h1];
  const b = cycle[h2];
  return [a[0] * (1 - p) + b[0] * p, a[1] * (1 - p) + b[1] * p, a[2] * (1 - p) + b[2] * p];
}

export function ambientColor(c: RGB): RGB {
  return [Math.max(c[0] - 55, 0), Math.max(c[1] - 55, 0), Math.max(c[2] - 55, 0)];
}

export function fogColor(c: RGB, mapFog: RGB): RGB {
  return [
    Math.max(c[0] - (255 - mapFog[0]), 0),
    Math.max(c[1] - (255 - mapFog[1]), 0),
    Math.max(c[2] - (255 - mapFog[2]), 0),
  ];
}
