/** Stranded II 定义文件（sys/*.inf）解析。 */

export interface InfEntry {
  id: number;
  fields: Map<string, string[]>;
  script?: string;
  comment?: string;
}

export interface AnimRange {
  start: number;
  end: number;
  speed: number;
}

export interface FindEntry {
  typ: number;
  ratio: number;
  max: number;
  min: number;
  reqTyp: number;
}

export interface LootEntry {
  typ: number;
  max: number;
}

export interface EntityDef {
  id: number;
  name: string;
  model: string;
  icon: string;
  scale: [number, number, number];
  color: [number, number, number];
  alpha: number;
  fx: number;
  autofade: number;
  aligntowater: boolean;
  anims: Map<string, AnimRange>;
  script?: string;
  /** 物品重量；背包承重按 weight*count 计算。 */
  weight: number;
  /** 物体碰撞模式：缺省 1；1、3、4 参与碰撞，0 和 2 不参与。 */
  col: number;
  eyes: number;
  colxr: number;
  colyr: number;
  speed: number;
  store: number;
  maxweight: number;
  group: string;
  behaviour: string;
  mat: string;
  health: number;
  /** 定义文件里的 var=name,value 行，实体创建时初始化为局部变量。 */
  vars: { name: string; value: string }[];
  damage: number;
  /** 攻击冷却毫秒。 */
  rate: number;
  attackrange: number;
  /** 陆地转向速度，度每 f。 */
  turnspeed: number;
  /** 活动中心半径与追击距离。 */
  range: number;
  /** 移动动画循环播放；为 0 时往返播放。 */
  loopmoveani: number;
  /** 投射物每 f 的俯角增量。 */
  drag: number;
  /** 命中目标时附加的状态名，空串为无。 */
  weaponstate: string;
  /** 命中物体时掉落的百分比概率。 */
  findratio: number;
  finds: FindEntry[];
  loots: LootEntry[];
}

/**
 * 行格式 key=value；`### 名称` 是下一条目的注释；`id=` 开启新条目；
 * script=start / script=end 之间的原文整体保存。
 */
export function parseInf(text: string): InfEntry[] {
  const entries: InfEntry[] = [];
  let current: InfEntry | undefined;
  let pendingComment: string | undefined;
  let scriptLines: string[] | undefined;

  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

    if (scriptLines) {
      if (line.trim() === 'script=end') {
        if (current) current.script = scriptLines.join('\n');
        scriptLines = undefined;
      } else {
        scriptLines.push(line);
      }
      continue;
    }

    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('#')) {
      if (trimmed.startsWith('###')) {
        const c = trimmed.replace(/^#+\s*/, '');
        if (c !== '') pendingComment = c;
      }
      continue;
    }

    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim().toLowerCase();
    const value = trimmed.slice(eq + 1).trim();

    if (key === 'script' && value === 'start') {
      scriptLines = [];
      continue;
    }
    if (key === 'id') {
      current = { id: Number(value), fields: new Map(), comment: pendingComment };
      pendingComment = undefined;
      entries.push(current);
      continue;
    }
    if (!current) continue;
    const list = current.fields.get(key);
    if (list) list.push(value);
    else current.fields.set(key, [value]);
  }
  return entries;
}

export function toEntityDef(e: InfEntry): EntityDef {
  const first = (k: string) => e.fields.get(k)?.[0];
  const num = (k: string, d: number) => {
    const v = first(k);
    return v === undefined || v === '' ? d : Number(v);
  };

  const s = num('scale', 1);
  const scale: [number, number, number] = [num('x', s), num('y', s), num('z', s)];

  let color: [number, number, number] = [255, 255, 255];
  const c = first('color');
  if (c) {
    const parts = c.split(',').map(Number);
    if (parts.length >= 3) color = [parts[0], parts[1], parts[2]];
  }
  color = [num('r', color[0]), num('g', color[1]), num('b', color[2])];

  const anims = new Map<string, AnimRange>();
  for (const [k, vals] of e.fields) {
    if (!k.startsWith('ani_')) continue;
    const parts = vals[0].split(',').map(Number);
    if (parts.length >= 2) {
      anims.set(k.slice(4), { start: parts[0], end: parts[1], speed: parts[2] ?? 0.05 });
    }
  }

  return {
    id: e.id,
    name: first('name') ?? '',
    model: first('model') ?? '',
    icon: first('icon') ?? '',
    scale,
    color,
    alpha: num('alpha', 1),
    fx: num('fx', 0),
    autofade: num('autofade', 0),
    aligntowater: num('aligntowater', 0) !== 0,
    anims,
    script: e.script,
    weight: num('weight', 0),
    col: num('col', 1),
    eyes: num('eyes', 0),
    colxr: num('colxr', 1),
    colyr: num('colyr', 1),
    speed: num('speed', 0),
    store: num('store', 100),
    maxweight: num('maxweight', 0),
    group: first('group') ?? '',
    behaviour: first('behaviour') ?? '',
    mat: first('mat') ?? '',
    health: num('health', 100),
    vars: (e.fields.get('var') ?? []).map(v => {
      const i = v.indexOf(',');
      return i < 0 ? { name: v.trim(), value: '0' } : { name: v.slice(0, i).trim(), value: v.slice(i + 1).trim() };
    }),
    damage: num('damage', 0),
    rate: num('rate', 500),
    attackrange: num('attackrange', 45),
    turnspeed: num('turnspeed', 2),
    range: num('range', 300),
    loopmoveani: num('loopmoveani', 0),
    drag: num('drag', 0),
    weaponstate: first('weaponstate') ?? '',
    findratio: num('findratio', 30),
    finds: (e.fields.get('find') ?? []).map(v => {
      const p = v.split(',').map(x => Number(x.trim()));
      return { typ: p[0] || 0, ratio: p[1] || 0, max: p[2] || 1, min: p[3] || 1, reqTyp: p[4] || 0 };
    }),
    loots: (e.fields.get('loot') ?? []).map(v => {
      const p = v.split(',').map(x => Number(x.trim()));
      return { typ: p[0] || 0, max: Math.max(p[1] || 1, 1) };
    }),
  };
}

export function buildDefTable(texts: string[]): Map<number, EntityDef> {
  const table = new Map<number, EntityDef>();
  for (const text of texts) {
    for (const entry of parseInf(text)) table.set(entry.id, toEntityDef(entry));
  }
  return table;
}
