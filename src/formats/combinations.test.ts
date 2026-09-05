import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { readRefText, MOD_ROOT } from '../test/reference';
import { parseCombinations, assignGroups } from './combinations';

describe('combinations', () => {
  const files = readdirSync(`${MOD_ROOT}/sys`).filter(f => /^combinations.*\.inf$/i.test(f));
  const all = files.flatMap(f => parseCombinations(readRefText(`sys/${f}`), f));
  it('parses every original combination', () => {
    const starts = files.reduce((n, f) => n + (readRefText(`sys/${f}`).match(/^combi=start/gm)?.length ?? 0), 0);
    expect(all.length).toBe(starts);
    expect(all.length).toBeGreaterThan(40);
  });
  it('parses flour with stay requirement', () => {
    const flour = all.find(c => c.key === 'flour')!;
    expect(flour.reqs).toEqual([{ typ: 42, count: 9, stay: false }, { typ: 23, count: 1, stay: true }]);
    expect(flour.gens).toEqual([{ typ: 43, count: 1 }]);
    expect(flour.script).toContain('process');
  });
  it('groups combinations with identical requirement types', () => {
    const list = parseCombinations(`combi=start\nid=a\nreq=1\nreq=2\ngen=3\ncombi=end\ncombi=start\nid=b\nreq=2,5\nreq=1\ngen=4\ncombi=end\ncombi=start\nid=c\nreq=1\nreq=5\ngen=6\ncombi=end\n`, 't');
    assignGroups(list);
    expect(list[0].group).toBe(1);
    expect(list[1].group).toBe(1);
    expect(list[2].group).toBe(0);
  });
});
