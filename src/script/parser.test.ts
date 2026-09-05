import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { readRefText, MOD_ROOT, readRefBytes } from '../test/reference';
import { parseInf } from '../formats/inf';
import { parseS2Map } from '../formats/s2map';
import { parseScript, scriptEvents, ScriptSyntaxError } from './parser';

describe('parseScript', () => {
  it('parses events, if/elseif/else, loop, assignment', () => {
    const s = parseScript(`on:use { local $a,$b; $a=1; $b+=2; if ($a==1){ msg "hi $a",3; }elseif($b>1){ speech "negative"; }else{ skip; } loop("count",3){ $a++; exit; } }`);
    expect(scriptEvents(s)).toEqual(new Set(['use']));
    const body = s.events[0].body;
    expect(body[0]).toMatchObject({ kind: 'command', name: 'local' });
    expect(body[1]).toMatchObject({ kind: 'assign', name: 'a', op: '=' });
    expect(body[2]).toMatchObject({ kind: 'assign', name: 'b', op: '+=' });
    expect(body[3]).toMatchObject({ kind: 'if' });
    expect((body[3] as any).branches.length).toBe(2);
    expect((body[3] as any).else.length).toBe(1);
    expect(body[4]).toMatchObject({ kind: 'loop' });
  });
  it('parses string interpolation and escapes', () => {
    const s = parseScript(`msg "Got \\$5 and $x", 1;`);
    const cmd = s.top[0] as any;
    expect(cmd.args[0].parts).toEqual(['Got $5 and ', { var: 'x' }]);
    expect(cmd.args[1]).toEqual({ kind: 'num', value: '1' });
  });
  it('parses @ suppression and function calls in expressions', () => {
    const s = parseScript(`@free "unit",1; $id=create("item",24,getx("self"),getz("self"));`);
    expect((s.top[0] as any).suppress).toBe(true);
    expect((s.top[1] as any).expr.kind).toBe('call');
    expect((s.top[1] as any).expr.args.length).toBe(4);
  });
  it('parses comments and precedence', () => {
    const s = parseScript(`// c\n/* multi\nline */ $a=1+2*3==7 && 1;`);
    const e = (s.top[0] as any).expr;
    expect(e.op).toBe('&&');
    expect(e.left.op).toBe('==');
    expect(e.left.left.op).toBe('+');
  });
  it('parses bare words as strings and unary minus', () => {
    const s = parseScript(`ai_mode $id,go; $x=-3*-$y;`);
    expect((s.top[0] as any).args[1]).toEqual({ kind: 'str', parts: ['go'] });
    expect((s.top[1] as any).expr.kind).toBe('binary');
    expect((s.top[1] as any).expr.left.kind).toBe('unary');
    expect((s.top[1] as any).expr.right.kind).toBe('unary');
  });
  it('accepts single = as comparison and separator byte as newline', () => {
    const s = parseScript(`if (parent_class("self")=2){ $a=1; }\u00a6$b=2;`);
    expect((s.top[0] as any).branches[0].cond.op).toBe('==');
    expect(s.top.length).toBe(2);
  });
  it('tolerates missing semicolon before closing brace', () => {
    expect(() => parseScript(`on:use { msg "x" }`)).not.toThrow();
  });
  it('reports line numbers on errors', () => {
    try {
      parseScript(`msg "a";\nif ($a==1 {`);
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ScriptSyntaxError);
      expect((e as ScriptSyntaxError).line).toBe(2);
    }
  });
  it('parses every original script', () => {
    const sources: { origin: string; text: string }[] = [];
    for (const f of readdirSync(`${MOD_ROOT}/sys`).filter(f => f.endsWith('.inf'))) {
      for (const e of parseInf(readRefText(`sys/${f}`))) if (e.script) sources.push({ origin: `${f}#${e.id}`, text: e.script });
    }
    const game = readRefText('sys/game.inf');
    const m = /script=start\r?\n([\s\S]*?)\r?\nscript=end/.exec(game);
    if (m) sources.push({ origin: 'game.inf', text: m[1] });
    for (const f of readdirSync(`${MOD_ROOT}/sys/scripts`).filter(f => f.endsWith('.s2s'))) {
      const text = readRefText(`sys/scripts/${f}`);
      if (/^page=/m.test(text)) continue;
      for (const [i, sec] of text.split(/^\/\/~.*$/m).entries()) {
        if (sec.includes('on:')) sources.push({ origin: `${f}#${i}`, text: sec });
      }
    }
    const walk = (dir: string): string[] => readdirSync(`${MOD_ROOT}/${dir}`, { withFileTypes: true }).flatMap(f => f.isDirectory() ? walk(`${dir}/${f.name}`) : f.name.endsWith('.s2') ? [`${dir}/${f.name}`] : []);
    for (const p of walk('maps')) {
      const map = parseS2Map(readRefBytes(p));
      if (map.header.briefing.trim()) sources.push({ origin: `${p}#briefing`, text: map.header.briefing });
      const textContainers = new Set(map.infos.filter(i => i.typ === 37).map(i => i.id));
      for (const ext of map.extensions) {
        if (ext.mode !== 0 || !ext.value.trim()) continue;
        if (ext.parentClass === 4 && textContainers.has(ext.parentId)) continue;
        sources.push({ origin: `${p}#${ext.parentClass}:${ext.parentId}`, text: ext.value });
      }
    }
    expect(sources.length).toBeGreaterThan(200);
    const errors: string[] = [];
    for (const s of sources) {
      try { parseScript(s.text); } catch (e) { errors.push(`${s.origin}: ${(e as Error).message}`); }
    }
    expect(errors, errors.slice(0, 10).join('\n')).toEqual([]);
  });
});
