import { describe, it, expect, beforeEach } from 'vitest';
import { FakeHost } from './fake-host';
import { ScriptEngine } from './engine';
import { createRegistry } from './commands';
import { CLASS } from './host';
import type { ExecEnv } from './interpreter';

let host: FakeHost;
let engine: ScriptEngine;
const itemEnv: ExecEnv = { cls: CLASS.item, id: 7, event: 'use', info: '' };

function run(text: string, env: ExecEnv = itemEnv) {
  return engine.runText(text, env, 'test');
}
const g = (name: string) => engine.vars.globals.get(name) ?? '0';

beforeEach(() => {
  host = new FakeHost();
  engine = new ScriptEngine(host, createRegistry());
  engine.stateTypes.set('fire', 4);
  host.add(CLASS.item, 24, 7);
});

describe('interpreter', () => {
  it('runs top level and matching on block only', () => {
    run(`$t=1; on:use { $a=1; } on:eat { $a=2; }`);
    expect(g('t')).toBe('1');
    expect(g('a')).toBe('1');
  });
  it('interpolates and concatenates', () => {
    run(`$n="Bob"; msg "Hi $n, "+1+2;`);
    expect(host.messages[0].text).toBe('Hi Bob, 12');
    expect(host.messages[0].duration).toBe(3000);
  });
  it('local shadows global and absorbs int', () => {
    run(`$x=5; local $x; $x++;`);
    expect(engine.vars.getLocal(CLASS.item, 7, 'x')).toBe('6');
    expect(engine.vars.globals.has('x')).toBe(false);
  });
  it('loop count with exit', () => {
    run(`$i=0; loop("count",10){ $i++; if ($i==4){ exit; } }`);
    expect(g('i')).toBe('4');
  });
  it('loops over entities by type with loop_id', () => {
    host.add(CLASS.item, 24, 3);
    host.add(CLASS.item, 9, 5);
    host.add(CLASS.item, 24, 9);
    run(`$s=""; loop("items",24){ $s=$s+loop_id()+","; }`);
    expect(g('s')).toBe('7,3,9,');
  });
  it('skip stops and skipevent reports', () => {
    expect(run(`skipevent; $a=1;`)).toBe('skipevent');
    expect(g('a')).toBe('0');
    expect(run(`$b=1; skip; $b=2;`)).toBe('skip');
    expect(g('b')).toBe('1');
  });
  it('@ suppresses runtime errors', () => {
    expect(run(`@addstate "unit",1,"nostate"; $a=1;`)).toBe('done');
    expect(g('a')).toBe('1');
    expect(run(`addstate "unit",1,"nostate"; $b=1;`)).toBe('error');
    expect(g('b')).toBe('0');
  });
  it('unknown command returns 0 and logs once', () => {
    run(`$a=nothere(1); $b=nothere(2); nothere;`);
    expect(g('a')).toBe('0');
    expect(host.logs.filter(l => l.includes('nothere')).length).toBe(1);
  });
  it('elseif chain and string compare', () => {
    run(`$k="b"; if ($k=="a"){ $r=1; }elseif($k=="b"){ $r=2; }else{ $r=3; }`);
    expect(g('r')).toBe('2');
  });
  it('division by zero stops the script', () => {
    expect(run(`$a=1/0; $b=1;`)).toBe('error');
    expect(g('b')).toBe('0');
    expect(host.logs.some(l => l.includes('division by zero'))).toBe(true);
  });
  it('stops runaway loops', () => {
    expect(run(`loop("count",1000000){ $i++; }`)).toBe('error');
  });
  it('currentclass/currentid and getlocal/setlocal', () => {
    run(`$c=currentclass(); $i=currentid(); setlocal "item",7,"tame",3; $t=getlocal("item",7,"tame");`);
    expect([g('c'), g('i'), g('t')]).toEqual(['3', '7', '3']);
  });
  it('string functions', () => {
    run(`$a=length("abcd"); $b=split("x,y,z",",",2); $c=extract("hello",2,3); $d=replace("a-b","-","+"); $e=join("a",1,"b");`);
    expect([g('a'), g('b'), g('c'), g('d'), g('e')]).toEqual(['4', 'y', 'ell', 'a+b', 'a1b']);
  });
  it('random uses host with 1..n for single argument', () => {
    host.randomValues = [3, 7];
    run(`$a=random(5); $b=random(6,9);`);
    expect([g('a'), g('b')]).toEqual(['3', '7']);
  });
});

