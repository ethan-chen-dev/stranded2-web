import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDialogue, buttonAction } from './dialogue';
import { TextBuffer, splitColoredLines } from '../game/textbuffer';

const FILE = 'reference/game/mods/Stranded II/maps/adventure/map05_villager.s2s';

function section(text: string, name: string): string {
  const out: string[] = [];
  let on = false;
  for (const l of text.split(/\r?\n/)) {
    if (l.startsWith('//~')) { if (on) break; on = l.slice(3).trim() === name; continue; }
    if (on) out.push(l);
  }
  return out.join('\n');
}

describe('parseDialogue', () => {
  it('parses the cartographer dialogue of map05', () => {
    const text = readFileSync(FILE, 'latin1');
    const pages = parseDialogue(section(text, 'villager_map'));
    expect(pages.size).toBeGreaterThan(5);
    const start = pages.get('start')!;
    expect(start.title).toBe('Cartographer');
    expect(start.text).toBe('Hello stranger!');
    expect(start.buttons).toEqual([
      { target: 'p1', text: 'Who are you?', icon: '' },
      { target: 'action:close', text: "Hello 'n' goodbye!", icon: '' },
    ]);
    const p2a = pages.get('p2a')!;
    expect(p2a.buttons.map(b => b.target)).toEqual(['p3a', 'p3b', 'action:close']);
    const alien = parseDialogue(section(text, 'villager_alien')).get('alien')!;
    expect(alien.title).toBe('Native');
    expect(alien.text.split('\n')[0]).toBe("Uhna mohnu g'u Lahak!");
    expect(alien.text).toContain("!3... I can't understand him!");
  });

  it('parses scripts, ibuttons and trades', () => {
    const pages = parseDialogue([
      'page=a', 'title=T', 'text=start', 'line1', '', 'line2', 'text=end',
      'script=start', 'msg "x";', '$v=1;', 'script=end',
      'ibutton=3,b,Go', 'button=script:msg "y";,Say', 'button=event:boom,Boom',
      'trade=start', 'sell=5,2', 'buy=7', 'trade=end', '# comment=ignored',
      'page=b', 'text=start', 'second', 'text=end',
    ].join('\n'));
    const a = pages.get('a')!;
    expect(a.text).toBe('line1\n\nline2');
    expect(a.script).toBe('msg "x";\n$v=1;');
    expect(a.buttons[0]).toEqual({ icon: '3', target: 'b', text: 'Go' });
    expect(a.trades).toEqual([{ sell: [{ typ: 5, count: 2 }], buy: [{ typ: 7, count: 1 }] }]);
    expect(buttonAction(a.buttons[1].target)).toEqual({ kind: 'script', param: 'msg "y";' });
    expect(buttonAction(a.buttons[2].target)).toEqual({ kind: 'event', param: 'boom' });
    expect(buttonAction('action:close')).toEqual({ kind: 'close', param: '' });
    expect(buttonAction('b')).toEqual({ kind: 'page', param: 'b' });
    expect(pages.get('b')!.text).toBe('second');
  });
});

describe('TextBuffer', () => {
  it('accumulates lines and take clears', () => {
    const b = new TextBuffer();
    b.add('a');
    b.add('b');
    expect(b.value).toBe('a\nb');
    expect(b.take()).toBe('a\nb');
    expect(b.value).toBe('');
    expect(splitColoredLines('!3red\nplain\n!9bad')).toEqual([
      { text: 'red', color: 3 }, { text: 'plain', color: -1 }, { text: 'bad', color: -1 },
    ]);
  });
});
