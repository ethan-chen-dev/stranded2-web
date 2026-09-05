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
  };
}

export function buildDefTable(texts: string[]): Map<number, EntityDef> {
  const table = new Map<number, EntityDef>();
  for (const text of texts) {
    for (const entry of parseInf(text)) table.set(entry.id, toEntityDef(entry));
  }
  return table;
}