describe('engine events', () => {
  it('queues entity events and runs them on update', () => {
    engine.setTypeScript(CLASS.item, 24, `on:ping { $p=$p+1; }`, 'items');
    engine.entityEvent(CLASS.item, 7, 'ping');
    expect(g('p')).toBe('0');
    engine.update(0);
    expect(g('p')).toBe('1');
  });
  it('global event reaches game, map, type and instance scripts', () => {
    engine.setGameScript(`on:start { $g=1; }`);
    engine.setMapScript(`on:start { $m=1; }`);
    engine.setTypeScript(CLASS.item, 24, `on:start { $t=$t+1; }`, 'items');
    engine.addInstanceScript(CLASS.item, 7, `on:start { $i=1; }`);
    host.add(CLASS.item, 24, 8);
    engine.globalEvent('start');
    engine.update(0);
    expect([g('g'), g('m'), g('t'), g('i')]).toEqual(['1', '1', '2', '1']);
  });
  it('runNow reports skipevent', () => {
    engine.setTypeScript(CLASS.item, 24, `on:collect { skipevent; }`, 'items');
    expect(engine.runNow(CLASS.item, 7, 'collect')).toEqual({ ran: 1, skipevent: true });
    expect(engine.runNow(CLASS.item, 7, 'drop').ran).toBe(0);
  });
  it('event command dispatches', () => {
    engine.setTypeScript(CLASS.item, 24, `on:use { event "ping"; event "boom","global"; } on:ping { $p=1; }`, 'items');
    engine.setMapScript(`on:boom { $b=1; }`);
    engine.runNow(CLASS.item, 7, 'use');
    engine.update(0);
    expect([g('p'), g('b')]).toEqual(['1', '1']);
  });
  it('timer fires, repeats, and expires', () => {
    engine.setTypeScript(CLASS.item, 24, `on:use { timer "self",1000,2,"tick"; } on:tick { $t=$t+1; }`, 'items');
    engine.runNow(CLASS.item, 7, 'use');
    host.ms = 999; engine.update(0);
    expect(g('t')).toBe('0');
    host.ms = 1001; engine.update(0);
    expect(g('t')).toBe('1');
    host.ms = 2002; engine.update(0);
    expect(g('t')).toBe('2');
    host.ms = 9000; engine.update(0);
    expect(g('t')).toBe('2');
    expect(engine.timers.records.length).toBe(0);
  });
  it('timer with global class fires global event', () => {
    engine.setMapScript(`on:start { timer 0,500,1,"later"; } on:later { $l=1; }`);
    engine.runGlobalNow('start');
    host.ms = 501; engine.update(0);
    expect(g('l')).toBe('1');
  });
  it('states add, query, free with events', () => {
    engine.setTypeScript(CLASS.item, 24, `on:addstate { $added=$added+1; } on:freestate { $freed=1; }`, 'items');
    run(`$a=addstate("item",7,"fire"); $b=addstate("item",7,"fire"); $g=gotstate("item",7,"fire"); statevalue "item",7,"fire",5; $v=getstatevalue("item",7,"fire"); $c=count_state("fire");`);
    engine.update(0);
    expect([g('a'), g('b'), g('g'), g('v'), g('c'), g('added')]).toEqual(['1', '0', '1', '5', '1', '1']);
    run(`freestate "item",7,"fire"; $g2=gotstate("item",7,"fire");`);
    engine.update(0);
    expect([g('g2'), g('freed')]).toEqual(['0', '1']);
  });
  it('syntax errors are recorded and script disabled', () => {
    engine.setTypeScript(CLASS.item, 24, `on:use { if ( { }`, 'items');
    expect(engine.syntaxErrors.length).toBe(1);
    expect(engine.runNow(CLASS.item, 7, 'use').ran).toBe(0);
  });
});
