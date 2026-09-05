/** 建筑定义（sys/buildings.inf）解析。 */

export type BuildSpace = 'land' | 'landwater' | 'water' | 'shore' | 'hill' | 'shallow' | 'atobject';

export interface Building {
  id: number;
  name: string;
  group: string;
  /** 建成后的物体类型；为单位时为 0。 */
  objectId: number;
  unitId: number;
  reqs: { typ: number; count: number }[];
  space: BuildSpace;
  atObject: number;
  /** 自定义工地物体类型，0 为默认。 */
  siteObject: number;
  script?: string;
}

const SPACES: Record<string, BuildSpace> = {
  'land': 'land', 'land and water': 'landwater', 'water': 'water', 'shore': 'shore', 'hill': 'hill',
  'shallow water': 'shallow', 'at object': 'atobject',
};

export function parseBuildings(text: string): Building[] {
  const out: Building[] = [];
  let cur: Building | undefined;
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
      case 'id':
        cur = { id: parseInt(value, 10) || 0, name: pendingName, group: '', objectId: 0, unitId: 0, reqs: [], space: 'land', atObject: 0, siteObject: 0 };
        pendingName = '';
        out.push(cur);
        break;
      case 'name': if (cur) cur.name = value; break;
      case 'group': if (cur) cur.group = value; break;
      case 'objectid': if (cur) cur.objectId = parseInt(value, 10) || 0; break;
      case 'unitid': if (cur) cur.unitId = parseInt(value, 10) || 0; break;
      case 'buildingsite': if (cur) cur.siteObject = parseInt(value, 10) || 0; break;
      case 'atobject': if (cur) { cur.atObject = parseInt(value, 10) || 0; cur.space = 'atobject'; } break;
      case 'buildspace': if (cur) cur.space = SPACES[value.toLowerCase()] ?? 'land'; break;
      case 'req': {
        if (!cur) break;
        const p = value.split(',').map(x => x.trim());
        const count = parseInt(p[1] ?? '1', 10);
        cur.reqs.push({ typ: parseInt(p[0], 10) || 0, count: count > 0 ? count : 1 });
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
