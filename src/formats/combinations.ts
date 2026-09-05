/** 合成定义（sys/combinations*.inf）解析与相似分组。 */

export interface CombiReq {
  typ: number;
  count: number;
  /** 为真时合成后不消耗。 */
  stay: boolean;
}

export interface Combination {
  key: string;
  name: string;
  reqs: CombiReq[];
  gens: { typ: number; count: number }[];
  script?: string;
  /** 需求类型集合相同的合成同组；0 表示没有同组者。 */
  group: number;
  origin: string;
}

export function parseCombinations(text: string, origin: string): Combination[] {
  const out: Combination[] = [];
  let cur: Combination | undefined;
  let pendingName = '';
  let scriptLines: string[] | undefined;
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (scriptLines) {
      if (line.trim() === 'script=end') {
        if (cur) cur.script = scriptLines.join('\n');
        scriptLines = undefined;
      } else {
        scriptLines.push(line);
      }
      continue;
    }
    const t = line.trim();
    if (t === '') continue;
    if (t.startsWith('#')) {
      if (t.startsWith('###')) pendingName = t.replace(/^#+\s*/, '');
      continue;
    }
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim().toLowerCase();
    const value = t.slice(eq + 1).trim();
    switch (key) {
      case 'combi':
        if (value === 'start') {
          cur = { key: '', name: pendingName, reqs: [], gens: [], group: 0, origin };
          pendingName = '';
        } else if (value === 'end' && cur) {
          if (cur.reqs.length >= 2 && cur.gens.length >= 1) out.push(cur);
          cur = undefined;
        }
        break;
      case 'id':
        if (cur) cur.key = value;
        break;
      case 'req': {
        if (!cur) break;
        const p = value.split(',').map(x => x.trim());
        const count = parseInt(p[1] ?? '1', 10);
        cur.reqs.push({ typ: parseInt(p[0], 10) || 0, count: count > 0 ? count : 1, stay: (p[2] ?? '').toLowerCase() === 'stay' });
        break;
      }
      case 'gen': {
        if (!cur) break;
        const p = value.split(',').map(x => x.trim());
        const count = parseInt(p[1] ?? '1', 10);
        cur.gens.push({ typ: parseInt(p[0], 10) || 0, count: count > 0 ? count : 1 });
        break;
      }
      case 'script':
        if (value === 'start') scriptLines = [];
        break;
      default:
        break;
    }
  }
  return out;
}

/** 需求类型集合完全相同的合成归为同一组（原版 combinations_similar）。 */
export function assignGroups(list: Combination[]): void {
  let serial = 0;
  const sig = (c: Combination) => [...new Set(c.reqs.map(r => r.typ))].sort((a, b) => a - b).join(',');
  const bySig = new Map<string, Combination[]>();
  for (const c of list) {
    const k = sig(c);
    const arr = bySig.get(k) ?? [];
    arr.push(c);
    bySig.set(k, arr);
  }
  for (const arr of bySig.values()) {
    if (arr.length < 2) continue;
    serial++;
    for (const c of arr) c.group = serial;
  }
}
